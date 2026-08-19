import { contextBridge, ipcRenderer } from 'electron'
import type { Bootstrap, Config, QueryResponse, ThemeInfo } from '../shared/types.js'

/**
 * The renderer gets a narrow, explicit surface - no node, no ipcRenderer.
 */
const api = {
  bootstrap: (): Promise<Bootstrap> => ipcRenderer.invoke('app:bootstrap'),
  query: (text: string, token: number): Promise<QueryResponse> =>
    ipcRenderer.invoke('search:query', text, token),
  icon: (key: string): Promise<string | null> => ipcRenderer.invoke('search:icon', key),
  execute: (id: string, altIndex: number | null = null): Promise<boolean> =>
    ipcRenderer.invoke('result:execute', id, altIndex),
  updateConfig: (patch: Partial<Config>): Promise<Config> => ipcRenderer.invoke('config:update', patch),
  hide: () => ipcRenderer.send('window:hide'),
  reportHeight: (height: number) => ipcRenderer.send('window:height', height),

  onShown: (cb: () => void) => ipcRenderer.on('window:shown', () => cb()),
  onHidden: (cb: () => void) => ipcRenderer.on('window:hidden', () => cb()),
  onThemeCss: (cb: (css: string) => void) => ipcRenderer.on('theme:css', (_e, css: string) => cb(css)),
  onThemeList: (cb: (list: ThemeInfo[]) => void) =>
    ipcRenderer.on('theme:list', (_e, list: ThemeInfo[]) => cb(list)),
  onConfigChanged: (cb: (b: Bootstrap) => void) =>
    ipcRenderer.on('config:changed', (_e, b: Bootstrap) => cb(b)),
  onIndexUpdated: (cb: (count: number) => void) =>
    ipcRenderer.on('index:updated', (_e, count: number) => cb(count)),
}

contextBridge.exposeInMainWorld('lume', api)

export type LumeApi = typeof api
