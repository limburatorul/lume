import { BrowserWindow, nativeTheme } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const PAGE = path.resolve(here, '..', 'settings', 'index.html')
const PRELOAD = path.resolve(here, '..', 'preload', 'settings.cjs')
const ICON = path.resolve(here, '..', 'assets', 'icon.png')

let win: BrowserWindow | null = null

export function openSettings() {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    return win
  }

  win = new BrowserWindow({
    width: 880,
    height: 720,
    minWidth: 720,
    minHeight: 520,
    show: false,
    title: 'Lume Settings',
    icon: ICON,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16161c' : '#f7f7fa',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.setMenu(null)
  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => (win = null))
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  void win.loadFile(PAGE)
  return win
}

export function settingsWindow() {
  return win && !win.isDestroyed() ? win : null
}

export function notifySettings(channel: string, payload?: unknown) {
  const w = settingsWindow()
  if (w) w.webContents.send(channel, payload)
}
