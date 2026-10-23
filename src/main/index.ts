import {
  app,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  shell,
  systemPreferences,
  Tray,
} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Bootstrap, Config, ResultItem } from '../shared/types.js'
import { moveDataFolder } from './datafolder.js'
import { seeWhoHolds, toHotkeyScanCombo, worksWith, writeCard } from './ecosystem.js'
import { execute } from './executor.js'
import { clearIconCache, getIcon, initIcons } from './icons.js'
import { appIndex } from './indexer/apps.js'
import { sisterCounts } from './providers/sisters.js'
import { search } from './search/engine.js'
import { settings } from './settings.js'
import { notifySettings, openSettings, openWhatsNew, settingsWindow } from './settingsWindow.js'
import { usage } from './store.js'
import { themes } from './themes.js'
import { updater } from './updater.js'
import { launcherWindow } from './window.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const TRAY_ICON = path.resolve(here, '..', 'assets', 'tray.png')

/*
 * Windows fades and slides a window into place over ~190ms when it is shown.
 * For a launcher summoned by a hotkey that reads as two windows: a washed-out
 * ghost drifting down, then the real one settling. The panel plays its own
 * 110ms rise instead, which is the motion the themes actually control.
 */
app.commandLine.appendSwitch('wm-window-animations-disabled')

// Before anything reads userData, the single-instance lock included. A run from
// source uses the new folder but never moves the real one.
const dataDir = path.join(app.getPath('appData'), 'ProtagonistLabs', 'Lume')
app.setPath('userData', app.isPackaged ? moveDataFolder(path.join(app.getPath('appData'), 'Lume'), dataDir) : dataDir)

let tray: Tray | null = null
let registeredHotkey = ''
/** Results from the last query, so `execute` can look an item up by id. */
let lastResults: ResultItem[] = []
let lastQuery = ''

const ctx = {
  hideWindow: () => launcherWindow.hide(),
  toggleDevTools: () => launcherWindow.toggleDevTools(),
  openSettings: () => openSettings(),
}

/** The theme actually in effect once `colorScheme` is resolved. */
function activeThemeName(): string {
  const cfg = settings.get()
  if (cfg.colorScheme === 'fixed') return cfg.theme
  return nativeTheme.shouldUseDarkColors ? cfg.theme : cfg.themeLight
}

function registerHotkey() {
  const wanted = settings.get().hotkey
  if (registeredHotkey) globalShortcut.unregister(registeredHotkey)
  registeredHotkey = ''

  let ok = false
  try {
    ok = globalShortcut.register(wanted, () => launcherWindow.toggle())
  } catch (err) {
    console.error('[hotkey] could not register "' + wanted + '":', err)
  }

  if (ok) {
    registeredHotkey = wanted
  } else {
    // Another app already owns this combination. Say so out loud instead of
    // silently remapping, so the fix is obvious.
    console.error('[hotkey] "' + wanted + '" is already taken by another app')
    if (Notification.isSupported()) {
      const note = new Notification({
        title: 'Lume: hotkey unavailable',
        body: wanted + ' is already registered by another application. Click to see who holds it, or pick a different one in Settings.',
      })
      note.on('click', () => showWhoHolds(wanted))
      note.show()
    }
  }
  updateTray()
  publishCard(wanted, ok)
}

let publishedHotkey = ''

/**
 * The card carries the hotkey and whether Lume got it, so it is rewritten when
 * either changes - not on every settings save, which also lands here.
 */
function publishCard(hotkey: string, registered: boolean) {
  // A dev run is electron.exe, which no sister should ever be pointed at.
  if (!app.isPackaged) return
  const state = hotkey + '|' + registered
  if (state === publishedHotkey) return
  publishedHotkey = state
  const hotkeys = hotkey ? [{ combo: toHotkeyScanCombo(hotkey), does: 'Show or hide Lume', registered }] : []
  writeCard(app.getVersion(), process.execPath, app.getPath('userData'), hotkeys)
}

/** Opens HotkeyScan on the taken combination, or its page when it is not installed. */
function showWhoHolds(accelerator: string) {
  const target = seeWhoHolds(accelerator)
  if ('url' in target) void shell.openExternal(target.url)
  else void execute({ kind: 'launch', target: target.exe, args: target.args }, ctx)
}

function updateTray() {
  if (!tray) return
  const hotkey = settings.get().hotkey
  tray.setToolTip(registeredHotkey ? 'Lume — ' + hotkey : 'Lume — ' + hotkey + ' unavailable (in use)')
}

function buildTray() {
  const cfg = settings.get()
  if (!cfg.showTrayIcon) {
    tray?.destroy()
    tray = null
    return
  }
  if (tray) return

  const image = nativeImage.createFromPath(TRAY_ICON)
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
  setTrayMenu()
  tray.on('click', () => launcherWindow.toggle())
  updateTray()
}

/** Rebuilt rather than built once, because a waiting update adds an entry. */
function setTrayMenu() {
  if (!tray) return
  const pending = updater.current.state === 'ready' ? updater.current.version : ''
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Lume', click: () => launcherWindow.show() },
      { label: 'Rebuild app index', click: () => void appIndex.rebuild() },
      { type: 'separator' },
      { label: 'Settings…', click: () => openSettings() },
      { label: 'What’s new', click: () => openWhatsNew() },
      { label: 'Open themes folder', click: () => void shell.openPath(themes.dir) },
      { label: 'Developer tools', click: () => launcherWindow.toggleDevTools() },
      pending
        ? { label: 'Restart and install ' + pending, click: () => updater.install() }
        : { label: 'Check for updates…', click: () => void checkUpdatesFromTray() },
      { type: 'separator' },
      { label: 'Lume website', click: () => void shell.openExternal('https://protagonistlabs.app/lume/?utm_source=lume&utm_medium=app&utm_campaign=tray') },
      { label: 'Send feedback (feedback@protagonistlabs.app)', click: () => void shell.openExternal('mailto:feedback@protagonistlabs.app?subject=Lume%20feedback') },
      { label: 'More apps from Protagonist Labs', click: () => void shell.openExternal('https://protagonistlabs.app/?utm_source=lume&utm_medium=app&utm_campaign=more-apps') },
      { type: 'separator' },
      { label: 'Quit Lume', click: () => app.quit() },
    ]),
  )
}

/**
 * A downloaded update used to wait in silence for a clean quit, which a tray
 * app can go months without: the download sat there while the launcher went
 * on being an old version. One nudge per version, and the tray keeps the
 * offer around for anyone who misses it.
 */
let offeredUpdate = ''
function offerUpdate(version: string | undefined) {
  if (!version || offeredUpdate === version) return
  offeredUpdate = version
  setTrayMenu()
  if (!Notification.isSupported()) return
  const note = new Notification({
    title: 'Lume ' + version + ' is ready',
    body: 'Click to restart and install it. Windows asks for permission first.',
  })
  note.on('click', () => updater.install())
  note.show()
}

/** Checks on demand and reports the outcome, since the tray has no UI of its own. */
async function checkUpdatesFromTray() {
  const status = await updater.check()
  if (!Notification.isSupported()) {
    openSettings()
    return
  }
  if (status.state === 'available') {
    new Notification({
      title: 'Lume ' + status.version + ' is available',
      body: status.downloadUrl ? 'Open the download page from Settings.' : 'Downloading it now.',
    }).show()
  } else if (status.state === 'ready') {
    new Notification({ title: 'Lume ' + status.version + ' is ready', body: 'Restart to finish.' }).show()
  } else if (status.state === 'current') {
    new Notification({ title: 'Lume is up to date', body: 'You are on ' + app.getVersion() + '.' }).show()
  } else if (status.state === 'error') {
    new Notification({ title: 'Update check failed', body: 'No connection, or GitHub is busy. Try again later.' }).show()
  } else {
    openSettings()
  }
}

/** getAccentColor() returns RRGGBBAA; the CSS custom property only wants the colour. */
function accentColor(): string | null {
  if (!settings.get().ui.useWindowsAccent) return null
  try {
    return '#' + systemPreferences.getAccentColor().slice(0, 6)
  } catch {
    return null
  }
}

function bootstrap(): Bootstrap {
  const active = activeThemeName()
  return {
    config: settings.get(),
    themes: themes.list(),
    css: themes.css(active),
    activeTheme: active,
    accentColor: accentColor(),
    version: app.getVersion(),
    indexCount: appIndex.stats().total,
  }
}

function applyStartupSetting() {
  const cfg = settings.get()
  app.setLoginItemSettings({
    openAtLogin: cfg.launchOnStartup,
    args: cfg.hideOnStartup ? ['--hidden'] : [],
  })
}

/* ------------------------------------------------------------------- IPC */

function registerIpc() {
  // --- launcher window ---
  ipcMain.handle('app:bootstrap', () => bootstrap())

  ipcMain.handle('search:query', (_e, query: string, token: number) => {
    lastQuery = query
    lastResults = search(query)
    return { token, query, items: lastResults }
  })

  ipcMain.handle('search:icon', (_e, key: string) => getIcon(key))

  ipcMain.handle('result:execute', async (_e, id: string, altIndex: number | null) => {
    const item = lastResults.find((r) => r.id === id)
    if (!item) return false
    const action = altIndex === null ? item.action : item.altActions?.[altIndex]?.action
    if (!action) return false
    // Only learn from the primary action; alternates are deliberate one-offs.
    if (altIndex === null && settings.get().frecencyWeight > 0 && (item.provider === 'apps' || item.provider === 'system')) {
      usage.record(item.id, lastQuery)
    }
    await execute(action, ctx)
    return true
  })

  ipcMain.on('window:hide', () => launcherWindow.hide())
  ipcMain.on('window:height', (_e, height: number) => launcherWindow.setContentHeight(height))

  // --- settings window ---
  ipcMain.handle('settings:get', () => settings.get())

  ipcMain.handle('settings:set', (_e, patch: Partial<Config>) => {
    settings.update(patch)
    return settings.get()
  })

  ipcMain.handle('settings:reset', () => {
    settings.reset()
    return settings.get()
  })

  ipcMain.handle('settings:themes', () => themes.list())
  ipcMain.handle('settings:openThemes', () => shell.openPath(themes.dir))
  ipcMain.handle('settings:openConfigFile', () => shell.openPath(settings.filePath))

  ipcMain.handle('settings:pickFolder', async () => {
    const parent = settingsWindow()
    const result = parent
      ? await dialog.showOpenDialog(parent, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  const indexStats = () => ({ ...appIndex.stats(), sisters: sisterCounts() })
  ipcMain.handle('settings:rebuildIndex', async () => {
    await appIndex.rebuild()
    return indexStats()
  })

  ipcMain.handle('settings:indexStats', indexStats)
  ipcMain.handle('settings:clearUsage', () => usage.clear())
  ipcMain.handle('settings:clearIconCache', () => clearIconCache())

  ipcMain.handle('settings:hotkeyStatus', () => ({
    wanted: settings.get().hotkey,
    active: registeredHotkey === settings.get().hotkey,
  }))

  ipcMain.handle('settings:seeWhoHolds', () => showWhoHolds(settings.get().hotkey))
  ipcMain.handle('settings:worksWith', () => worksWith())
  // Only sister pages: the settings renderer must not be able to open arbitrary URLs.
  ipcMain.handle('settings:openSisterPage', (_e, url: string) => {
    if (typeof url === 'string' && url.startsWith('https://protagonistlabs.app/')) void shell.openExternal(url)
  })

  ipcMain.handle('settings:preview', () => launcherWindow.show())
  ipcMain.handle('settings:whatsNew', () => openWhatsNew())
  ipcMain.handle('settings:version', () => app.getVersion())

  ipcMain.handle('settings:updateStatus', () => updater.current)
  ipcMain.handle('settings:checkForUpdates', () => updater.check())
  ipcMain.handle('settings:installUpdate', () => updater.install())
  ipcMain.handle('settings:openDownloadPage', () => updater.openDownloadPage())
}

function wireEvents() {
  themes.on('changed', (name: string) => {
    // Push CSS for the active theme on every save, so editing it is live.
    if (name === activeThemeName()) launcherWindow.send('theme:css', themes.css(name))
    launcherWindow.send('theme:list', themes.list())
    notifySettings('settings:themesChanged', themes.list())
  })

  settings.on('changed', () => {
    registerHotkey()
    buildTray()
    applyStartupSetting()
    updater.applySettings()
    const rebuilt = launcherWindow.applyConfig()
    // A rebuilt window bootstraps itself on load, so only push to a live one.
    if (!rebuilt) launcherWindow.send('config:changed', bootstrap())
    notifySettings('settings:changed', settings.get())
  })

  nativeTheme.on('updated', () => {
    if (settings.get().colorScheme !== 'system') return
    launcherWindow.send('config:changed', bootstrap())
  })

  appIndex.on('updated', (count: number) => launcherWindow.send('index:updated', count))

  systemPreferences.on('accent-color-changed', () => {
    if (settings.get().ui.useWindowsAccent) launcherWindow.send('config:changed', bootstrap())
  })

  updater.on('status', (status) => {
    notifySettings('settings:updateStatus', status)
    if (status.state === 'ready') offerUpdate(status.version)
  })
}

/**
 * What's new, once after an update. The version last seen lives in its own
 * file beside config.json; a profile without one but with a config written
 * before this start is an update from before 0.4.1, and a fresh install has
 * nothing new to tell.
 */
function whatsNewAfterUpdate(hadConfig: boolean) {
  const file = path.join(app.getPath('userData'), 'last-seen-version')
  let seen = ''
  try {
    seen = fs.readFileSync(file, 'utf8').trim()
  } catch {
    // No file yet: hadConfig decides below.
  }
  const current = app.getVersion()
  if (seen === current) return
  // Seen once it is closed, not when it opens: notes that never reached the screen come back next start.
  const markSeen = () => {
    try {
      fs.writeFileSync(file, current, 'utf8')
    } catch (err) {
      console.error('[whatsnew] could not record the version:', err)
    }
  }
  if (seen || hadConfig) openWhatsNew(markSeen)
  else markSeen()
}

/* ------------------------------------------------------------- lifecycle */

if (!app.requestSingleInstanceLock()) {
  app.exit(0)
} else {
  app.on('second-instance', (_e, argv) => {
    // `lume.exe --settings` from an installed shortcut reaches the running
    // instance here rather than starting a second copy.
    if (argv.includes('--settings')) openSettings()
    else launcherWindow.show()
  })

  // A launcher lives in the tray; registering this listener at all suppresses
  // Electron's default "quit when the last window closes" behaviour.
  app.on('window-all-closed', () => {})

  app.whenReady().then(async () => {
    app.setAppUserModelId('dev.tucu.lume')
    const hadConfig = fs.existsSync(path.join(app.getPath('userData'), 'config.json'))
    settings.init()
    themes.init()
    usage.init(app.getPath('userData'))
    initIcons()

    registerIpc()
    wireEvents()

    launcherWindow.create()
    buildTray()
    registerHotkey()

    await appIndex.init()
    applyStartupSetting()
    updater.init()
    whatsNewAfterUpdate(hadConfig)

    if (process.argv.includes('--settings')) {
      openSettings()
      return
    }

    const startHidden = process.argv.includes('--hidden') || settings.get().hideOnStartup
    if (!startHidden) launcherWindow.show()
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    appIndex.dispose()
    usage.flush()
  })
}
