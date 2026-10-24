import { app, BrowserWindow, screen } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { settings } from './settings.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const RENDERER = path.resolve(here, '..', 'renderer', 'index.html')
const PRELOAD = path.resolve(here, '..', 'preload', 'index.cjs')

const INITIAL_HEIGHT = 64

// Set as the app quits, so only then does the launcher's window really close.
let quitting = false
app.on('before-quit', () => (quitting = true))

export class LauncherWindow {
  win: BrowserWindow | null = null
  private ready = false
  /** Whether the live window was built for a system backdrop or a plain one. */
  private builtWithBackdrop = false

  create() {
    const cfg = settings.get()
    const useBackdrop = cfg.backdrop !== 'none'
    this.builtWithBackdrop = useBackdrop

    this.win = new BrowserWindow({
      width: cfg.windowWidth,
      height: INITIAL_HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: cfg.showAtTopmost,
      // A system backdrop is drawn by DWM behind an opaque-flagged window; a
      // plain window has to be transparent for the theme's own alpha to show.
      transparent: !useBackdrop,
      backgroundColor: '#00000000',
      backgroundMaterial: useBackdrop ? cfg.backdrop : undefined,
      roundedCorners: true,
      hasShadow: cfg.useDropShadow,
      /*
       * Load-bearing. thickFrame keeps WS_THICKFRAME on the frameless window,
       * and DWM refuses to draw either the backdrop material or the rounded
       * corners without it: setting this false produces an opaque rectangle
       * with square corners, no matter what backgroundMaterial says. The window
       * stays non-resizable through resizable:false, not by dropping the style.
       */
      thickFrame: true,
      webPreferences: {
        preload: PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        spellcheck: false,
        backgroundThrottling: false,
      },
    })

    if (cfg.showAtTopmost) {
      // Float above full-screen apps, matching what a launcher is expected to do.
      this.win.setAlwaysOnTop(true, 'screen-saver')
    }
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    this.win.setMenu(null)

    // Alt+F4 hides the launcher instead of destroying it (0.5.1): the hotkey then reached a destroyed window and threw
    // "Object has been destroyed". Should it close anyway, the next show builds a new one.
    this.win.on('close', (e) => {
      if (quitting) return
      e.preventDefault()
      this.hide()
    })
    const win = this.win
    win.on('closed', () => {
      // applyConfig replaces the window; the old one's late 'closed' must not drop the new one
      if (this.win !== win) return
      this.win = null
      this.ready = false
    })

    this.win.on('blur', () => {
      if (settings.get().hideOnBlur && !this.win?.webContents.isDevToolsOpened()) this.hide()
    })

    this.win.webContents.on('did-finish-load', () => {
      this.ready = true
    })

    // Never let the launcher navigate; external links go to the real browser.
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    void this.win.loadFile(RENDERER)
    return this.win
  }

  /**
   * Applies config changes to the live window. Switching a system backdrop on
   * or off changes whether the window must be transparent, which can only be
   * decided at construction, so that one case rebuilds the window.
   */
  applyConfig(): boolean {
    if (!this.win) return false
    const cfg = settings.get()
    const wantsBackdrop = cfg.backdrop !== 'none'

    if (wantsBackdrop !== this.builtWithBackdrop) {
      const wasVisible = this.win.isVisible()
      this.ready = false
      this.win.destroy()
      this.win = null
      this.create()
      if (wasVisible) this.win!.once('ready-to-show', () => this.show())
      return true
    }

    if (wantsBackdrop) this.win.setBackgroundMaterial(cfg.backdrop)
    this.win.setHasShadow(cfg.useDropShadow)
    this.win.setAlwaysOnTop(cfg.showAtTopmost, cfg.showAtTopmost ? 'screen-saver' : 'normal')
    const [, height] = this.win.getSize()
    this.win.setSize(cfg.windowWidth, height)
    return false
  }

  private targetDisplay() {
    switch (settings.get().searchWindowScreen) {
      case 'primary':
        return screen.getPrimaryDisplay()
      case 'focus': {
        const focused = BrowserWindow.getFocusedWindow()
        if (focused) return screen.getDisplayMatching(focused.getBounds())
        return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      }
      default:
        return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    }
  }

  position() {
    if (!this.win) return
    const cfg = settings.get()
    const { workArea } = this.targetDisplay()
    const [width, height] = this.win.getSize()
    const x = Math.round(workArea.x + (workArea.width - width) / 2)
    const y = Math.round(workArea.y + (workArea.height - height) * Math.max(0, Math.min(0.9, cfg.verticalAnchor)))
    this.win.setPosition(x, y, false)
  }

  setContentHeight(height: number) {
    if (!this.win) return
    const cfg = settings.get()
    const clamped = Math.max(INITIAL_HEIGHT, Math.min(Math.round(height), 900))
    const [w, current] = this.win.getSize()
    if (current === clamped && w === cfg.windowWidth) return
    // Grow downward from the anchored top edge instead of re-centring.
    const [x, y] = this.win.getPosition()
    this.win.setBounds({ x, y, width: cfg.windowWidth, height: clamped }, false)
  }

  show() {
    if (!this.win) {
      this.create().once('ready-to-show', () => this.show())
      return
    }
    this.position()
    this.win.showInactive()
    if (settings.get().showAtTopmost) this.win.setAlwaysOnTop(true, 'screen-saver')
    this.win.focus()
    this.win.webContents.send('window:shown')
  }

  hide() {
    if (!this.win || !this.win.isVisible()) return
    this.win.webContents.send('window:hidden')
    this.win.hide()
  }

  toggle() {
    if (!this.win) return this.show()
    if (this.win.isVisible() && this.win.isFocused()) this.hide()
    else this.show()
  }

  toggleDevTools() {
    if (!this.win) return
    const wc = this.win.webContents
    if (wc.isDevToolsOpened()) wc.closeDevTools()
    else wc.openDevTools({ mode: 'detach' })
  }

  send(channel: string, payload?: unknown) {
    if (this.ready) this.win?.webContents.send(channel, payload)
  }
}

export const launcherWindow = new LauncherWindow()
