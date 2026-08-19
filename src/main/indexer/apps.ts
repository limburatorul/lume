import { app, shell } from 'electron'
import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IndexStats } from '../../shared/types.js'
import { settings } from '../settings.js'

const here = path.dirname(fileURLToPath(import.meta.url))
/*
 * powershell.exe cannot read a file inside app.asar - the archive is only
 * virtualised for Electron's own fs. electron-builder is told to leave this
 * script unpacked (asarUnpack), so point at the real copy on disk.
 */
const UWP_SCRIPT = path.join(here, 'uwp.ps1').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep)

export interface AppEntry {
  id: string
  name: string
  /** Extra strings the fuzzy matcher may hit: exe name, publisher folder, etc. */
  keywords: string[]
  kind: 'lnk' | 'exe' | 'uwp' | 'url'
  /** What gets launched: a .lnk/.exe path, a URL, or a UWP AppID. */
  launch: string
  /** Underlying executable when known - used for "run as admin" and "reveal". */
  exePath?: string
  /**
   * Files to pull the icon from, best first, joined with "|". A .lnk usually
   * yields a generic glyph, so the resolved .exe is tried ahead of it.
   */
  iconPath?: string
  subtitle: string
}

const START_MENU_DIRS = [
  path.join(process.env.ProgramData ?? 'C:/ProgramData', 'Microsoft/Windows/Start Menu/Programs'),
  path.join(process.env.APPDATA ?? '', 'Microsoft/Windows/Start Menu/Programs'),
]

const DESKTOP_DIRS = [
  path.join(process.env.PUBLIC ?? 'C:/Users/Public', 'Desktop'),
  path.join(process.env.USERPROFILE ?? '', 'Desktop'),
]

const MAX_DEPTH = 5

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/**
 * Splits "PyCharm Community Edition 2024.1" into useful search tokens.
 *
 * `target` is only mined when the shortcut launches the application itself.
 * Start menus are full of document shortcuts ("drivedb.h (view)") that point at
 * an editor with arguments; inheriting the editor's name would make every one
 * of them answer to "notepad".
 */
function keywordsFor(name: string, target?: string): string[] {
  const out = new Set<string>()
  if (target) {
    const base = path.basename(target, path.extname(target))
    if (base && base.toLowerCase() !== name.toLowerCase()) out.add(base)
    // The publisher folder is often how people think of an app ("JetBrains").
    const parent = path.basename(path.dirname(target))
    if (parent && !/^(bin|bin64|x64|win32|release|app|current)$/i.test(parent)) out.add(parent)
  }
  // Acronym of the words, so "vsc" can find "Visual Studio Code". Two-letter
  // acronyms match far too much to be worth indexing.
  const words = name.split(/[\s\-_]+/).filter(Boolean)
  if (words.length > 2) out.add(words.map((w) => w[0]).join(''))
  return [...out]
}

async function walk(dir: string, depth = 0, acc: string[] = []): Promise<string[]> {
  if (depth > MAX_DEPTH) return acc
  let entries: fs.Dirent[]
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) await walk(full, depth + 1, acc)
    else acc.push(full)
  }
  return acc
}

function runPowerShell(script: string, timeoutMs = 25_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout) => (err && !stdout ? reject(err) : resolve(stdout)),
    )
  })
}

class AppIndex extends EventEmitter {
  private entries: AppEntry[] = []
  private cacheFile = ''
  private indexing = false
  private watchers: fs.FSWatcher[] = []
  private rescanTimer: NodeJS.Timeout | null = null
  private builtAt = 0

  get all(): AppEntry[] {
    return this.entries
  }

  stats(): IndexStats {
    const byKind: Record<string, number> = {}
    for (const e of this.entries) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1
    return { total: this.entries.length, byKind, builtAt: this.builtAt }
  }

  async init() {
    this.cacheFile = path.join(app.getPath('userData'), 'appindex.json')
    // Serve a stale index immediately, then refresh in the background so the
    // first Alt+Space after boot is never empty.
    this.loadCache()
    void this.rebuild()
    this.watchFolders()
  }

  private loadCache() {
    try {
      if (fs.existsSync(this.cacheFile)) {
        this.entries = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8').replace(/^\uFEFF/, ''))
        this.emit('updated', this.entries.length)
      }
    } catch {
      /* a corrupt cache just means a cold first index */
    }
  }

  private saveCache() {
    try {
      fs.writeFileSync(this.cacheFile, JSON.stringify(this.entries), 'utf8')
    } catch (err) {
      console.error('[index] cache write failed:', err)
    }
  }

  async rebuild(): Promise<number> {
    if (this.indexing) return this.entries.length
    this.indexing = true
    const started = Date.now()
    try {
      const [shortcuts, uwp] = await Promise.all([this.scanShortcuts(), this.scanUwp()])
      const merged = new Map<string, AppEntry>()
      // UWP first so a Store app wins over a duplicate Start-menu shortcut.
      for (const e of [...uwp, ...shortcuts]) {
        const key = e.name.toLowerCase()
        if (!merged.has(key)) merged.set(key, e)
      }
      this.entries = [...merged.values()]
      this.builtAt = Date.now()
      this.saveCache()
      console.log('[index] ' + this.entries.length + ' apps in ' + (Date.now() - started) + 'ms')
      this.emit('updated', this.entries.length)
      return this.entries.length
    } catch (err) {
      console.error('[index] rebuild failed:', err)
      return this.entries.length
    } finally {
      this.indexing = false
    }
  }

  private excluded(name: string): boolean {
    const lower = name.toLowerCase()
    return settings.get().excludePatterns.some((p) => p && lower.includes(p.toLowerCase()))
  }

  private async scanShortcuts(): Promise<AppEntry[]> {
    const dirs = [...START_MENU_DIRS, ...DESKTOP_DIRS, ...settings.get().extraAppFolders].filter(Boolean)
    const files = (await Promise.all(dirs.map((d) => walk(d)))).flat()
    const out: AppEntry[] = []

    for (const file of files) {
      const ext = path.extname(file).toLowerCase()
      if (ext !== '.lnk' && ext !== '.url' && ext !== '.exe') continue
      const name = path.basename(file, ext)
      if (this.excluded(name)) continue

      if (ext === '.lnk') {
        let target = ''
        let args = ''
        let description: string | undefined
        try {
          const link = shell.readShortcutLink(file)
          target = link.target ?? ''
          args = link.args ?? ''
          description = link.description
        } catch {
          /* broken shortcut - still launchable through the shell */
        }
        // Skip shortcuts to uninstallers and installers dressed up as apps.
        if (target && /uninst|setup\.exe$/i.test(target)) continue
        if (target && path.extname(target).toLowerCase() === '.exe' && !fs.existsSync(target)) continue
        out.push({
          id: 'app:' + slug(name) + ':' + slug(path.basename(target || file)),
          name,
          // Arguments mean this opens a document, not the app itself.
          keywords: keywordsFor(name, args ? undefined : target || file),
          kind: 'lnk',
          launch: file,
          exePath: target || undefined,
          iconPath: target ? target + '|' + file : file,
          subtitle: description?.trim() || target || file,
        })
      } else if (ext === '.url') {
        let url = ''
        try {
          const body = fs.readFileSync(file, 'utf8')
          url = /^URL=(.*)$/m.exec(body)?.[1]?.trim() ?? ''
        } catch {
          continue
        }
        if (!url) continue
        out.push({
          id: 'url:' + slug(name),
          name,
          keywords: keywordsFor(name),
          kind: 'url',
          launch: url,
          subtitle: url,
        })
      } else {
        out.push({
          id: 'app:' + slug(name) + ':exe',
          name,
          keywords: keywordsFor(name, file),
          kind: 'exe',
          launch: file,
          exePath: file,
          iconPath: file,
          subtitle: file,
        })
      }
    }
    return out
  }

  private async scanUwp(): Promise<AppEntry[]> {
    try {
      const stdout = await runPowerShell(UWP_SCRIPT)
      // Spawned from a GUI process, powershell.exe may still print a banner
      // ahead of the payload; start parsing at the first JSON delimiter.
      const start = stdout.search(/[[{]/)
      const text = start >= 0 ? stdout.slice(start).trim() : ''
      if (!text) return []
      const parsed = JSON.parse(text)
      const list: Array<{ Name: string; AppID: string; Logo: string | null }> = Array.isArray(parsed)
        ? parsed
        : [parsed]
      return list
        .filter((a) => a?.Name && a?.AppID && !this.excluded(a.Name))
        .map((a) => ({
          id: 'uwp:' + a.AppID,
          name: a.Name,
          keywords: keywordsFor(a.Name),
          kind: 'uwp' as const,
          launch: a.AppID,
          iconPath: a.Logo ?? undefined,
          subtitle: 'Store app',
        }))
    } catch (err) {
      console.error('[index] UWP scan failed:', err)
      return []
    }
  }

  /** Re-index when programs are installed or removed. */
  private watchFolders() {
    for (const dir of [...START_MENU_DIRS, ...DESKTOP_DIRS]) {
      try {
        if (!fs.existsSync(dir)) continue
        const w = fs.watch(dir, { recursive: true }, () => {
          if (this.rescanTimer) clearTimeout(this.rescanTimer)
          this.rescanTimer = setTimeout(() => void this.rebuild(), 5000)
        })
        this.watchers.push(w)
      } catch {
        /* recursive watch is unavailable on some volumes; skip quietly */
      }
    }
  }

  dispose() {
    for (const w of this.watchers) w.close()
    this.watchers = []
  }
}

export const appIndex = new AppIndex()
