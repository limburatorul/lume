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
  Tray,
} from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Bootstrap, Config, ResultItem } from '../shared/types.js'
import { execute } from './executor.js'
import { clearIconCache, getIcon, initIcons } from './icons.js'
import { appIndex } from './indexer/apps.js'
import { search } from './search/engine.js'
import { settings } from './settings.js'
import { notifySettings, openSettings, settingsWindow } from './settingsWindow.js'
import { usage } from './store.js'
import { themes } from './themes.js'
import { updater } from './updater.js'
import { launcherWindow } from './window.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const TRAY_ICON = path.resolve(here, '..', 'assets', 'tray.png')

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
      new Notification({
        title: 'Lume: hotkey unavailable',
        body: wanted + ' is already registered by another application. Pick a different one in Settings.',
      }).show()
    }
  }
  updateTray()
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
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Lume', click: () => launcherWindow.show() },
      { label: 'Settings…', click: () => openSettings() },
      { type: 'separator' },
      { label: 'Check for updates…', click: () => void checkUpdatesFromTray() },
      { type: 'separator' },
      { label: 'Rebuild app index', click: () => void appIndex.rebuild() },
      { label: 'Open themes folder', click: () => void shell.openPath(themes.dir) },
      { label: 'Developer tools', click: () => launcherWindow.toggleDevTools() },
      { type: 'separator' },
      { label: 'Quit Lume', click: () => app.quit() },
    ]),
  )
  tray.on('click', () => launcherWindow.toggle())
  updateTray()
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
    new Notification({ title: 'Update check failed', body: status.message }).show()
  } else {
    openSettings()
  }
}

function bootstrap(): Bootstrap {
  const active = activeThemeName()
  return {
    config: settings.get(),
    themes: themes.list(),
    css: themes.css(active),
    activeTheme: active,
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
    if (altIndex === null && settings.get().frecencyWeight > 0 && item.provider === 'apps') {
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

  ipcMain.handle('settings:rebuildIndex', async () => {
    await appIndex.rebuild()
    return appIndex.stats()
  })

  ipcMain.handle('settings:indexStats', () => appIndex.stats())
  ipcMain.handle('settings:clearUsage', () => usage.clear())
  ipcMain.handle('settings:clearIconCache', () => clearIconCache())

  ipcMain.handle('settings:hotkeyStatus', () => ({
    wanted: settings.get().hotkey,
    active: registeredHotkey === settings.get().hotkey,
  }))

  ipcMain.handle('settings:preview', () => launcherWindow.show())
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

  updater.on('status', (status) => notifySettings('settings:updateStatus', status))
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

    settings.init()
    themes.init()
    usage.init()
    initIcons()

    registerIpc()
    wireEvents()

    launcherWindow.create()
    buildTray()
    registerHotkey()

    await appIndex.init()
    applyStartupSetting()
    updater.init()

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
