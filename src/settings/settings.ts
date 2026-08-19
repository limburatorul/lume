import type { Config, IndexStats, SearchEngine, ThemeInfo } from '../shared/types.js'
import type { LumeSettingsApi } from '../preload/settings.js'

declare global {
  interface Window {
    lumeSettings: LumeSettingsApi
  }
}

const api = window.lumeSettings

let config: Config
let themes: ThemeInfo[] = []
let stats: IndexStats = { total: 0, byKind: {}, builtAt: 0 }
let current = 'appearance'

/* ------------------------------------------------------------ value access */

function read(path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], config)
}

/** Applies a dotted-path change and persists it. */
function write(path: string, value: unknown) {
  const [head, tail] = path.split('.')
  const patch: Record<string, unknown> = tail ? { [head]: { [tail]: value } } : { [head]: value }
  // Keep the local copy in step so re-renders during the round trip are correct.
  if (tail) (config as unknown as Record<string, Record<string, unknown>>)[head][tail] = value
  else (config as unknown as Record<string, unknown>)[head] = value
  void api.setConfig(patch as Partial<Config>).then((c) => {
    config = c
  })
}

function toast(message: string) {
  const el = document.getElementById('toast')!
  el.textContent = message
  el.hidden = false
  window.clearTimeout((toast as unknown as { t?: number }).t)
  ;(toast as unknown as { t?: number }).t = window.setTimeout(() => (el.hidden = true), 2200)
}

/* ------------------------------------------------------------ field schema */

type Option = { value: string; label: string }

type Field =
  | { kind: 'toggle'; path: string; label: string; help?: string }
  | { kind: 'text'; path: string; label: string; help?: string; placeholder?: string; mono?: boolean }
  | {
      kind: 'number'
      path: string
      label: string
      help?: string
      min: number
      max: number
      step?: number
      suffix?: string
      /** Empty input clears the value to null (used for theme overrides). */
      nullable?: boolean
    }
  | {
      kind: 'slider'
      path: string
      label: string
      help?: string
      min: number
      max: number
      step: number
      format?: (v: number) => string
    }
  | {
      kind: 'select'
      path: string
      label: string
      help?: string
      options: () => Option[]
      /** Redraw the whole section after a change, for choices that add or remove fields. */
      rerender?: boolean
    }
  | { kind: 'hotkey'; path: string; label: string; help?: string }
  | { kind: 'list'; path: string; label: string; help?: string; placeholder: string; folderPicker?: boolean }
  | { kind: 'engines'; label: string; help?: string }
  | { kind: 'custom'; render: () => HTMLElement }

interface Group {
  title: string
  fields: Field[]
}

interface Section {
  id: string
  label: string
  title: string
  blurb: string
  groups: () => Group[]
}

const themeOptions = (): Option[] => themes.map((t) => ({ value: t.name, label: t.name }))

const SECTIONS: Section[] = [
  {
    id: 'appearance',
    label: 'Appearance',
    title: 'Appearance',
    blurb:
      'The theme supplies colours and spacing; the values here override it. Leave an override blank to keep whatever the theme chose.',
    groups: () => [
      {
        title: 'Theme',
        fields: [
          {
            kind: 'select',
            path: 'colorScheme',
            label: 'Colour scheme',
            help:
              'Lume does not tint a theme light or dark — it picks a different theme file. “Follow Windows” is the only setting that needs two of them.',
            options: () => [
              { value: 'fixed', label: 'Always this theme' },
              { value: 'system', label: 'Follow Windows (light / dark pair)' },
            ],
            // Choosing this changes which theme pickers belong on the page.
            rerender: true,
          },
          // One picker unless Windows is driving the choice, so it is never
          // ambiguous which of the two a change lands in.
          ...(config.colorScheme === 'system'
            ? ([
                {
                  kind: 'select',
                  path: 'theme',
                  label: 'Theme when Windows is dark',
                  options: themeOptions,
                },
                {
                  kind: 'select',
                  path: 'themeLight',
                  label: 'Theme when Windows is light',
                  options: themeOptions,
                },
              ] as Field[])
            : ([
                {
                  kind: 'select',
                  path: 'theme',
                  label: 'Theme',
                  options: themeOptions,
                },
              ] as Field[])),
        ],
      },
      {
        title: 'Window surface',
        fields: [
          {
            kind: 'select',
            path: 'backdrop',
            label: 'Background material',
            help:
              'Acrylic is the frosted glass: it blurs whatever sits behind the window, including other apps. Mica only samples the desktop wallpaper, so over a covered screen it reads as a flat colour — pick acrylic if you want the blur. “None” gives a plain window, where opacity alone decides how see-through it is, and what shows through stays sharp. Changing this rebuilds the launcher window.',
            options: () => [
              { value: 'acrylic', label: 'Acrylic (frosted glass)' },
              { value: 'mica', label: 'Mica' },
              { value: 'tabbed', label: 'Mica alt' },
              { value: 'none', label: 'None' },
            ],
          },
          {
            kind: 'slider',
            path: 'ui.surfaceOpacity',
            label: 'Opacity',
            help: 'How much of the theme colour covers the blur. 100% hides the desktop entirely.',
            min: 0.3,
            max: 1,
            step: 0.02,
            format: (v) => Math.round(v * 100) + '%',
          },
          {
            kind: 'toggle',
            path: 'useDropShadow',
            label: 'Drop shadow',
            help: 'Casts a shadow behind the window.',
          },
          {
            kind: 'number',
            path: 'ui.cornerRadius',
            label: 'Corner radius',
            min: 0,
            max: 40,
            suffix: 'px',
            nullable: true,
          },
        ],
      },
      {
        title: 'Size and layout',
        fields: [
          { kind: 'number', path: 'windowWidth', label: 'Window width', min: 360, max: 1400, step: 10, suffix: 'px' },
          {
            kind: 'number',
            path: 'maxResults',
            label: 'Results shown',
            help: 'How many rows fit before the list stops growing.',
            min: 1,
            max: 20,
          },
          { kind: 'number', path: 'ui.rowHeight', label: 'Row height', min: 28, max: 90, suffix: 'px', nullable: true },
          { kind: 'number', path: 'ui.iconSize', label: 'Icon size', min: 14, max: 56, suffix: 'px', nullable: true },
          {
            kind: 'slider',
            path: 'verticalAnchor',
            label: 'Vertical position',
            help: '0% pins the window to the top of the screen, 100% to the bottom.',
            min: 0,
            max: 0.9,
            step: 0.01,
            format: (v) => Math.round(v * 100) + '%',
          },
        ],
      },
      {
        title: 'Text',
        fields: [
          {
            kind: 'text',
            path: 'ui.fontFamily',
            label: 'Font',
            help: 'A font family name, e.g. <code>Inter</code>. Blank uses the theme’s font.',
            placeholder: 'theme default',
          },
          {
            kind: 'number',
            path: 'ui.queryFontSize',
            label: 'Query text size',
            min: 11,
            max: 34,
            suffix: 'px',
            nullable: true,
          },
          {
            kind: 'number',
            path: 'ui.resultFontSize',
            label: 'Result title size',
            min: 9,
            max: 26,
            suffix: 'px',
            nullable: true,
          },
          {
            kind: 'number',
            path: 'ui.resultSubFontSize',
            label: 'Result subtitle size',
            min: 8,
            max: 22,
            suffix: 'px',
            nullable: true,
          },
        ],
      },
      {
        title: 'Query box',
        fields: [
          { kind: 'toggle', path: 'showPlaceholder', label: 'Show placeholder text' },
          { kind: 'text', path: 'placeholder', label: 'Placeholder', placeholder: 'Search' },
        ],
      },
      {
        title: 'Motion',
        fields: [
          { kind: 'toggle', path: 'useAnimation', label: 'Animate the window' },
          {
            kind: 'number',
            path: 'animationSpeed',
            label: 'Animation length',
            min: 0,
            max: 600,
            step: 10,
            suffix: 'ms',
          },
        ],
      },
    ],
  },
  {
    id: 'behaviour',
    label: 'Behaviour',
    title: 'Behaviour',
    blurb: 'How the launcher opens, where it opens, and what it does when you leave it.',
    groups: () => [
      {
        title: 'Hotkey',
        fields: [
          {
            kind: 'hotkey',
            path: 'hotkey',
            label: 'Open Lume',
            help: 'Click the box and press the combination. If another app already owns it, the badge turns red.',
          },
        ],
      },
      {
        title: 'Window',
        fields: [
          {
            kind: 'select',
            path: 'searchWindowScreen',
            label: 'Open on',
            options: () => [
              { value: 'cursor', label: 'Monitor with the mouse' },
              { value: 'focus', label: 'Monitor with the focused window' },
              { value: 'primary', label: 'Primary monitor' },
            ],
          },
          {
            kind: 'toggle',
            path: 'hideOnBlur',
            label: 'Hide when it loses focus',
            help: 'Turn this off while editing a theme, so the window stays put as you work.',
          },
          {
            kind: 'toggle',
            path: 'showAtTopmost',
            label: 'Always on top',
            help: 'Keeps Lume above other windows, including full-screen apps.',
          },
        ],
      },
      {
        title: 'Query',
        fields: [
          {
            kind: 'select',
            path: 'lastQueryMode',
            label: 'When reopening',
            options: () => [
              { value: 'empty', label: 'Start with an empty box' },
              { value: 'preserve', label: 'Keep the last query' },
              { value: 'select', label: 'Keep it, selected for overtyping' },
            ],
          },
          {
            kind: 'number',
            path: 'searchDelay',
            label: 'Search delay',
            help: 'Wait this long after the last keystroke before searching. 0 searches on every key.',
            min: 0,
            max: 500,
            step: 10,
            suffix: 'ms',
          },
          {
            kind: 'slider',
            path: 'frecencyWeight',
            label: 'Weight of learned usage',
            help:
              'How much your launch history outranks raw match quality. 0 turns learning off entirely; high values pin your habits to the top.',
            min: 0,
            max: 0.8,
            step: 0.05,
            format: (v) => Math.round(v * 100) + '%',
          },
        ],
      },
    ],
  },
  {
    id: 'startup',
    label: 'Startup',
    title: 'Startup & tray',
    blurb: 'Lume is meant to stay resident: it keeps the app index warm so the window opens instantly.',
    groups: () => [
      {
        title: 'Windows startup',
        fields: [
          {
            kind: 'toggle',
            path: 'launchOnStartup',
            label: 'Start Lume when I sign in',
            help: 'Registers Lume with Windows startup. Takes effect immediately.',
          },
          {
            kind: 'toggle',
            path: 'hideOnStartup',
            label: 'Start hidden',
            help: 'Launch straight to the tray instead of showing the window.',
          },
        ],
      },
      {
        title: 'Tray',
        fields: [
          {
            kind: 'toggle',
            path: 'showTrayIcon',
            label: 'Show tray icon',
            help: 'With this off, reach these settings by pressing the hotkey and typing “settings”.',
          },
        ],
      },
    ],
  },
  {
    id: 'search',
    label: 'Search',
    title: 'Search sources',
    blurb: 'What gets indexed, what gets filtered out, and how the shell prefix behaves.',
    groups: () => [
      {
        title: 'Application index',
        fields: [
          {
            kind: 'list',
            path: 'extraAppFolders',
            label: 'Extra folders to index',
            help: 'Scanned for .lnk, .url and .exe alongside the Start Menu and Desktop.',
            placeholder: 'D:\\Games',
            folderPicker: true,
          },
          {
            kind: 'list',
            path: 'excludePatterns',
            label: 'Exclude titles containing',
            help: 'Case-insensitive substring match against the entry name.',
            placeholder: 'uninstall',
          },
        ],
      },
      {
        title: 'Shell',
        fields: [
          {
            kind: 'text',
            path: 'shellPrefix',
            label: 'Shell prefix',
            help: 'Everything typed after this runs as a command.',
            placeholder: '>',
            mono: true,
          },
          {
            kind: 'select',
            path: 'shell',
            label: 'Shell',
            options: () => [
              { value: 'powershell', label: 'PowerShell' },
              { value: 'cmd', label: 'Command Prompt' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'engines',
    label: 'Web search',
    title: 'Web search engines',
    blurb:
      'Type a keyword followed by a space to search that engine. The URL template uses {q} for the query.',
    groups: () => [
      {
        title: 'Engines',
        fields: [
          { kind: 'engines', label: 'Engines' },
          {
            kind: 'select',
            path: 'defaultEngine',
            label: 'Fallback engine',
            help: 'Offered at the bottom of the results when nothing else matches.',
            options: () => config.searchEngines.map((e) => ({ value: e.keyword, label: e.name })),
          },
        ],
      },
    ],
  },
  {
    id: 'index',
    label: 'Index & data',
    title: 'Index & data',
    blurb: 'Lume rebuilds the index automatically when programs are installed or removed.',
    groups: () => [
      { title: 'Application index', fields: [{ kind: 'custom', render: renderIndexPanel }] },
      { title: 'Stored data', fields: [{ kind: 'custom', render: renderDataPanel }] },
    ],
  },
  {
    id: 'about',
    label: 'About',
    title: 'About Lume',
    blurb: '',
    groups: () => [{ title: 'Keys', fields: [{ kind: 'custom', render: renderAbout }] }],
  },
]

/* --------------------------------------------------------- control builders */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v as string
    else (node as unknown as Record<string, unknown>)[k] = v
  }
  node.append(...children)
  return node
}

function fieldShell(label: string, help: string | undefined, control: HTMLElement, stack = false) {
  const info = el('div')
  info.append(el('div', { class: 'field-label', textContent: label }))
  if (help) {
    const h = el('div', { class: 'field-help' })
    h.innerHTML = help
    info.append(h)
  }
  const wrap = el('div', { class: 'field-control' }, control)
  return el('div', { class: stack ? 'field stack' : 'field' }, info, wrap)
}

function buildToggle(f: Extract<Field, { kind: 'toggle' }>) {
  const input = el('input', { type: 'checkbox', checked: Boolean(read(f.path)) })
  input.addEventListener('change', () => write(f.path, input.checked))
  const sw = el('label', { class: 'switch' }, input, el('span'))
  return fieldShell(f.label, f.help, sw)
}

function buildText(f: Extract<Field, { kind: 'text' }>) {
  const value = read(f.path)
  const input = el('input', {
    type: 'text',
    value: value == null ? '' : String(value),
    placeholder: f.placeholder ?? '',
  })
  if (f.mono) input.style.fontFamily = 'var(--mono)'
  input.addEventListener('change', () => {
    const v = input.value.trim()
    // A blank override means "let the theme decide"; a blank plain string
    // stays a blank string.
    write(f.path, f.path.startsWith('ui.') && v === '' ? null : input.value)
  })
  return fieldShell(f.label, f.help, input)
}

function buildNumber(f: Extract<Field, { kind: 'number' }>) {
  const value = read(f.path)
  const input = el('input', {
    type: 'number',
    value: value == null ? '' : String(value),
    min: String(f.min),
    max: String(f.max),
    step: String(f.step ?? 1),
    placeholder: f.nullable ? 'auto' : '',
  })
  input.addEventListener('change', () => {
    if (input.value.trim() === '') {
      if (f.nullable) return write(f.path, null)
      input.value = String(read(f.path) ?? f.min)
      return
    }
    const n = Math.min(f.max, Math.max(f.min, Number(input.value)))
    input.value = String(n)
    write(f.path, n)
  })
  const control = el('div', { class: 'field-control' }, input)
  if (f.suffix) control.append(el('span', { class: 'suffix', textContent: f.suffix }))
  return fieldShell(f.label, f.help, control)
}

function buildSlider(f: Extract<Field, { kind: 'slider' }>) {
  const value = Number(read(f.path) ?? f.min)
  const format = f.format ?? ((v: number) => String(v))
  const out = el('span', { class: 'range-value', textContent: format(value) })
  const input = el('input', {
    type: 'range',
    min: String(f.min),
    max: String(f.max),
    step: String(f.step),
    value: String(value),
  })
  input.addEventListener('input', () => (out.textContent = format(Number(input.value))))
  input.addEventListener('change', () => write(f.path, Number(input.value)))
  return fieldShell(f.label, f.help, el('div', { class: 'field-control' }, input, out))
}

function buildSelect(f: Extract<Field, { kind: 'select' }>) {
  const select = el('select')
  const value = String(read(f.path) ?? '')
  for (const opt of f.options()) {
    select.append(el('option', { value: opt.value, textContent: opt.label, selected: opt.value === value }))
  }
  select.addEventListener('change', () => {
    write(f.path, select.value)
    if (f.rerender) renderSection()
  })
  return fieldShell(f.label, f.help, select)
}

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta'])

/** Turns a KeyboardEvent into an Electron accelerator string. */
function acceleratorFrom(e: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Super')

  let key = e.key
  if (key === ' ') key = 'Space'
  else if (key === 'Escape') return null
  else if (key.length === 1) key = key.toUpperCase()
  else if (/^F\d{1,2}$/.test(key)) {
    /* function keys pass through */
  } else if (key === 'ArrowUp') key = 'Up'
  else if (key === 'ArrowDown') key = 'Down'
  else if (key === 'ArrowLeft') key = 'Left'
  else if (key === 'ArrowRight') key = 'Right'

  // A bare letter would swallow ordinary typing, so require a modifier unless
  // it is a function key.
  if (!parts.length && !/^F\d{1,2}$/.test(key)) return null
  parts.push(key)
  return parts.join('+')
}

function buildHotkey(f: Extract<Field, { kind: 'hotkey' }>) {
  const input = el('input', {
    type: 'text',
    class: 'hotkey-input',
    value: String(read(f.path) ?? ''),
    readOnly: true,
  })
  const badge = el('span', { class: 'status', textContent: '…' })

  const refresh = () =>
    void api.hotkeyStatus().then((s) => {
      badge.className = 'status ' + (s.active ? 'ok' : 'bad')
      badge.textContent = s.active ? 'active' : 'in use by another app'
    })

  input.addEventListener('focus', () => {
    input.classList.add('capturing')
    input.value = 'press keys…'
  })
  input.addEventListener('blur', () => {
    input.classList.remove('capturing')
    input.value = String(read(f.path) ?? '')
  })
  input.addEventListener('keydown', (e) => {
    e.preventDefault()
    if (e.key === 'Escape') return input.blur()
    const accel = acceleratorFrom(e)
    if (!accel) return
    write(f.path, accel)
    input.value = accel
    input.blur()
    window.setTimeout(refresh, 150)
  })

  refresh()
  return fieldShell(f.label, f.help, el('div', { class: 'field-control' }, input, badge))
}

function buildList(f: Extract<Field, { kind: 'list' }>) {
  const values = [...((read(f.path) as string[]) ?? [])]
  const list = el('div', { class: 'list' })

  const commit = () => write(f.path, values.filter((v) => v.trim() !== ''))

  const render = () => {
    list.replaceChildren()
    values.forEach((value, i) => {
      const input = el('input', { type: 'text', value, placeholder: f.placeholder })
      input.addEventListener('change', () => {
        values[i] = input.value
        commit()
      })
      const remove = el('button', { class: 'icon-btn', title: 'Remove', textContent: '×' })
      remove.addEventListener('click', () => {
        values.splice(i, 1)
        commit()
        render()
      })
      list.append(el('div', { class: 'list-row' }, input, remove))
    })

    const add = el('button', { class: 'ghost', textContent: '+ Add' })
    add.addEventListener('click', () => {
      values.push('')
      render()
    })
    const actions = el('div', { class: 'list-row' }, add)

    if (f.folderPicker) {
      const browse = el('button', { class: 'ghost', textContent: 'Browse…' })
      browse.addEventListener('click', () => {
        void api.pickFolder().then((dir) => {
          if (!dir) return
          values.push(dir)
          commit()
          render()
        })
      })
      actions.append(browse)
    }
    list.append(actions)
  }

  render()
  return fieldShell(f.label, f.help, list, true)
}

function buildEngines(f: Extract<Field, { kind: 'engines' }>) {
  const engines: SearchEngine[] = config.searchEngines.map((e) => ({ ...e }))
  const wrap = el('div', { class: 'list' })

  const commit = () => {
    write('searchEngines', engines.filter((e) => e.keyword.trim() && e.url.includes('{q}')))
    // The fallback picker lists engines by keyword, so it has to redraw.
    renderSection()
  }

  const table = el('table', { class: 'engines' })
  const head = el('tr')
  head.append(
    el('th', { class: 'col-key', textContent: 'Keyword' }),
    el('th', { class: 'col-name', textContent: 'Name' }),
    el('th', { textContent: 'URL template' }),
    el('th', { textContent: '' }),
  )
  table.append(head)

  engines.forEach((engine, i) => {
    const row = el('tr')
    const mk = (key: 'keyword' | 'name' | 'url', placeholder: string) => {
      const input = el('input', { type: 'text', value: engine[key] ?? '', placeholder })
      input.addEventListener('change', () => {
        engines[i][key] = input.value.trim()
        commit()
      })
      return input
    }
    const remove = el('button', { class: 'icon-btn', title: 'Remove', textContent: '×' })
    remove.addEventListener('click', () => {
      engines.splice(i, 1)
      commit()
    })
    row.append(
      el('td', {}, mk('keyword', 'g')),
      el('td', {}, mk('name', 'Google')),
      el('td', {}, mk('url', 'https://example.com/search?q={q}')),
      el('td', {}, remove),
    )
    table.append(row)
  })

  const add = el('button', { class: 'ghost', textContent: '+ Add engine' })
  add.addEventListener('click', () => {
    engines.push({ keyword: '', name: '', url: 'https://', glyph: '🔎' })
    renderSection(() => {
      config.searchEngines = engines
    })
  })

  wrap.append(table, el('div', { class: 'list-row' }, add))
  return fieldShell(f.label, 'URLs must contain <code>{q}</code>, which is replaced by the query.', wrap, true)
}

/* ------------------------------------------------------- bespoke panels */

function renderIndexPanel(): HTMLElement {
  const wrap = el('div')
  const grid = el('div', { class: 'stat-grid' })

  const stat = (value: string, label: string) =>
    el('div', { class: 'stat' }, el('div', { class: 'stat-value', textContent: value }), el('div', {
      class: 'stat-label',
      textContent: label,
    }))

  const kinds = stats.byKind ?? {}
  grid.append(
    stat(String(stats.total), 'entries'),
    stat(String((kinds.lnk ?? 0) + (kinds.exe ?? 0)), 'programs'),
    stat(String(kinds.uwp ?? 0), 'store apps'),
    stat(String(kinds.url ?? 0), 'web links'),
    stat(stats.builtAt ? new Date(stats.builtAt).toLocaleTimeString() : '—', 'last built'),
  )

  const rebuild = el('button', { class: 'primary', textContent: 'Rebuild index now' })
  rebuild.addEventListener('click', () => {
    rebuild.disabled = true
    rebuild.textContent = 'Rebuilding…'
    void api.rebuildIndex().then((s) => {
      stats = s
      toast('Indexed ' + s.total + ' entries')
      renderSection()
    })
  })

  wrap.append(grid, el('div', { class: 'row-actions' }, rebuild))
  return wrap
}

function renderDataPanel(): HTMLElement {
  const wrap = el('div', { class: 'row-actions' })

  const usage = el('button', { class: 'danger', textContent: 'Forget launch history' })
  usage.addEventListener('click', () => {
    void api.clearUsage().then(() => toast('Launch history cleared'))
  })

  const icons = el('button', { class: 'ghost', textContent: 'Clear icon cache' })
  icons.addEventListener('click', () => {
    void api.clearIconCache().then(() => toast('Icon cache cleared'))
  })

  const reset = el('button', { class: 'danger', textContent: 'Reset all settings' })
  reset.addEventListener('click', () => {
    void api.resetConfig().then((c) => {
      config = c
      toast('Settings reset to defaults')
      renderSection()
    })
  })

  wrap.append(usage, icons, reset)
  return wrap
}

function renderAbout(): HTMLElement {
  const wrap = el('div', { class: 'about' })
  wrap.style.padding = '14px 16px'
  wrap.innerHTML = `
    <table class="keys">
      <tr><td><kbd>${config.hotkey}</kbd></td><td>Show or hide Lume</td></tr>
      <tr><td><kbd>↑</kbd> <kbd>↓</kbd></td><td>Move the selection</td></tr>
      <tr><td><kbd>Enter</kbd></td><td>Run the selected result</td></tr>
      <tr><td><kbd>Ctrl</kbd>+<kbd>Enter</kbd></td><td>Run as administrator</td></tr>
      <tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd></td><td>Open containing folder</td></tr>
      <tr><td><kbd>Tab</kbd></td><td>All actions for the selection</td></tr>
      <tr><td><kbd>Alt</kbd>+<kbd>1</kbd>…<kbd>9</kbd></td><td>Run result N directly</td></tr>
      <tr><td><kbd>Esc</kbd></td><td>Clear the query, then hide</td></tr>
    </table>
    <p>Themes are plain CSS. Copy a file in the themes folder, edit the custom
    properties at the top, and save — the running launcher restyles itself
    without a restart.</p>
    <p>Type <code>lume</code> in the launcher to reach the rebuild, themes and
    developer-tools commands without opening this window.</p>
  `
  return wrap
}

/* ------------------------------------------------------------------ render */

function buildField(f: Field): HTMLElement {
  switch (f.kind) {
    case 'toggle':
      return buildToggle(f)
    case 'text':
      return buildText(f)
    case 'number':
      return buildNumber(f)
    case 'slider':
      return buildSlider(f)
    case 'select':
      return buildSelect(f)
    case 'hotkey':
      return buildHotkey(f)
    case 'list':
      return buildList(f)
    case 'engines':
      return buildEngines(f)
    case 'custom':
      return f.render()
  }
}

function renderSection(mutate?: () => void) {
  mutate?.()
  const section = SECTIONS.find((s) => s.id === current)!
  const content = document.getElementById('content')!
  content.replaceChildren()
  content.scrollTop = 0

  content.append(el('h1', { class: 'section-title', textContent: section.title }))
  if (section.blurb) content.append(el('p', { class: 'section-blurb', textContent: section.blurb }))

  for (const group of section.groups()) {
    const box = el('div', { class: 'group' })
    box.append(el('div', { class: 'group-head', textContent: group.title }))
    for (const field of group.fields) box.append(buildField(field))
    content.append(box)
  }
}

function renderNav() {
  const nav = document.getElementById('nav')!
  nav.replaceChildren()
  for (const section of SECTIONS) {
    const button = el('button', {
      textContent: section.label,
      class: section.id === current ? 'active' : '',
    })
    button.addEventListener('click', () => {
      current = section.id
      renderNav()
      renderSection()
    })
    nav.append(el('li', {}, button))
  }
}

/* -------------------------------------------------------------- lifecycle */

document.getElementById('open-themes')!.addEventListener('click', () => void api.openThemesFolder())
document.getElementById('open-config')!.addEventListener('click', () => void api.openConfigFile())

api.onThemesChanged((list) => {
  themes = list
  if (current === 'appearance') renderSection()
})

api.onConfigChanged((c) => {
  // Only redraw for changes made elsewhere; our own writes already updated the
  // local copy, and redrawing would fight the control the user is holding.
  const changed = JSON.stringify(c) !== JSON.stringify(config)
  config = c
  if (changed && !document.activeElement?.matches('input, select')) renderSection()
})

void (async () => {
  ;[config, themes, stats] = await Promise.all([api.getConfig(), api.listThemes(), api.indexStats()])
  document.getElementById('version')!.textContent = 'v' + (await api.appVersion())
  renderNav()
  renderSection()
})()
