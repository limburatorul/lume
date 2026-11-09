import { app, BrowserWindow, nativeTheme, screen } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MaterialMode } from '../shared/types.js'
import { materialMode, polishFrame } from './material.js'
import { settings } from './settings.js'
import { themes } from './themes.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const RENDERER = path.resolve(here, '..', 'renderer', 'index.html')
const PRELOAD = path.resolve(here, '..', 'preload', 'index.cjs')

const INITIAL_HEIGHT = 64

/*
 * Room left around the panel when nothing is drawing a system shadow, so the
 * CSS shadow has somewhere to paint. A transparent window clips ink outside
 * its client area, and its native shadow is a gray rectangle that ignores the
 * rounded corners. These are the body's padding in base.css: 16+36 and 22+22.
 */
const CLEAR_PAD_X = 44
const CLEAR_PAD_Y = 52

// Set as the app quits, so only then does the launcher's window really close.
let quitting = false
app.on('before-quit', () => (quitting = true))

export class LauncherWindow {
  win: BrowserWindow | null = null
  private ready = false
  /** What the live window was built as. Changing it means building another. */
  private mode: MaterialMode = 'native'
  /** Border colour last handed to DWM, so dragging a slider does not respawn PowerShell. */
  private frameKey = ''
  private presentQueued = false

  create() {
    const cfg = settings.get()
    this.ready = false
    this.mode = materialMode(cfg.backdrop)
    this.frameKey = ''
    const native = this.mode === 'native'
    const clear = this.mode === 'clear'

    this.win = new BrowserWindow({
      width: this.frameWidth(),
      height: INITIAL_HEIGHT + this.gutterY(),
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: cfg.showAtTopmost,
      /*
       * A system backdrop is drawn by DWM behind an opaque-flagged window.
       * Only "no material" is a transparent window, so the theme's own alpha
       * can show the desktop. The fallback stays opaque on purpose: before
       * Windows 11 22H2, and when transparency effects are off, DWM paints a
       * flat gray and a translucent tint over that gray looks muddy.
       */
      transparent: clear,
      backgroundColor: clear || native ? '#00000000' : this.fallbackColor(),
      backgroundMaterial: native ? cfg.backdrop : undefined,
      roundedCorners: true,
      hasShadow: clear ? false : cfg.useDropShadow,
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
      // Captured, so a window we just destroyed cannot hide the one that replaced it.
      if (this.win !== win || win.isDestroyed()) return
      if (settings.get().hideOnBlur && !win.webContents.isDevToolsOpened()) this.hide()
    })

    this.win.webContents.on('did-finish-load', () => {
      this.ready = true
    })

    // Never let the launcher navigate; external links go to the real browser.
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    void this.win.loadFile(RENDERER, {
      query: {
        material: this.mode,
        backdrop: cfg.backdrop,
        shadow: cfg.useDropShadow ? 'on' : 'off',
        animate: cfg.useAnimation ? 'true' : 'false',
      },
    })
    return this.win
  }

  /**
   * Applies config changes to the live window. The transparent flag and whether
   * DWM draws a backdrop can only be chosen at construction, so moving between
   * a native material, the solid fallback and a clear window rebuilds it.
   */
  applyConfig(): boolean {
    if (!this.win) return false
    const cfg = settings.get()
    const next = materialMode(cfg.backdrop)

    if (next !== this.mode) {
      const wasVisible = this.win.isVisible()
      this.ready = false
      this.presentQueued = false
      this.win.destroy()
      this.win = null
      this.create()
      if (wasVisible) this.show()
      return true
    }

    if (next === 'native') this.win.setBackgroundMaterial(cfg.backdrop)
    this.win.setHasShadow(next === 'clear' ? false : cfg.useDropShadow)
    this.win.setAlwaysOnTop(cfg.showAtTopmost, cfg.showAtTopmost ? 'screen-saver' : 'normal')
    const [x, y] = this.win.getPosition()
    const [w, h] = this.win.getSize()
    const width = this.frameWidth()
    // Keep the panel centred when the shadow gutter appears or goes away.
    this.win.setBounds({ x: x + Math.round((w - width) / 2), y, width, height: h }, false)
    this.syncFrame()
    return false
  }

  /** Horizontal padding around a clear window, so its CSS shadow is not clipped. */
  private gutterX() {
    return this.mode === 'clear' && settings.get().useDropShadow ? CLEAR_PAD_X : 0
  }

  private gutterY() {
    return this.mode === 'clear' && settings.get().useDropShadow ? CLEAR_PAD_Y : 0
  }

  private frameWidth() {
    return settings.get().windowWidth + this.gutterX()
  }

  /** Covers the first frame. The page paints the real theme colour over it. */
  private fallbackColor() {
    return nativeTheme.shouldUseDarkColors ? '#141418' : '#f6f6f8'
  }

  private frameIsLight() {
    const cfg = settings.get()
    const name = cfg.colorScheme === 'system' && !nativeTheme.shouldUseDarkColors ? cfg.themeLight : cfg.theme
    const css = themes.css(name)
    const match = css.match(/--surface-rgb:\s*(\d+)\s+(\d+)\s+(\d+)/)
    if (!match) return !nativeTheme.shouldUseDarkColors
    const r = Number(match[1])
    const g = Number(match[2])
    const b = Number(match[3])
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 160
  }

  private syncFrame() {
    if (!this.win || this.mode === 'clear') return
    const light = this.frameIsLight()
    const key = (light ? 'light' : 'dark') + ':' + this.mode
    if (key === this.frameKey) return
    this.frameKey = key
    polishFrame(this.win.getNativeWindowHandle(), light)
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
    const cap = 900 + this.gutterY()
    const min = INITIAL_HEIGHT + this.gutterY()
    const clamped = Math.max(min, Math.min(Math.round(height), cap))
    const [w, current] = this.win.getSize()
    const width = this.frameWidth()
    if (current === clamped && w === width) return
    // Grow downward from the anchored top edge instead of re-centring.
    const [x, y] = this.win.getPosition()
    this.win.setBounds({ x, y, width, height: clamped }, false)
  }

  show() {
    if (!this.win || this.win.isDestroyed()) {
      this.presentQueued = false
      this.create()
    } else if (materialMode(settings.get().backdrop) !== this.mode) {
      // Transparency effects can be toggled while Lume is running. The next
      // summon rebuilds into whichever surface the OS will actually draw.
      this.ready = false
      this.presentQueued = false
      this.win.destroy()
      this.win = null
      this.create()
    }
    const win = this.win!
    const present = () => {
      this.presentQueued = false
      if (!this.win || this.win.isDestroyed()) return
      this.position()
      this.win.showInactive()
      if (settings.get().showAtTopmost) this.win.setAlwaysOnTop(true, 'screen-saver')
      this.win.focus()
      // DWM drops the backdrop while the window is hidden, and the first frame
      // back is a flat gray until the material is set on a window that is showing.
      if (this.mode === 'native') this.win.setBackgroundMaterial(settings.get().backdrop)
      this.syncFrame()
      this.win.webContents.send('window:shown')
    }
    if (!this.ready) {
      if (this.presentQueued) return
      this.presentQueued = true
      win.once('ready-to-show', present)
      return
    }
    present()
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
