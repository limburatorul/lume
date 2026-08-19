import { contextBridge, ipcRenderer } from 'electron'
import type { Config, IndexStats, ThemeInfo, UpdateStatus } from '../shared/types.js'

/** API for the settings window. Deliberately separate from the launcher's. */
const api = {
  getConfig: (): Promise<Config> => ipcRenderer.invoke('settings:get'),
  setConfig: (patch: Partial<Config>): Promise<Config> => ipcRenderer.invoke('settings:set', patch),
  resetConfig: (): Promise<Config> => ipcRenderer.invoke('settings:reset'),
  listThemes: (): Promise<ThemeInfo[]> => ipcRenderer.invoke('settings:themes'),
  openThemesFolder: (): Promise<void> => ipcRenderer.invoke('settings:openThemes'),
  openConfigFile: (): Promise<void> => ipcRenderer.invoke('settings:openConfigFile'),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('settings:pickFolder'),
  rebuildIndex: (): Promise<IndexStats> => ipcRenderer.invoke('settings:rebuildIndex'),
  indexStats: (): Promise<IndexStats> => ipcRenderer.invoke('settings:indexStats'),
  clearUsage: (): Promise<void> => ipcRenderer.invoke('settings:clearUsage'),
  clearIconCache: (): Promise<void> => ipcRenderer.invoke('settings:clearIconCache'),
  /** Reports whether the hotkey could actually be claimed from the OS. */
  hotkeyStatus: (): Promise<{ wanted: string; active: boolean }> => ipcRenderer.invoke('settings:hotkeyStatus'),
  previewLauncher: (): Promise<void> => ipcRenderer.invoke('settings:preview'),
  appVersion: (): Promise<string> => ipcRenderer.invoke('settings:version'),

  updateStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke('settings:updateStatus'),
  checkForUpdates: (): Promise<UpdateStatus> => ipcRenderer.invoke('settings:checkForUpdates'),
  installUpdate: (): Promise<boolean> => ipcRenderer.invoke('settings:installUpdate'),
  openDownloadPage: (): Promise<void> => ipcRenderer.invoke('settings:openDownloadPage'),
  onUpdateStatus: (cb: (s: UpdateStatus) => void) =>
    ipcRenderer.on('settings:updateStatus', (_e, s: UpdateStatus) => cb(s)),

  onConfigChanged: (cb: (c: Config) => void) =>
    ipcRenderer.on('settings:changed', (_e, c: Config) => cb(c)),
  onThemesChanged: (cb: (list: ThemeInfo[]) => void) =>
    ipcRenderer.on('settings:themesChanged', (_e, list: ThemeInfo[]) => cb(list)),
}

contextBridge.exposeInMainWorld('lumeSettings', api)

export type LumeSettingsApi = typeof api
