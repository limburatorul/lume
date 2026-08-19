import { app } from 'electron'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ThemeInfo } from '../shared/types.js'

const here = path.dirname(fileURLToPath(import.meta.url))
/** dist/main -> dist/themes, the copy bundled with the build. */
const BUNDLED_DIR = path.resolve(here, '..', 'themes')
/** dist/main -> <repo>/themes, the working copy used while developing. */
const SOURCE_DIR = path.resolve(here, '..', '..', 'themes')

class Themes extends EventEmitter {
  dir = ''
  private debounce: NodeJS.Timeout | null = null

  init() {
    // Installed: themes live in the user profile and survive upgrades.
    // Running from source: edit the repo's themes/ directly, so a save is
    // immediately visible instead of being shadowed by a seeded copy.
    if (app.isPackaged || !fs.existsSync(SOURCE_DIR)) {
      this.dir = path.join(app.getPath('userData'), 'themes')
      fs.mkdirSync(this.dir, { recursive: true })
      this.seed()
    } else {
      this.dir = SOURCE_DIR
    }
    this.watch()
  }

  /**
   * Installs the bundled themes into the user folder and, crucially, keeps them
   * up to date across upgrades.
   *
   * Only copying files that do not exist yet leaves stale built-ins behind: a
   * theme shipped before a change to base.css keeps referring to properties the
   * UI no longer reads, and settings that drive those properties silently stop
   * working. So a built-in is rewritten whenever the copy on disk is still the
   * one this app wrote. `.builtin.json` records the hash of each file we wrote,
   * which is what distinguishes "untouched" from "the user edited this".
   */
  private seed() {
    if (!fs.existsSync(BUNDLED_DIR)) return
    const manifestFile = path.join(this.dir, '.builtin.json')

    let manifest: Record<string, string> = {}
    let hadManifest = false
    try {
      manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8').replace(/^\uFEFF/, ''))
      hadManifest = true
    } catch {
      /* first run of a version that tracks this */
    }

    const hash = (text: string) => createHash('sha1').update(text).digest('hex')
    const kept: string[] = []

    for (const file of fs.readdirSync(BUNDLED_DIR)) {
      if (!file.endsWith('.css')) continue
      const dest = path.join(this.dir, file)
      const bundled = fs.readFileSync(path.join(BUNDLED_DIR, file), 'utf8')
      const bundledHash = hash(bundled)

      if (!fs.existsSync(dest)) {
        fs.writeFileSync(dest, bundled, 'utf8')
        manifest[file] = bundledHash
        continue
      }

      const current = fs.readFileSync(dest, 'utf8')
      const currentHash = hash(current)
      if (currentHash === bundledHash) {
        manifest[file] = bundledHash
        continue
      }

      // Without a manifest we cannot know whether an older build wrote this
      // file or the user did, so fall back to timestamps: a file never written
      // since it was created is still ours.
      let untouched: boolean
      if (hadManifest && manifest[file] !== undefined) {
        untouched = manifest[file] === currentHash
      } else {
        try {
          const s = fs.statSync(dest)
          untouched = s.mtimeMs - s.birthtimeMs < 2000
        } catch {
          untouched = false
        }
      }

      if (untouched) {
        fs.writeFileSync(dest, bundled, 'utf8')
        manifest[file] = bundledHash
      } else {
        kept.push(file)
      }
    }

    if (kept.length) {
      console.log('[themes] keeping your edited copies of: ' + kept.join(', '))
    }
    try {
      fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), 'utf8')
    } catch (err) {
      console.error('[themes] could not record built-in theme versions:', err)
    }
  }

  list(): ThemeInfo[] {
    try {
      return fs
        .readdirSync(this.dir)
        .filter((f) => f.endsWith('.css'))
        .map((f) => ({ name: path.basename(f, '.css'), file: path.join(this.dir, f) }))
        .sort((a, b) => a.name.localeCompare(b.name))
    } catch {
      return []
    }
  }

  css(name: string): string {
    const file = path.join(this.dir, `${name}.css`)
    try {
      return fs.readFileSync(file, 'utf8')
    } catch {
      const fallback = path.join(this.dir, 'default.css')
      try {
        return fs.readFileSync(fallback, 'utf8')
      } catch {
        return ''
      }
    }
  }

  /** Hot reload: any .css write in the themes folder re-pushes CSS to the window. */
  private watch() {
    try {
      fs.watch(this.dir, (_event, name) => {
        if (!name || !name.endsWith('.css')) return
        if (this.debounce) clearTimeout(this.debounce)
        this.debounce = setTimeout(() => this.emit('changed', path.basename(name, '.css')), 80)
      })
    } catch (err) {
      console.error('[themes] watch failed:', err)
    }
  }
}

export const themes = new Themes()
