import type { Bootstrap, ResultItem, ThemeInfo } from '../shared/types.js'
import type { LumeApi } from '../preload/index.js'

declare global {
  interface Window {
    lume: LumeApi
  }
}

const api = window.lume

const el = {
  root: document.getElementById('root') as HTMLDivElement,
  input: document.getElementById('input') as HTMLInputElement,
  glyph: document.getElementById('search-glyph') as HTMLSpanElement,
  badge: document.getElementById('badge') as HTMLSpanElement,
  wrap: document.getElementById('results-wrap') as HTMLDivElement,
  list: document.getElementById('results') as HTMLUListElement,
  context: document.getElementById('context') as HTMLDivElement,
  contextList: document.getElementById('context-list') as HTMLUListElement,
  theme: document.getElementById('theme') as HTMLStyleElement,
  overrides: document.getElementById('overrides') as HTMLStyleElement,
  emptyState: document.getElementById('empty-state') as HTMLDivElement,
  emptyTitle: document.getElementById('empty-title') as HTMLDivElement,
  emptyHints: document.getElementById('empty-hints') as HTMLDivElement,
}

let items: ResultItem[] = []
let selected = 0
let contextOpen = false
let contextSelected = 0
let queryToken = 0
let config: Bootstrap['config'] | null = null
/** Entries in the app index; 0 while the first scan is still running. */
let indexCount = 0

/** Icon bitmaps, keyed by the `iconKey` the main process handed us. */
const iconCache = new Map<string, string | null>()

/* ------------------------------------------------------------------ render */

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  )
}

/** Wraps matched characters in <mark> so the fuzzy hit is visible. */
function highlight(text: string, positions?: number[]) {
  if (!positions?.length) return escapeHtml(text)
  const set = new Set(positions)
  let html = ''
  let inMark = false
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i)
    if (hit && !inMark) {
      html += '<mark>'
      inMark = true
    } else if (!hit && inMark) {
      html += '</mark>'
      inMark = false
    }
    html += escapeHtml(text[i])
  }
  if (inMark) html += '</mark>'
  return html
}

function loadIcon(key: string, target: HTMLElement) {
  const cached = iconCache.get(key)
  if (cached !== undefined) {
    if (cached) target.innerHTML = '<img alt="" src="' + cached + '">'
    return
  }
  void api.icon(key).then((data) => {
    iconCache.set(key, data)
    // The row may have been replaced by a newer query while we waited.
    if (data && target.isConnected) target.innerHTML = '<img alt="" src="' + data + '">'
  })
}

/**
 * Explains why the list is empty instead of leaving a bare search box. On a
 * fresh install there is no usage history to draw a home screen from, so
 * without this the first thing a new user sees is a blank bar.
 */
function renderEmptyState() {
  const query = el.input.value.trim()
  el.emptyHints.replaceChildren()

  if (query) {
    el.emptyTitle.textContent = 'No results for "' + query + '"'
  } else if (!indexCount) {
    el.emptyTitle.textContent = 'Indexing applications…'
  } else {
    el.emptyTitle.textContent = 'Type to search ' + indexCount.toLocaleString() + ' apps and commands'
    const prefix = config?.shellPrefix ?? '>'
    const engine = config?.searchEngines.find((e) => e.keyword === config?.defaultEngine)
    const hints: Array<[string, string]> = [
      ['2+2', 'calculate'],
      [(engine?.keyword ?? 'g') + ' …', 'search ' + (engine?.name ?? 'the web')],
      [prefix + ' …', 'run a command'],
      ['settings', 'open settings'],
    ]
    for (const [key, label] of hints) {
      const span = document.createElement('span')
      const code = document.createElement('code')
      code.textContent = key
      span.append(code, document.createTextNode(label))
      el.emptyHints.append(span)
    }
  }
  el.emptyState.hidden = false
}

function renderResults() {
  el.list.replaceChildren()

  if (!items.length) {
    el.wrap.classList.add('empty')
    renderEmptyState()
    reportHeight()
    return
  }
  el.wrap.classList.remove('empty')
  el.emptyState.hidden = true

  items.forEach((item, index) => {
    const li = document.createElement('li')
    li.className = 'row' + (index === selected ? ' selected' : '')
    li.setAttribute('role', 'option')
    li.dataset.index = String(index)

    const icon = document.createElement('div')
    icon.className = 'row-icon'
    icon.innerHTML = '<span class="glyph">' + escapeHtml(item.glyph ?? '▢') + '</span>'
    if (item.iconKey) loadIcon(item.iconKey, icon)

    const text = document.createElement('div')
    text.className = 'row-text'
    const title = document.createElement('div')
    title.className = 'row-title'
    title.innerHTML = highlight(item.title, item.matches)
    const sub = document.createElement('div')
    sub.className = 'row-sub'
    sub.textContent = item.subtitle ?? ''
    text.append(title, sub)

    const hint = document.createElement('div')
    hint.className = 'row-hint'
    hint.textContent = index < 9 ? 'Alt+' + (index + 1) : ''
    if (!hint.textContent) hint.style.display = 'none'

    li.append(icon, text, hint)
    li.addEventListener('mouseenter', () => setSelected(index, false))
    li.addEventListener('click', () => runPrimary())
    li.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      setSelected(index, false)
      openContext()
    })
    el.list.append(li)
  })

  reportHeight()
}

function renderContext() {
  const alts = items[selected]?.altActions ?? []
  el.contextList.replaceChildren()
  alts.forEach((alt, i) => {
    const li = document.createElement('li')
    li.className = 'context-item' + (i === contextSelected ? ' selected' : '')
    const label = document.createElement('span')
    label.textContent = alt.label
    const hint = document.createElement('span')
    hint.className = 'hint'
    hint.textContent = alt.hint ?? ''
    li.append(label, hint)
    li.addEventListener('mouseenter', () => {
      contextSelected = i
      renderContext()
    })
    li.addEventListener('click', () => runAlt(i))
    el.contextList.append(li)
  })
  reportHeight()
}

function setSelected(index: number, scroll = true) {
  if (!items.length) return
  selected = Math.max(0, Math.min(index, items.length - 1))
  const rows = el.list.children
  for (let i = 0; i < rows.length; i++) rows[i].classList.toggle('selected', i === selected)
  if (scroll) rows[selected]?.scrollIntoView({ block: 'nearest' })
  if (contextOpen) closeContext()
}

let heightFrame = 0
function reportHeight() {
  cancelAnimationFrame(heightFrame)
  heightFrame = requestAnimationFrame(() => {
    api.reportHeight(Math.ceil(el.root.getBoundingClientRect().height))
  })
}

/* ------------------------------------------------------------------- query */

async function runQuery() {
  const text = el.input.value
  const token = ++queryToken
  updateBadge(text)
  const res = await api.query(text, token)
  // A newer keystroke already fired; drop this response.
  if (res.token !== queryToken) return
  items = res.items
  selected = 0
  closeContext()
  renderResults()
}

function updateBadge(text: string) {
  if (!config) return
  const trimmed = text.trim()
  if (config.shellPrefix && trimmed.startsWith(config.shellPrefix)) {
    el.badge.textContent = config.shell
    return
  }
  const head = trimmed.split(/\s+/)[0]?.toLowerCase()
  const engine = config.searchEngines.find((e) => e.keyword.toLowerCase() === head)
  el.badge.textContent = engine ? engine.name : ''
}

/* ------------------------------------------------------------------ actions */

function runPrimary() {
  const item = items[selected]
  if (!item) return
  void api.execute(item.id, null)
}

function runAlt(index: number) {
  const item = items[selected]
  if (!item?.altActions?.[index]) return
  void api.execute(item.id, index)
  closeContext()
}

/** Runs the alternate action tagged with the given keyboard hint, if any. */
function runAltByHint(hint: string) {
  const alts = items[selected]?.altActions
  if (!alts) return false
  const index = alts.findIndex((a) => a.hint === hint)
  if (index < 0) return false
  runAlt(index)
  return true
}

function openContext() {
  if (!items[selected]?.altActions?.length) return
  contextOpen = true
  contextSelected = 0
  el.context.hidden = false
  renderContext()
}

function closeContext() {
  if (!contextOpen) return
  contextOpen = false
  el.context.hidden = true
  el.contextList.replaceChildren()
  reportHeight()
}

function reset() {
  el.input.value = ''
  items = []
  selected = 0
  closeContext()
  el.badge.textContent = ''
  void runQuery()
}

/* ------------------------------------------------------------------- input */

let queryTimer = 0
/** Honours the configured search delay; 0 means search on every keystroke. */
function scheduleQuery() {
  const delay = config?.searchDelay ?? 0
  window.clearTimeout(queryTimer)
  if (delay <= 0) return void runQuery()
  queryTimer = window.setTimeout(() => void runQuery(), delay)
}

el.input.addEventListener('input', () => scheduleQuery())

document.addEventListener('keydown', (e) => {
  const alts = items[selected]?.altActions ?? []

  if (e.key === 'Escape') {
    e.preventDefault()
    if (contextOpen) closeContext()
    else if (el.input.value) reset()
    else api.hide()
    return
  }

  if (contextOpen) {
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
      e.preventDefault()
      contextSelected = (contextSelected + 1) % alts.length
      renderContext()
      return
    }
    if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
      e.preventDefault()
      contextSelected = (contextSelected - 1 + alts.length) % alts.length
      renderContext()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      runAlt(contextSelected)
      return
    }
  }

  if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
    e.preventDefault()
    setSelected(selected + 1 >= items.length ? 0 : selected + 1)
    return
  }
  if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
    e.preventDefault()
    setSelected(selected - 1 < 0 ? items.length - 1 : selected - 1)
    return
  }
  if (e.key === 'PageDown') {
    e.preventDefault()
    setSelected(selected + 5)
    return
  }
  if (e.key === 'PageUp') {
    e.preventDefault()
    setSelected(selected - 5)
    return
  }

  if (e.key === 'Tab') {
    e.preventDefault()
    if (contextOpen) closeContext()
    else openContext()
    return
  }

  if (e.key === 'Enter') {
    e.preventDefault()
    if (e.ctrlKey && e.shiftKey) {
      if (runAltByHint('Ctrl+Shift+Enter')) return
    }
    if (e.ctrlKey) {
      if (runAltByHint('Ctrl+Enter')) return
    }
    runPrimary()
    return
  }

  // Alt+1..9 jumps straight to a numbered result.
  if (e.altKey && /^[1-9]$/.test(e.key)) {
    e.preventDefault()
    const index = Number(e.key) - 1
    if (items[index]) {
      selected = index
      runPrimary()
    }
    return
  }

  // Any other typing belongs in the query box, wherever focus happens to be.
  if (document.activeElement !== el.input && e.key.length === 1 && !e.ctrlKey && !e.altKey) {
    el.input.focus()
  }
})

/* --------------------------------------------------------------- lifecycle */

/**
 * Settings that override the theme are emitted as a second stylesheet after
 * the theme's, so a blank override simply leaves the theme's value standing.
 */
function overrideCss(cfg: Bootstrap['config']): string {
  const rules: string[] = []
  const push = (prop: string, value: string | number | null, unit = '') => {
    if (value === null || value === '') return
    rules.push('  ' + prop + ': ' + value + unit + ';')
  }
  const ui = cfg.ui
  push('--surface-opacity', ui.surfaceOpacity)
  push('--radius', ui.cornerRadius, 'px')
  push('--row-height', ui.rowHeight, 'px')
  push('--icon-size', ui.iconSize, 'px')
  push('--input-size', ui.queryFontSize, 'px')
  push('--title-size', ui.resultFontSize, 'px')
  push('--subtitle-size', ui.resultSubFontSize, 'px')
  if (ui.fontFamily) rules.push('  --font: ' + JSON.stringify(ui.fontFamily) + ', system-ui, sans-serif;')
  push('--anim-duration', cfg.useAnimation ? cfg.animationSpeed : 0, 'ms')
  return rules.length ? ':root {\n' + rules.join('\n') + '\n}' : ''
}

function applyBootstrap(b: Bootstrap) {
  config = b.config
  indexCount = b.indexCount
  el.theme.textContent = b.css
  el.overrides.textContent = overrideCss(b.config)
  document.documentElement.dataset.backdrop = b.config.backdrop
  document.documentElement.dataset.animate = String(b.config.useAnimation)
  el.input.placeholder = b.config.showPlaceholder ? b.config.placeholder : ''
  reportHeight()
}

api.onThemeCss((css) => {
  el.theme.textContent = css
  reportHeight()
})

api.onThemeList((_list: ThemeInfo[]) => {
  /* Reserved for a future theme picker; the list is already kept in main. */
})

api.onConfigChanged((b) => {
  applyBootstrap(b)
  void runQuery()
})

api.onShown(() => {
  const mode = config?.lastQueryMode ?? 'empty'
  if (mode === 'empty') el.input.value = ''
  el.input.focus()
  if (mode === 'select') el.input.select()
  else el.input.setSelectionRange(el.input.value.length, el.input.value.length)
  // Re-run so results (and the home screen) reflect the latest usage data.
  void runQuery()
})

api.onHidden(() => {
  // With 'empty' the box is cleared on the way in; clearing here too would
  // throw away a query the user may want back under the other modes.
  closeContext()
})

api.onIndexUpdated((count) => {
  indexCount = count
  // Refresh either way: a query may match newly indexed apps, and an empty one
  // needs to stop saying "Indexing…".
  void runQuery()
})

void (async () => {
  applyBootstrap(await api.bootstrap())
  el.input.focus()
  await runQuery()
})()
