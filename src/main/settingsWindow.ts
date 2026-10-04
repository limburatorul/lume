import { BrowserWindow, nativeTheme } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const PAGE = path.resolve(here, '..', 'settings', 'index.html')
const PRELOAD = path.resolve(here, '..', 'preload', 'settings.cjs')
const ICON = path.resolve(here, '..', 'assets', 'icon.png')

let win: BrowserWindow | null = null

const TITLEBAR_HEIGHT = 44

/** Window-control colours, which have to be told about the theme by hand. */
function overlay() {
  const dark = nativeTheme.shouldUseDarkColors
  return {
    color: dark ? '#101015' : '#eeeef3',
    symbolColor: dark ? '#e6e6ee' : '#16161c',
    height: TITLEBAR_HEIGHT,
  }
}

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
    // The window keeps Windows' buttons and resizing, but draws its own title
    // strip, so settings look like the launcher rather than a stray dialog.
    titleBarStyle: 'hidden',
    titleBarOverlay: overlay(),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16161c' : '#f7f7fa',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.setMenu(null)
  // With the title bar hidden, 'ready-to-show' never arrives on Windows, so
  // the window would stay invisible waiting for it; a finished load is a good
  // enough moment, and backgroundColor covers the first frame.
  win.webContents.once('did-finish-load', () => win?.show())
  win.on('closed', () => (win = null))
  nativeTheme.on('updated', () => {
    if (win && !win.isDestroyed()) win.setTitleBarOverlay(overlay())
  })
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
