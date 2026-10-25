import { CHANGELOG, type ChangelogEntry } from './changelog.js'

interface Release {
  minor: string
  title?: string
  entries: ChangelogEntry[]
}

/*
 * Like the studio's other apps: one item per x.y release (with all its
 * patches) under the month it came out, and the chosen one under its 960 x 170
 * banner. Every picture comes from the studio's banner template
 * (Marketing\banners) at 1920 x 340 and is kept in assets/whats-new/: from 0.4
 * on a release has its own, older ones take the one of the month they are
 * listed under (m10 for October).
 */
const PICTURES: Record<string, string> = {
  '0.4': '../assets/whats-new/0.4.webp',
  '0.5': '../assets/whats-new/0.5.webp',
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

function banner(release: Release): HTMLElement {
  const box = el('div', 'banner')
  const img = el('img')
  img.src = PICTURES[release.minor] ?? `../assets/whats-new/m${release.entries[0].date.slice(5, 7)}.webp`
  img.alt = `What’s new in ${release.minor}${release.title ? ': ' + release.title : ''}`
  box.append(img)
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
