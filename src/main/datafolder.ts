import fs from 'node:fs'
import path from 'node:path'

/**
 * Every studio app keeps its data in %APPDATA%\ProtagonistLabs\<App> (vault:
 * Ecosistem-v3-foldere.md). The installer moves the old folder; this is the same
 * move at start, for a silent update or an install made from another admin
 * account. It renames (same drive, instant) and never copies part of it: when
 * the new folder already has data nothing is mixed, and when a locked file
 * stops the rename this session keeps the old folder and the next start tries
 * again. Returns the folder to use. No Electron here, so `npm test` can run it.
 */
export function moveDataFolder(from: string, to: string): string {
  if (!fs.existsSync(from)) return to
  try {
    if (fs.readdirSync(to).length > 0) {
      console.warn(`[data] ${to} already has data, so ${from} stays where it is`)
      return to
    }
    fs.rmdirSync(to)
  } catch {
    // The new folder does not exist yet.
  }
  try {
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.renameSync(from, to)
    return to
  } catch (err) {
    console.error(`[data] could not move ${from} to ${to}; using it where it is until the next start:`, err)
    return from
  }
}
