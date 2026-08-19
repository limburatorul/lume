/** Everything that crosses the main <-> renderer boundary lives here. */

export type Action =
  | { kind: 'launch'; target: string; args?: string[]; cwd?: string; admin?: boolean }
  | { kind: 'launchUwp'; appId: string }
  | { kind: 'openPath'; path: string }
  | { kind: 'revealPath'; path: string }
  | { kind: 'openUrl'; url: string }
  | { kind: 'shellExec'; command: string; hidden?: boolean; admin?: boolean }
  | { kind: 'copy'; text: string }
  | {
      kind: 'internal'
      name:
        | 'reindex'
        | 'quit'
        | 'restart'
        | 'openConfig'
        | 'openThemes'
        | 'openSettings'
        | 'toggleDevTools'
        | 'noop'
    }

export interface AltAction {
  label: string
  action: Action
  /** Rendered as a hint in the context menu, e.g. "Ctrl+Enter". */
  hint?: string
}

export interface ResultItem {
  id: string
  title: string
  subtitle?: string
  /** Key the renderer passes back to `getIcon` for lazy icon loading. */
  iconKey?: string
  /** Inline fallback icon: a single glyph or emoji drawn when no bitmap exists. */
  glyph?: string
  score: number
  provider: string
  action: Action
  altActions?: AltAction[]
  /** Highlighted character offsets in `title`, produced by the fuzzy matcher. */
  matches?: number[]
}

export interface QueryResponse {
  token: number
  query: string
  items: ResultItem[]
}

export interface SearchEngine {
  keyword: string
  name: string
  /** `{q}` is replaced with the URL-encoded query. */
  url: string
  glyph?: string
}

/**
 * Per-setting overrides of theme values. `null` means "leave whatever the
 * theme chose"; a number or string wins over the theme's own declaration.
 */
export interface UiOverrides {
  /** 0..1 alpha of the launcher surface. 1 is fully opaque. */
  surfaceOpacity: number | null
  cornerRadius: number | null
  rowHeight: number | null
  iconSize: number | null
  queryFontSize: number | null
  resultFontSize: number | null
  resultSubFontSize: number | null
  fontFamily: string | null
}

export type Backdrop = 'acrylic' | 'mica' | 'tabbed' | 'none'
/** 'fixed' always uses `theme`; 'system' switches with the Windows setting. */
export type ColorScheme = 'fixed' | 'system'
export type ScreenChoice = 'cursor' | 'primary' | 'focus'
export type LastQueryMode = 'empty' | 'preserve' | 'select'

export interface Config {
  // --- Hotkey & behaviour ---
  hotkey: string
  hideOnBlur: boolean
  showAtTopmost: boolean
  lastQueryMode: LastQueryMode
  /** Milliseconds to wait after a keystroke before searching. 0 = every key. */
  searchDelay: number

  // --- Appearance ---
  colorScheme: ColorScheme
  /** The theme, and the one used when Windows is in dark mode. */
  theme: string
  /** Only consulted when colorScheme is 'system' and Windows is in light mode. */
  themeLight: string
  backdrop: Backdrop
  useDropShadow: boolean
  useAnimation: boolean
  animationSpeed: number
  windowWidth: number
  maxResults: number
  verticalAnchor: number
  searchWindowScreen: ScreenChoice
  showPlaceholder: boolean
  placeholder: string
  ui: UiOverrides

  // --- Startup ---
  launchOnStartup: boolean
  hideOnStartup: boolean
  showTrayIcon: boolean

  // --- Search ---
  extraAppFolders: string[]
  excludePatterns: string[]
  searchEngines: SearchEngine[]
  defaultEngine: string
  shellPrefix: string
  shell: 'powershell' | 'cmd'
  frecencyWeight: number
}

export interface ThemeInfo {
  name: string
  file: string
}

export interface Bootstrap {
  config: Config
  themes: ThemeInfo[]
  css: string
  /** Name of the theme actually in effect once colorScheme is resolved. */
  activeTheme: string
  version: string
}

export interface IndexStats {
  total: number
  byKind: Record<string, number>
  /** Epoch millis of the last successful rebuild, or 0 if never. */
  builtAt: number
}
