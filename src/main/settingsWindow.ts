import { app, BrowserWindow, nativeTheme } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const PAGE = path.resolve(here, '..', 'settings', 'index.html')
const WHATS_NEW = path.resolve(here, '..', 'whatsnew', 'index.html')
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
    if (whatsNew && !whatsNew.isDestroyed()) whatsNew.setTitleBarOverlay(overlay())
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  void win.loadFile(PAGE)
  return win
}

let whatsNew: BrowserWindow | null = null

/**
 * Every release, as the studio's other apps show it. Wide enough for the list
 * and a 960 x 170 banner at full size. The notes are bundled into the page,
 * so it needs no bridge: only the running version, to open on its release.
 */
export function openWhatsNew(onClosed?: () => void) {
  if (whatsNew && !whatsNew.isDestroyed()) {
    if (whatsNew.isMinimized()) whatsNew.restore()
    whatsNew.show()
    whatsNew.focus()
    return
  }

  whatsNew = new BrowserWindow({
    width: 1240,
    height: 720,
    minWidth: 700,
    minHeight: 420,
    show: false,
    title: 'What’s new — Lume',
    icon: ICON,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: overlay(),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16161c' : '#f7f7fa',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })

  whatsNew.setMenu(null)
  whatsNew.webContents.once('did-finish-load', () => whatsNew?.show())
  whatsNew.on('closed', () => {
    whatsNew = null
    onClosed?.()
  })
  whatsNew.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  void whatsNew.loadFile(WHATS_NEW, { query: { v: app.getVersion() } })
}

export function settingsWindow() {
  return win && !win.isDestroyed() ? win : null
}

export function notifySettings(channel: string, payload?: unknown) {
  const w = settingsWindow()
  if (w) w.webContents.send(channel, payload)
}
