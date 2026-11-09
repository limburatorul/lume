import { app, BrowserWindow, nativeTheme, screen } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MaterialMode } from '../shared/types.js'
import { materialMode, materialReport } from './material.js'
import { settings } from './settings.js'

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

/**
 * Focus is still moving for a moment after the window is shown: the hotkey
 * that summoned it, a second instance exiting, or a DWM call. Hiding on that
 * blur is what made the launcher flash and vanish, including on Alt+Space.
 */
const SHOW_GRACE_MS = 500

/** Console plus userData/material.log — the shot script starts Electron with stdio ignored. */
function note(line: string) {
  console.log(line)
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'material.log'), new Date().toISOString() + ' ' + line + '\n')
  } catch (err) {
    console.error('[material] could not write material.log:', err)
  }
}

export class LauncherWindow {
  win: BrowserWindow | null = null
  private ready = false
  /** What the live window was built as. Changing it means building another. */
  private mode: MaterialMode = 'native'
  private presentQueued = false
  /** When the window was last shown, so a blur in the grace window does not hide it. */
  private shownAt = 0

  create() {
    const cfg = settings.get()
    this.ready = false
    this.mode = materialMode(cfg.backdrop)
    note(materialReport(cfg.backdrop))
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
      if (!settings.get().hideOnBlur || win.webContents.isDevToolsOpened()) return
      const age = Date.now() - this.shownAt
      if (this.shownAt && age >= 0 && age < SHOW_GRACE_MS) {
        note(`[window] blur ${age}ms after show, not hiding`)
        return
      }
      this.hide('blur')
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

    if (next === 'native') {
      // Same constraint as show(): the backdrop has to be attached while the
      // window is hidden, or Windows 11 24H2/25H2 clears the client area.
      const wasVisible = this.win.isVisible()
      if (wasVisible) this.hide('material change')
      this.win.setBackgroundMaterial(cfg.backdrop)
      if (wasVisible) this.show()
    }
    this.win.setHasShadow(next === 'clear' ? false : cfg.useDropShadow)
    this.raise()
    const [x, y] = this.win.getPosition()
    const [w, h] = this.win.getSize()
    const width = this.frameWidth()
    // Keep the panel centred when the shadow gutter appears or goes away.
    this.win.setBounds({ x: x + Math.round((w - width) / 2), y, width, height: h }, false)
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

  /**
   * Screen-saver stays above the shot script’s fullscreen backdrop, which
   * re-asserts a lower topmost band on a timer. Anything that touches DWM
   * can knock us out of that band, so this is called again shortly after show.
   */
  private raise() {
    if (!this.win) return
    const top = settings.get().showAtTopmost
    this.win.setAlwaysOnTop(top, top ? 'screen-saver' : 'normal')
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
      this.shownAt = Date.now()
      this.win.showInactive()
      this.win.focus()
      /*
       * The backdrop material is set when the window is created, and not again
       * here. On Windows 11 24H2/25H2, setBackgroundMaterial on a window that
       * is already visible clears the client area — the panel flashes opaque,
       * then vanishes — and a following DWM border-colour change does the same
       * to the acrylic. The constructor’s material is what actually draws.
       */
      this.raise()
      note(`[window] show ${this.mode} ${settings.get().backdrop}`)
      this.win.webContents.send('window:shown')
      const shown = this.win
      setTimeout(() => {
        if (this.win !== shown || shown.isDestroyed() || !shown.isVisible()) return
        this.raise()
      }, 700)
    }
    if (!this.ready) {
      if (this.presentQueued) return
      this.presentQueued = true
      win.once('ready-to-show', present)
      return
    }
    present()
  }

  hide(reason = 'hide') {
    if (!this.win || !this.win.isVisible()) return
    note('[window] hide (' + reason + ')')
    this.win.webContents.send('window:hidden')
    this.win.hide()
  }

  toggle() {
    if (!this.win) return this.show()
    if (this.win.isVisible() && this.win.isFocused()) this.hide('toggle')
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
