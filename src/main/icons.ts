import { app, nativeImage } from 'electron'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

/**
 * Icons are resolved lazily: query results carry only an `iconKey` (the source
 * file path) and the renderer asks for the bitmap for the handful of rows it is
 * actually showing. Results are memoised in RAM and mirrored to disk so icon
 * extraction happens at most once per file per install.
 */

const ICON_SIZE = 48
const memory = new Map<string, string | null>()
let cacheDir = ''
const pending = new Map<string, Promise<string | null>>()

export function initIcons() {
  cacheDir = path.join(app.getPath('userData'), 'iconcache')
  fs.mkdirSync(cacheDir, { recursive: true })
}

function cachePath(key: string) {
  return path.join(cacheDir, createHash('sha1').update(key).digest('hex') + '.png')
}

function toDataUrl(buf: Buffer) {
  return 'data:image/png;base64,' + buf.toString('base64')
}

async function fromFile(file: string): Promise<Electron.NativeImage | null> {
  const ext = path.extname(file).toLowerCase()

  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.ico') {
    // UWP logos and loose image files can be read directly.
    try {
      const img = nativeImage.createFromPath(file)
      if (!img.isEmpty()) return img
    } catch {
      /* fall through to the shell */
    }
  }

  // .lnk / .exe: ask the shell for the icon Explorer would draw.
  try {
    const img = await app.getFileIcon(file, { size: 'large' })
    return img.isEmpty() ? null : img
  } catch {
    return null
  }
}

async function extract(key: string): Promise<string | null> {
  const disk = cachePath(key)
  try {
    const cached = await fsp.readFile(disk)
    if (cached.length > 0) return toDataUrl(cached)
  } catch {
    /* not cached yet */
  }

  let image: Electron.NativeImage | null = null
  // `key` may list several candidates, best first (e.g. "target.exe|link.lnk").
  for (const candidate of key.split('|')) {
    image = await fromFile(candidate)
    if (image) break
  }

  if (!image) return null

  const size = image.getSize()
  if (size.width > ICON_SIZE * 2) {
    image = image.resize({ width: ICON_SIZE * 2, height: ICON_SIZE * 2, quality: 'best' })
  }

  const png = image.toPNG()
  if (!png.length) return null
  fsp.writeFile(disk, png).catch(() => {})
  return toDataUrl(png)
}

export async function getIcon(key: string): Promise<string | null> {
  if (!key) return null
  if (memory.has(key)) return memory.get(key) ?? null
  // Collapse concurrent requests for the same icon into one extraction.
  let job = pending.get(key)
  if (!job) {
    job = extract(key)
      .catch(() => null)
      .then((result) => {
        memory.set(key, result)
        pending.delete(key)
        return result
      })
    pending.set(key, job)
  }
  return job
}

export function clearIconCache() {
  memory.clear()
  try {
    for (const f of fs.readdirSync(cacheDir)) fs.unlinkSync(path.join(cacheDir, f))
  } catch {
    /* nothing to clear */
  }
}
