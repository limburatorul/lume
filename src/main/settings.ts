import { app } from 'electron'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import type { Config } from '../shared/types.js'

/**
 * Reads JSON written by anything, including editors and PowerShell redirects
 * that prepend a UTF-8 byte order mark. JSON.parse rejects a leading BOM.
 */
function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
}

export const DEFAULT_CONFIG: Config = {
  hotkey: 'Alt+Space',
  hideOnBlur: true,
  showAtTopmost: true,
  lastQueryMode: 'empty',
  searchDelay: 0,

  colorScheme: 'fixed',
  theme: 'default',
  themeLight: 'light',
  backdrop: 'acrylic',
  useDropShadow: true,
  useAnimation: true,
  animationSpeed: 120,
  windowWidth: 640,
  maxResults: 8,
  verticalAnchor: 0.28,
  searchWindowScreen: 'cursor',
  showPlaceholder: true,
  // Plain ASCII on purpose: config.json is UTF-8 without a BOM, and Windows
  // tools that assume ANSI would mangle a non-ASCII default on a round trip.
  placeholder: 'Search',
  ui: {
    // Frosted glass by default: the Windows backdrop supplies the blur, this
    // alpha supplies the body. Below ~0.5 the surface stops reading as a panel.
    surfaceOpacity: 0.82,
    cornerRadius: null,
    rowHeight: null,
    iconSize: null,
    queryFontSize: null,
    resultFontSize: null,
    resultSubFontSize: null,
    fontFamily: null,
  },

  launchOnStartup: false,
  hideOnStartup: true,
  showTrayIcon: true,
  checkForUpdates: true,

  extraAppFolders: [],
  excludePatterns: ['uninstall', 'readme', 'help', 'license', 'documentation', 'website'],
  searchEngines: [
    { keyword: 'g', name: 'Google', url: 'https://www.google.com/search?q={q}', glyph: '🔎' },
    { keyword: 'yt', name: 'YouTube', url: 'https://www.youtube.com/results?search_query={q}', glyph: '▶' },
    { keyword: 'gh', name: 'GitHub', url: 'https://github.com/search?q={q}', glyph: '🐙' },
    { keyword: 'so', name: 'Stack Overflow', url: 'https://stackoverflow.com/search?q={q}', glyph: '💬' },
    { keyword: 'wiki', name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search={q}', glyph: '📖' },
    { keyword: 'npm', name: 'npm', url: 'https://www.npmjs.com/search?q={q}', glyph: '📦' },
    { keyword: 'mdn', name: 'MDN', url: 'https://developer.mozilla.org/en-US/search?q={q}', glyph: '📘' },
    { keyword: 'dex', name: 'DEX', url: 'https://dexonline.ro/definitie/{q}', glyph: '🇷🇴' },
  ],
  defaultEngine: 'g',
  shellPrefix: '>',
  shell: 'powershell',
  frecencyWeight: 0.35,
}

/** Renames and reshapes settings written by an older version. */
function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  const out = { ...raw }
  if ('followCursorScreen' in out && !('searchWindowScreen' in out)) {
    out.searchWindowScreen = out.followCursorScreen ? 'cursor' : 'primary'
    delete out.followCursorScreen
  }
  // colorScheme used to name a colour; it now names a strategy. A saved
  // 'light' meant "always use themeLight", which is just a fixed theme.
  if (out.colorScheme === 'light') {
    out.colorScheme = 'fixed'
    if (out.themeLight) out.theme = out.themeLight
  } else if (out.colorScheme === 'dark') {
    out.colorScheme = 'fixed'
  }
  return out
}

class Settings extends EventEmitter {
  private data: Config = structuredClone(DEFAULT_CONFIG)
  private file = ''
  private saving = false

  init() {
    this.file = path.join(app.getPath('userData'), 'config.json')
    this.load()
    this.watch()
  }

  get(): Config {
    return this.data
  }

  get filePath() {
    return this.file
  }

  private load() {
    try {
      if (fs.existsSync(this.file)) {
        const onDisk = readJson(this.file)
        const raw = migrate(onDisk)
        const migrated = JSON.stringify(raw) !== JSON.stringify(onDisk)
        // Merge so a config written by an older version keeps working, and so
        // newly added keys appear with their defaults rather than undefined.
        this.data = {
          ...structuredClone(DEFAULT_CONFIG),
          ...raw,
          ui: { ...DEFAULT_CONFIG.ui, ...((raw.ui as object) ?? {}) },
        } as Config
        // Write the upgraded shape back, so the file on disk matches what the
        // app is actually using rather than migrating again on every start.
        if (migrated) this.persist()
      } else {
        this.data = structuredClone(DEFAULT_CONFIG)
        this.persist()
      }
    } catch (err) {
      console.error('[settings] failed to read config, using defaults:', err)
      this.data = structuredClone(DEFAULT_CONFIG)
    }
  }

  update(patch: Partial<Config>) {
    this.data = {
      ...this.data,
      ...patch,
      ui: { ...this.data.ui, ...(patch.ui ?? {}) },
    }
    this.persist()
    this.emit('changed', this.data)
  }

  reset() {
    this.data = structuredClone(DEFAULT_CONFIG)
    this.persist()
    this.emit('changed', this.data)
  }

  private persist() {
    this.saving = true
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8')
    } catch (err) {
      console.error('[settings] failed to write config:', err)
    }
    setTimeout(() => (this.saving = false), 250)
  }

  /** Picks up edits made to config.json by hand. */
  private watch() {
    try {
      fs.watch(path.dirname(this.file), (_e, name) => {
        if (name !== 'config.json' || this.saving) return
        setTimeout(() => {
          const before = JSON.stringify(this.data)
          this.load()
          if (JSON.stringify(this.data) !== before) this.emit('changed', this.data)
        }, 60)
      })
    } catch {
      /* watching is a convenience; failure here is not fatal */
    }
  }
}

export const settings = new Settings()
