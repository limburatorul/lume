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
  // 'iconcache' holds generic glyphs cached before pngFromExe existed.
  fs.rmSync(path.join(app.getPath('userData'), 'iconcache'), { recursive: true, force: true })
  cacheDir = path.join(app.getPath('userData'), 'icons')
  fs.mkdirSync(cacheDir, { recursive: true })
}

function cachePath(key: string) {
  return path.join(cacheDir, createHash('sha1').update(key).digest('hex') + '.png')
}

function toDataUrl(buf: Buffer) {
  return 'data:image/png;base64,' + buf.toString('base64')
}

const RT_ICON = 3
const RT_GROUP_ICON = 14

/**
 * Returns the largest PNG frame of an executable's main icon. Chromium's icon
 * reader, behind app.getFileIcon, draws the generic program glyph for icons
 * whose small frames are PNG - which is what electron-builder and most icon
 * generators emit - even though Explorer renders them fine. BMP-only icons
 * yield null here and are left to the shell.
 */
async function pngFromExe(file: string): Promise<Electron.NativeImage | null> {
  const fh = await fsp.open(file, 'r')
  try {
    const read = async (pos: number, len: number) => {
      const buf = Buffer.alloc(len)
      await fh.read(buf, 0, len, pos)
      return buf
    }
    const head = await read(0, 4096)
    const pe = head.readUInt32LE(0x3c)
    if (head.toString('latin1', pe, pe + 4) !== 'PE\0\0') return null
    const opt = pe + 24
    const rsrcRva = head.readUInt32LE(opt + (head.readUInt16LE(opt) === 0x20b ? 112 : 96) + 16)
    let section = opt + head.readUInt16LE(pe + 20)
    for (let i = head.readUInt16LE(pe + 6); i > 0; i--, section += 40) {
      const va = head.readUInt32LE(section + 12)
      const size = head.readUInt32LE(section + 16)
      if (rsrcRva < va || rsrcRva >= va + size) continue

      const rsrc = await read(head.readUInt32LE(section + 20), size)
      const base = rsrcRva - va
      const entries = (dir: number) =>
        Array.from({ length: rsrc.readUInt16LE(base + dir + 12) + rsrc.readUInt16LE(base + dir + 14) }, (_, n) => ({
          id: rsrc.readUInt32LE(base + dir + 16 + n * 8),
          to: rsrc.readUInt32LE(base + dir + 20 + n * 8),
        }))
      // Descends through the name and language levels, taking the first of each.
      const leaf = (to: number) => {
        while (to & 0x80000000) to = entries(to & 0x7fffffff)[0].to
        const at = rsrc.readUInt32LE(base + to) - va
        return rsrc.subarray(at, at + rsrc.readUInt32LE(base + to + 4))
      }
      const types = entries(0)
      const groups = types.find((e) => e.id === RT_GROUP_ICON)
      const icons = types.find((e) => e.id === RT_ICON)
      if (!groups || !icons) return null

      const group = leaf(groups.to)
      const frames = entries(icons.to & 0x7fffffff)
      let best: Buffer | null = null
      let bestWidth = 0
      for (let n = 0; n < group.readUInt16LE(4); n++) {
        const width = group[6 + n * 14] || 256
        const frame = frames.find((f) => f.id === group.readUInt16LE(6 + n * 14 + 12))
        if (!frame || width <= bestWidth) continue
        const data = leaf(frame.to)
        if (data.toString('hex', 0, 4) !== '89504e47') continue
        best = data
        bestWidth = width
      }
      return best && nativeImage.createFromBuffer(best)
    }
    return null
  } finally {
    await fh.close()
  }
}

async function fromFile(file: string): Promise<Electron.NativeImage | null> {
  const ext = path.extname(file).toLowerCase()

  if (ext === '.exe') {
    try {
      const img = await pngFromExe(file)
      if (img && !img.isEmpty()) return img
    } catch (err) {
      console.error('[icons] could not read icon resources of ' + file + ':', err)
    }
  }

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
