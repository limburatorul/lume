/**
 * Dev helper: launches the app, runs a query and saves a PNG of the window.
 *   node scripts/screenshot.mjs out.png "pych"  [theme] [backdrop]
 * Handy for reviewing a theme without alt-tabbing.
 */
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const [out = 'shot.png', query = '', theme, backdrop] = process.argv.slice(2)
const configFile = path.join(os.homedir(), 'AppData', 'Roaming', 'Lume', 'config.json')

if (theme || backdrop) {
  const cfg = JSON.parse(readFileSync(configFile, 'utf8'))
  if (theme) cfg.theme = theme
  if (backdrop) cfg.backdrop = backdrop
  writeFileSync(configFile, JSON.stringify(cfg, null, 2))
}

const electron = path.join('node_modules', 'electron', 'dist', 'electron.exe')
const child = spawn(electron, ['.'], {
  env: { ...process.env, LUME_SCREENSHOT: path.resolve(out), LUME_SCREENSHOT_QUERY: query },
  stdio: 'inherit',
})
child.on('exit', (code) => process.exit(code ?? 0))
