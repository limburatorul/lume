import { CHANGELOG, type ChangelogEntry } from './changelog.js'

interface Release {
  minor: string
  title?: string
  entries: ChangelogEntry[]
}

/*
 * Like the studio's other apps: one item per x.y release (with all its
 * patches) under the month it came out, and the chosen one under its 960 x 170
 * banner. From 0.4 on a release has a picture of its own, made from the
 * studio's banner template (Marketing\banners) at 1920 x 340 and kept in
 * assets/whats-new/; older ones get Lume's colours, their version and title.
 */
const PICTURES: Record<string, string> = {
  '0.4': '../assets/whats-new/0.4.webp',
}

const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', o)

function groupReleases(entries: ChangelogEntry[]): Release[] {
  const releases: Release[] = []
  for (const e of entries) {
    const minor = e.version.split('.').slice(0, 2).join('.')
    const last = releases[releases.length - 1]
    if (last?.minor === minor) last.entries.push(e)
    else releases.push({ minor, entries: [e] })
    if (e.title) releases[releases.length - 1].title = e.title
  }
  return releases
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text) node.textContent = text
  return node
}

/** A line of the notes with its **bold** parts in bold, built as text nodes. */
function rich(text: string): HTMLLIElement {
  const li = el('li')
  text.split('**').forEach((part, i) => {
    if (part) li.append(i % 2 ? el('strong', '', part) : document.createTextNode(part))
  })
  return li
}

// Lume's colours behind a search bar and a few result rows, drawn rather than pictured.
const DRAWN = `<svg viewBox="0 0 960 170" aria-hidden="true">
  <defs>
    <linearGradient id="wn-bg" x1="0" y1="0" x2="1" y2=".6"><stop offset="0" stop-color="#120f26"/><stop offset="1" stop-color="#1c1638"/></linearGradient>
    <radialGradient id="wn-glow"><stop offset="0" stop-color="#8b7cf6" stop-opacity=".45"/><stop offset="1" stop-color="#8b7cf6" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="960" height="170" fill="url(#wn-bg)"/>
  <ellipse cx="760" cy="40" rx="280" ry="190" fill="url(#wn-glow)"/>
  <g transform="translate(560 26) rotate(-6 170 60)" opacity=".9">
    <rect width="340" height="132" rx="14" fill="#120f26" fill-opacity=".7" stroke="#c8bcff" stroke-opacity=".35"/>
    <circle cx="26" cy="24" r="8" fill="none" stroke="#fff" stroke-width="2"/><path d="M32 30l6 6" stroke="#fff" stroke-width="2"/>
    <rect x="50" y="20" width="120" height="8" rx="4" fill="#fff" opacity=".85"/><rect x="176" y="16" width="2" height="16" fill="#c8bcff"/>
    <rect x="10" y="46" width="320" height="26" rx="7" fill="#8b7cf6" opacity=".4"/>
    <rect x="18" y="52" width="14" height="14" rx="4" fill="#59d499"/><rect x="42" y="55" width="140" height="6" rx="3" fill="#fff" opacity=".8"/>
    <rect x="18" y="82" width="14" height="14" rx="4" fill="#ffa53d"/><rect x="42" y="85" width="110" height="6" rx="3" fill="#fff" opacity=".55"/>
    <rect x="18" y="108" width="14" height="14" rx="4" fill="#4c8dff"/><rect x="42" y="111" width="160" height="6" rx="3" fill="#fff" opacity=".55"/>
  </g>
</svg>`

function banner(release: Release): HTMLElement {
  const box = el('div', 'banner')
  const picture = PICTURES[release.minor]
  if (picture) {
    const img = el('img')
    img.src = picture
    img.alt = `What’s new in ${release.minor}${release.title ? ': ' + release.title : ''}`
    box.append(img)
    return box
  }
  box.innerHTML = DRAWN
  const words = el('div', 'banner-text')
  words.append(el('div', 'kicker', 'What’s new in'), el('div', 'version', release.minor))
  if (release.title) words.append(el('div', 'title', release.title))
  box.append(words)
  return box
}

const releases = groupReleases(CHANGELOG)
const nav = document.getElementById('nav')!
const main = document.getElementById('release')!
let selected = -1

function show(i: number) {
  if (i === selected || i < 0 || i >= releases.length) return
  selected = i
  const release = releases[i]
  nav.querySelectorAll('button').forEach((b, k) => {
    b.classList.toggle('active', k === i)
    if (k === i) {
      b.setAttribute('aria-current', 'true')
      b.scrollIntoView({ block: 'nearest' })
    } else b.removeAttribute('aria-current')
  })
  main.replaceChildren(banner(release))
  for (const entry of release.entries) {
    const section = el('section', 'entry')
    const head = el('div', 'entry-version', 'v' + entry.version)
    head.append(el('span', 'entry-date', fmt(entry.date, { month: 'long', day: 'numeric', year: 'numeric' })))
    const list = el('ul')
    list.append(...entry.changes.map(rich))
    section.append(head, list)
    main.append(section)
  }
  main.scrollTop = 0
}

let month = ''
releases.forEach((r, i) => {
  const newest = r.entries[0].date
  const m = fmt(newest, { month: 'long', year: 'numeric' })
  if (m !== month) nav.append(el('div', 'month', (month = m)))
  const button = el('button')
  button.title = r.title ?? ''
  button.append(
    el('span', '', r.minor),
    el('span', 'meta', i === 0 ? 'Latest' : r.entries.length > 1 ? `${r.entries.length} updates` : fmt(newest, { month: 'short', day: 'numeric' })),
  )
  button.addEventListener('click', () => show(i))
  nav.append(button)
})

document.getElementById('close')!.addEventListener('click', () => window.close())
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close()
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    show(Math.max(0, Math.min(releases.length - 1, selected + (e.key === 'ArrowDown' ? 1 : -1))))
  }
})

// The version running, which is the newest unless this build is older than its own notes.
const running = new URLSearchParams(location.search).get('v') ?? ''
show(Math.max(0, releases.findIndex((r) => running.startsWith(r.minor + '.'))))
