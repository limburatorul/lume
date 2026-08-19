/**
 * Builds the README screenshots.
 *
 * The launcher's frosted glass only exists in the composited desktop, so
 * webContents.capturePage() cannot see it — these have to be real screen grabs.
 * To keep the author's actual desktop out of the pictures, a full-screen
 * backdrop window is drawn first and the launcher is captured over that.
 *
 *   node scripts/shots.mjs
 *
 * Requires the app to be reachable on the debugging port so the exact window
 * bounds can be read back and the grab cropped to the pixel.
 */
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const PORT = 9350
const OUT = 'docs/images'
const ELECTRON = path.join('node_modules', 'electron', 'dist', 'electron.exe')
const CONFIG = path.join(os.homedir(), 'AppData', 'Roaming', 'Lume', 'config.json')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** A calm, wallpaper-like backdrop with enough structure to show the blur. */
const BACKDROP = `data:text/html,${encodeURIComponent(`<style>
  html,body{margin:0;height:100%;overflow:hidden;background:#101016}
  .bg{position:absolute;inset:0;
    background:
      radial-gradient(60rem 40rem at 18% 22%, #3b2b7a 0%, transparent 60%),
      radial-gradient(50rem 36rem at 82% 30%, #0d5a6b 0%, transparent 62%),
      radial-gradient(46rem 40rem at 55% 88%, #7a2b4e 0%, transparent 60%),
      linear-gradient(160deg, #12121a 0%, #191926 55%, #101018 100%)}
  .ring{position:absolute;border-radius:50%;border:1.5px solid rgba(255,255,255,.07)}
  .r1{width:52rem;height:52rem;left:6%;top:-14%}
  .r2{width:38rem;height:38rem;right:8%;bottom:-12%}
  .r3{width:26rem;height:26rem;left:44%;top:26%}
  .grid{position:absolute;inset:0;opacity:.35;
    background-image:linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),
      linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px);
    background-size:64px 64px}
</style><div class="bg"></div><div class="grid"></div>
<div class="ring r1"></div><div class="ring r2"></div><div class="ring r3"></div>`)}`

function powershell(script) {
  return execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
  }).trim()
}

/** Top-left of the virtual desktop, which is where a full-screen grab starts. */
function virtualOrigin() {
  const out = powershell(
    'Add-Type -AssemblyName System.Windows.Forms;' +
      '$v=[System.Windows.Forms.SystemInformation]::VirtualScreen;"$($v.Left) $($v.Top)"',
  )
  const [left, top] = out.split(' ').map(Number)
  return { left, top }
}

function grabScreen(file) {
  powershell(
    'Add-Type -AssemblyName System.Windows.Forms,System.Drawing;' +
      '$b=[System.Windows.Forms.SystemInformation]::VirtualScreen;' +
      '$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height;' +
      '$g=[System.Drawing.Graphics]::FromImage($bmp);' +
      '$g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size);' +
      `$bmp.Save('${path.resolve(file)}',[System.Drawing.Imaging.ImageFormat]::Png);` +
      '$g.Dispose();$bmp.Dispose()',
  )
}

/** Evaluates an expression inside a debugging target and returns its value. */
async function evaluate(match, expression) {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
  const target = targets.find((t) => t.type === 'page' && (t.url.includes(match) || t.title.includes(match)))
  if (!target) throw new Error(`no debugging target matching "${match}"`)
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  const value = await new Promise((resolve, reject) => {
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.id === 1) resolve(msg.result?.result?.value)
    }
    ws.onerror = reject
    ws.send(
      JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true },
      }),
    )
  })
  ws.close()
  return value
}

/** Base64 PNG of a page's own contents, via the debugging protocol. */
async function capturePage(match) {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
  const target = targets.find((t) => t.type === 'page' && (t.url.includes(match) || t.title.includes(match)))
  if (!target) throw new Error(`no debugging target matching "${match}"`)
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  const data = await new Promise((resolve, reject) => {
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.id === 1) resolve(msg.result?.data)
    }
    ws.onerror = reject
    ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }))
  })
  ws.close()
  return data
}

/**
 * Window rectangle in physical pixels, relative to the grab's origin.
 * The default leaves a margin of backdrop around the window, which is what
 * gives the shots room to breathe on a README page.
 */
async function windowRect(match, origin, pad = 100) {
  const r = JSON.parse(
    await evaluate(
      match,
      'JSON.stringify({x:window.screenX,y:window.screenY,w:window.outerWidth,h:window.outerHeight,dpr:devicePixelRatio})',
    ),
  )
  const s = r.dpr
  return {
    left: Math.round((r.x - origin.left) * s) - pad,
    top: Math.round((r.y - origin.top) * s) - pad,
    width: Math.round(r.w * s) + pad * 2,
    height: Math.round(r.h * s) + pad * 2,
  }
}

function crop(src, dest, rect) {
  powershell(
    'Add-Type -AssemblyName System.Drawing;' +
      `$src=[System.Drawing.Image]::FromFile('${path.resolve(src)}');` +
      `$r=New-Object System.Drawing.Rectangle(${rect.left},${rect.top},${rect.width},${rect.height});` +
      '$out=New-Object System.Drawing.Bitmap $r.Width,$r.Height;' +
      '$g=[System.Drawing.Graphics]::FromImage($out);' +
      '$g.DrawImage($src,(New-Object System.Drawing.Rectangle(0,0,$r.Width,$r.Height)),$r,[System.Drawing.GraphicsUnit]::Pixel);' +
      `$out.Save('${path.resolve(dest)}',[System.Drawing.Imaging.ImageFormat]::Png);` +
      '$g.Dispose();$out.Dispose();$src.Dispose()',
  )
}

function patchConfig(patch) {
  const cfg = JSON.parse(readFileSync(CONFIG, 'utf8').replace(/^\uFEFF/, ''))
  const merged = { ...cfg, ...patch, ui: { ...cfg.ui, ...(patch.ui ?? {}) } }
  writeFileSync(CONFIG, JSON.stringify(merged, null, 2), 'utf8')
}

/**
 * Kills only the processes this script started. Killing every electron.exe
 * would take the backdrop window down with the launcher.
 */
const spawned = new Set()

function launch(args) {
  const child = spawn(ELECTRON, args, { detached: true, stdio: 'ignore' })
  spawned.add(child.pid)
  return child
}

function killLaunchers() {
  for (const pid of spawned) {
    try {
      execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' })
    } catch {
      /* already gone */
    }
    spawned.delete(pid)
  }
}

/* ----------------------------------------------------------------- script */

mkdirSync(OUT, { recursive: true })
const tmp = path.join(os.tmpdir(), 'lume-shot-full.png')
const origin = virtualOrigin()
const original = readFileSync(CONFIG, 'utf8')

// A backdrop window under everything, so no real desktop is ever captured.
// Electron has no -e flag, so the backdrop app is written out as a tiny script.
const backdropDir = path.join(os.tmpdir(), 'lume-backdrop')
mkdirSync(backdropDir, { recursive: true })
writeFileSync(
  path.join(backdropDir, 'package.json'),
  JSON.stringify({ name: 'lume-backdrop', main: 'main.cjs' }),
  'utf8',
)
writeFileSync(
  path.join(backdropDir, 'main.cjs'),
  [
    "const { app, BrowserWindow } = require('electron')",
    'app.whenReady().then(() => {',
    '  const w = new BrowserWindow({ fullscreen: true, frame: false, skipTaskbar: true })',
    // Above other topmost popups, but below the launcher's screen-saver level.
    "  w.setAlwaysOnTop(true, 'floating')",
    `  w.loadURL(${JSON.stringify(BACKDROP)})`,
    '})',
  ].join('\n'),
  'utf8',
)
const backdrop = spawn(ELECTRON, [backdropDir], { detached: true, stdio: 'ignore' })
await sleep(4500)

const SHOTS = [
  { file: 'launcher-default.png', config: { theme: 'default', ui: { surfaceOpacity: 0.78 } }, query: 'pych' },
  { file: 'launcher-carbon.png', config: { theme: 'carbon', ui: { surfaceOpacity: 1 } }, query: 'notep' },
  { file: 'launcher-light.png', config: { theme: 'light', ui: { surfaceOpacity: 0.9 } }, query: 'paint' },
  { file: 'launcher-calc.png', config: { theme: 'default', ui: { surfaceOpacity: 0.78 } }, query: 'sqrt(144) * 2 + 10%' },
  {
    file: 'launcher-actions.png',
    config: { theme: 'default', ui: { surfaceOpacity: 0.78 } },
    query: 'pych',
    after: 'document.dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",bubbles:true}))',
  },
]

for (const shot of SHOTS) {
  killLaunchers()
  await sleep(600)
  patchConfig({
    backdrop: 'acrylic',
    colorScheme: 'fixed',
    hideOnBlur: false,
    searchWindowScreen: 'primary',
    ...shot.config,
  })
  launch(['.', `--remote-debugging-port=${PORT}`])
  await sleep(7000)
  launch(['.']) // a second instance tells the running one to show its window
  await sleep(2500)

  await evaluate(
    'renderer',
    `(()=>{const i=document.getElementById('input');i.value=${JSON.stringify(shot.query)};` +
      `i.dispatchEvent(new Event('input'));})()`,
  )
  await sleep(900)
  if (shot.after) {
    await evaluate('renderer', shot.after)
    await sleep(600)
  }

  const rect = await windowRect('renderer', origin)
  grabScreen(tmp)
  crop(tmp, path.join(OUT, shot.file), rect)
  console.log('wrote', shot.file)
}

// The settings window has no transparency, so its page can be captured through
// the debugging protocol instead. That is pixel-exact and, unlike a screen grab,
// cannot pick up whatever happens to be behind or above it.
killLaunchers()
await sleep(600)
patchConfig({ theme: 'default', ui: { surfaceOpacity: 0.78 } })
launch(['.', '--settings', `--remote-debugging-port=${PORT}`])
await sleep(8000)
writeFileSync(path.join(OUT, 'settings.png'), Buffer.from(await capturePage('settings'), 'base64'))
console.log('wrote settings.png')

killLaunchers()
try {
  execFileSync('taskkill', ['/F', '/T', '/PID', String(backdrop.pid)], { stdio: 'ignore' })
} catch {
  /* already gone */
}
writeFileSync(CONFIG, original, 'utf8')
rmSync(tmp, { force: true })
rmSync(backdropDir, { recursive: true, force: true })
console.log('done — config restored')
