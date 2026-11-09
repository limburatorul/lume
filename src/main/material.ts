import { execFile, execFileSync } from 'node:child_process'
import os from 'node:os'
import type { Backdrop, MaterialMode } from '../shared/types.js'

/**
 * Windows 11 22H2. `backgroundMaterial` is a no-op on earlier builds: DWM
 * leaves a flat gray behind the window, and a translucent tint over that gray
 * is the muddy slab people see on Windows 10.
 */
const BACKDROP_BUILD = 22621

export function describeMaterial(input: {
  platform: string
  build: number
  /** null means the setting could not be read. That still tries the material. */
  transparency: boolean | null
  backdrop: Backdrop
}): { mode: MaterialMode; reason: string } {
  if (input.backdrop === 'none') {
    return {
      mode: 'clear',
      reason: 'Background material is None, so the theme’s own alpha shows the desktop and nothing is blurred.',
    }
  }
  if (input.platform !== 'win32') {
    return {
      mode: 'fallback',
      reason: 'This is not Windows, so DWM cannot draw a backdrop. The panel is painted solid.',
    }
  }
  if (!(input.build >= BACKDROP_BUILD)) {
    return {
      mode: 'fallback',
      reason: `Windows build ${input.build || 'unknown'} is below ${BACKDROP_BUILD} (Windows 11 22H2). A system backdrop would be a flat gray, so the panel is painted solid.`,
    }
  }
  if (input.transparency === false) {
    return {
      mode: 'fallback',
      reason: 'Transparency effects are off in Windows settings. Acrylic and mica would be a flat gray, so the panel is painted solid.',
    }
  }
  const read =
    input.transparency === null
      ? 'The transparency setting could not be read, so the backdrop is tried anyway.'
      : 'Transparency effects are on.'
  return {
    mode: 'native',
    reason: `Windows build ${input.build} can draw a system backdrop. ${read} DWM draws ${input.backdrop}.`,
  }
}

/** @deprecated shape kept for the smoke tests; the reason lives on describeMaterial. */
export function resolveMaterial(input: {
  platform: string
  build: number
  transparency: boolean | null
  backdrop: Backdrop
}): MaterialMode {
  return describeMaterial(input).mode
}

function systemVersion(): string {
  const get = (process as { getSystemVersion?: () => string }).getSystemVersion
  return typeof get === 'function' ? get() : ''
}

function parseBuild(version: string): number {
  const n = Number(version.split('.')[2])
  return Number.isFinite(n) ? n : 0
}

let buildFacts: { system: string; release: string; registry: number; build: number } | null = null

/**
 * The highest build we can see. `getSystemVersion()` and `os.release()` follow
 * the exe’s compatibility shim and can report an older Windows than the one
 * that is running, which would force the solid fallback on a machine that can
 * draw acrylic. The registry value does not.
 */
export function windowsBuildFacts(): { system: string; release: string; registry: number; build: number } {
  if (buildFacts) return buildFacts
  const system = systemVersion()
  const release = os.release()
  let registry = 0
  if (process.platform === 'win32') {
    try {
      const out = execFileSync(
        'reg',
        ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion', '/v', 'CurrentBuild'],
        { encoding: 'utf8', timeout: 1500, windowsHide: true },
      )
      const match = out.match(/CurrentBuild\s+REG_\w+\s+(\d+)/i)
      registry = match ? Number(match[1]) : 0
    } catch (err) {
      console.error('[material] could not read CurrentBuild:', err)
    }
  }
  buildFacts = { system, release, registry, build: Math.max(parseBuild(system), parseBuild(release), registry) }
  return buildFacts
}

export function windowsBuild(): number {
  return windowsBuildFacts().build
}

let transparencyCache: { at: number; enabled: boolean; raw: string } | null = null
let reading = false

function parseTransparency(out: string): { enabled: boolean; raw: string } {
  const match = out.match(/EnableTransparency\s+REG_\w+\s+(\S+)/i)
  const raw = match?.[1] ?? ''
  if (!raw) return { enabled: true, raw: '(missing)' }
  const hex = raw.match(/^0x([0-9a-f]+)$/i)
  const value = hex ? parseInt(hex[1], 16) : Number(raw)
  // An unreadable number is not proof the effect is off.
  return { enabled: !Number.isFinite(value) || value !== 0, raw }
}

function remember(parsed: { enabled: boolean; raw: string }) {
  transparencyCache = { at: Date.now(), ...parsed }
}

/** Cold start only. Later reads are async so a hotkey never waits on the registry. */
function readTransparencySync(): boolean | null {
  try {
    const out = execFileSync(
      'reg',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', '/v', 'EnableTransparency'],
      { encoding: 'utf8', timeout: 1500, windowsHide: true },
    )
    const parsed = parseTransparency(out)
    remember(parsed)
    return parsed.enabled
  } catch (err) {
    console.error('[material] could not read EnableTransparency:', err)
    transparencyCache = { at: Date.now(), enabled: true, raw: '(unreadable)' }
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
      remember(parseTransparency(out))
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
  // A failed read stored enabled:true but materialReport wants null. The raw
  // "(unreadable)" is how the log distinguishes "on" from "could not read".
  if (transparencyCache.raw === '(unreadable)') return null
  return transparencyCache.enabled
}

export function materialMode(backdrop: Backdrop): MaterialMode {
  return describeMaterial({
    platform: process.platform,
    build: windowsBuild(),
    transparency: transparencyEffectsEnabled(),
    backdrop,
  }).mode
}

/** One line for the console and for material.log, including every input to the decision. */
export function materialReport(backdrop: Backdrop): string {
  const facts = windowsBuildFacts()
  const transparency = transparencyEffectsEnabled()
  const { mode, reason } = describeMaterial({
    platform: process.platform,
    build: facts.build,
    transparency,
    backdrop,
  })
  const trans = transparency === null ? 'unreadable' : transparency ? 'on' : 'off'
  const raw = transparencyCache?.raw ?? (process.platform === 'win32' ? '(none)' : 'n/a')
  return (
    `[material] ${mode} — backdrop ${backdrop}. ` +
    `build ${facts.build} (getSystemVersion=${facts.system || 'n/a'}, os.release=${facts.release}, CurrentBuild=${facts.registry || 'n/a'}). ` +
    `EnableTransparency=${raw} (${trans}). ${reason}`
  )
}
