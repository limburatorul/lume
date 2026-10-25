import fs from 'node:fs'
import path from 'node:path'
import type { ResultItem } from '../../shared/types.js'
import { readCard, sharedRoot } from '../ecosystem.js'
import { scoreCandidate } from '../search/fuzzy.js'

interface Entry {
  id: string
  app: string
  /** The sharing app's own exe: Reel's films run through explorer.exe, whose folder icon says nothing. An item
   *  may name its own picture first (File Labs' pinned files and shortcuts, 0.5.2): `icon|card.exe`. */
  icon: string
  title: string
  subtitle: string
  detail?: string
  kind: string
  exe: string
  args: string[]
}

const MIN_SCORE = 0.35
/** The search runs on every keystroke, so the files are read at most this often. */
const TTL = 30_000

const GLYPHS: Record<string, string> = { game: 'play', film: 'play', task: 'file', folder: 'file', file: 'file', shortcut: 'app', backup: 'archive' }

/*
 * The items file is written by another app and run as a command line, so it is
 * untrusted: only a local .exe that exists may be started, with a short, plain
 * argument list. run.exe is not required to be the card's exe - Reel runs its
 * player and Planner the copy inside each plan folder.
 */
const MAX_ARGS = 8
const MAX_ARG_LENGTH = 1024
const CONTROL = /[\u0000-\u001f\u007f]/

function isLocalExe(exe: string, seen: Map<string, boolean>): boolean {
  let ok = seen.get(exe)
  if (ok === undefined) {
    // A drive path only: a UNC path would start a program from the network.
    ok = /^[a-z]:\\/i.test(exe) && /\.exe$/i.test(exe) && !CONTROL.test(exe)
    if (ok) {
      try {
        ok = fs.statSync(exe).isFile()
      } catch {
        ok = false
      }
    }
    seen.set(exe, ok)
  }
  return ok
}

let cache: { root: string; at: number; entries: Entry[] } | null = null

/**
 * Launcher entries shared by the other Protagonist Labs apps (Shelf's games,
 * Reel's films, Planner's tasks, File Labs' folders, Stash's Thunderbird
 * backups): every data\<id>.items.json whose app is still installed.
 */
function load(root: string): Entry[] {
  const dir = path.join(root, 'data')
  let files: string[] = []
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.items.json'))
  } catch {
    return []
  }
  const entries: Entry[] = []
  const exes = new Map<string, boolean>()
  for (const file of files) {
    const appId = file.slice(0, -'.items.json'.length)
    const card = readCard(appId)
    if (!card) continue
    let doc: { schema?: unknown; items?: unknown }
    try {
      doc = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8').replace(/^﻿/, ''))
    } catch {
      continue
    }
    if (doc?.schema !== 1 || !Array.isArray(doc.items)) continue
    for (const item of doc.items) {
      const run = item?.run
      if (typeof item?.title !== 'string' || !item.title.trim()) continue
      if (typeof run?.exe !== 'string' || !isLocalExe(run.exe, exes)) continue
      const args: string[] = Array.isArray(run.args) ? run.args.filter((a: unknown) => typeof a === 'string') : []
      if (args.length > MAX_ARGS || args.some((a) => a.length > MAX_ARG_LENGTH || CONTROL.test(a))) continue
      const kind = typeof item.kind === 'string' ? item.kind : 'item'
      // Its own icon: a drive path only (a network path would be opened just to draw it), and no '|', which separates
      // icon candidates.
      const own = typeof item.icon === 'string' && /^[a-z]:\\/i.test(item.icon) && item.icon.length <= MAX_ARG_LENGTH
        && !CONTROL.test(item.icon) && !item.icon.includes('|') ? item.icon + '|' : ''
      entries.push({
        id: 'pl:' + appId + ':' + run.exe + ' ' + args.join(' '),
        app: appId,
        icon: own + card.exe,
        title: item.title,
        subtitle: card.name + ' · ' + kind,
        detail: typeof item.subtitle === 'string' && item.subtitle ? item.subtitle : undefined,
        kind,
        exe: run.exe,
        args,
      })
    }
  }
  return entries
}

function entries(): Entry[] {
  const root = sharedRoot()
  // ponytail: a 30 s TTL instead of a file watcher, so a new game shows up within half a minute.
  if (!cache || cache.root !== root || Date.now() - cache.at > TTL) {
    cache = { root, at: Date.now(), entries: load(root) }
  }
  return cache.entries
}

/** How many launchable items each sister app shares, by app id. */
export function sisterCounts(): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const e of entries()) counts[e.app] = (counts[e.app] ?? 0) + 1
  return counts
}

export function sistersProvider(query: string): ResultItem[] {
  const q = query.trim()
  if (q.length < 2) return []
  const out: ResultItem[] = []
  for (const e of entries()) {
    const match = scoreCandidate(q, e.title)
    if (!match || match.normalized < MIN_SCORE) continue
    out.push({
      id: e.id,
      title: e.title,
      subtitle: e.subtitle,
      detail: e.detail,
      iconKey: e.icon,
      glyph: GLYPHS[e.kind] ?? 'app',
      // Just under an app match of the same quality: typing "steam" should
      // still reach Steam itself before a game that happens to share a word.
      score: match.normalized * 0.95,
      provider: 'sisters',
      matches: match.positions,
      action: { kind: 'launch', target: e.exe, args: e.args },
    })
  }
  return out
}
