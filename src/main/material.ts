import { execFile, execFileSync } from 'node:child_process'
import type { Backdrop, MaterialMode } from '../shared/types.js'

/**
 * Windows 11 22H2. `backgroundMaterial` is a no-op on earlier builds: DWM
 * leaves a flat gray behind the window, and a translucent tint over that gray
 * is the muddy slab people see on Windows 10.
 */
const BACKDROP_BUILD = 22621

/** #45454f and #b9b9c2 as COLORREF (0x00BBGGRR), a hairline that matches the surface. */
const BORDER_DARK = 0x004f4545
const BORDER_LIGHT = 0x00c2b9b9

export function resolveMaterial(input: {
  platform: string
  build: number
  /**
   * null means the setting could not be read. That still tries the material:
   * a missed read is more common than transparency actually being switched off.
   */
  transparency: boolean | null
  backdrop: Backdrop
}): MaterialMode {
  if (input.backdrop === 'none') return 'clear'
  if (input.platform !== 'win32' || input.build < BACKDROP_BUILD) return 'fallback'
  if (input.transparency === false) return 'fallback'
  return 'native'
}

function systemVersion(): string {
  const get = (process as { getSystemVersion?: () => string }).getSystemVersion
  return typeof get === 'function' ? get() : ''
}

export function windowsBuild(): number {
  const build = Number(systemVersion().split('.')[2])
  return Number.isFinite(build) ? build : 0
}

let transparencyCache: { at: number; enabled: boolean } | null = null
let reading = false

function remember(enabled: boolean) {
  transparencyCache = { at: Date.now(), enabled }
}

/** Cold start only. Later reads are async so a hotkey never waits on the registry. */
function readTransparencySync(): boolean | null {
  try {
    const out = execFileSync(
      'reg',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', '/v', 'EnableTransparency'],
      { encoding: 'utf8', timeout: 1500, windowsHide: true },
    )
    const match = out.match(/0x([0-9a-f]+)/i)
    const enabled = match ? parseInt(match[1], 16) !== 0 : true
    remember(enabled)
    return enabled
  } catch (err) {
    console.error('[material] could not read EnableTransparency:', err)
    return null
  }
}

function refreshTransparency() {
  if (process.platform !== 'win32' || reading) return
  reading = true
  execFile(
    'reg',
    ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', '/v', 'EnableTransparency'],
    { encoding: 'utf8', timeout: 1500, windowsHide: true },
    (err, out) => {
      reading = false
      if (err || !out) {
        if (err) console.error('[material] could not read EnableTransparency:', err)
        return
      }
      const match = out.match(/0x([0-9a-f]+)/i)
      remember(match ? parseInt(match[1], 16) !== 0 : true)
    },
  )
}

/**
 * Personalization → Transparency effects. When this is off, acrylic and mica
 * draw as a flat color and a semi-transparent CSS layer on top looks dirty.
 */
export function transparencyEffectsEnabled(): boolean | null {
  if (process.platform !== 'win32') return null
  if (!transparencyCache) return readTransparencySync()
  if (Date.now() - transparencyCache.at > 30000) refreshTransparency()
  return transparencyCache.enabled
}

export function materialMode(backdrop: Backdrop): MaterialMode {
  return resolveMaterial({
    platform: process.platform,
    build: windowsBuild(),
    transparency: transparencyEffectsEnabled(),
    backdrop,
  })
}

/**
 * The stock DWM border on a frameless backdrop window is a light gray stroke.
 * On a dark panel that reads as a dirty frame. Recolour it to a hairline in
 * the surface's family. Best-effort: if PowerShell or DWM refuses, Windows
 * keeps its own border and the CSS edge still draws.
 */
export function polishFrame(hwnd: Buffer, light: boolean): void {
  if (process.platform !== 'win32') return
  if (windowsBuild() < 22000) return
  if (hwnd.length < 8) return
  const script = [
    "Add-Type -TypeDefinition @'",
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class LumeDwm {',
    '  [DllImport("dwmapi.dll")]',
    '  public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);',
    '}',
    "'@",
    '$ptr = [IntPtr]::new([Int64]$env:LUME_HWND)',
    '$color = [int]$env:LUME_BORDER',
    // 34 is DWMWA_BORDER_COLOR.
    '[void][LumeDwm]::DwmSetWindowAttribute($ptr, 34, [ref]$color, 4)',
  ].join('\n')
  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      windowsHide: true,
      env: {
        ...process.env,
        LUME_HWND: hwnd.readBigUInt64LE(0).toString(),
        LUME_BORDER: String(light ? BORDER_LIGHT : BORDER_DARK),
      },
    },
    (err) => {
      if (err) console.error('[material] could not restyle the window border:', err)
    },
  )
}
