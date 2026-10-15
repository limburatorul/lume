import fs from 'node:fs'
import path from 'node:path'
import type { ResultItem } from '../../shared/types.js'
import { readCard, sharedRoot } from '../ecosystem.js'
import { scoreCandidate } from '../search/fuzzy.js'

interface Entry {
  id: string
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

const GLYPHS: Record<string, string> = { game: 'play', film: 'play', task: 'file', folder: 'file' }

let cache: { root: string; at: number; entries: Entry[] } | null = null

/**
 * Launcher entries shared by the other Protagonist Labs apps (Shelf's games,
 * Reel's films, Planner's tasks, File Labs' folders): every
 * data\<id>.items.json whose app is still installed.
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
      if (typeof run?.exe !== 'string' || !run.exe) continue
      const args = Array.isArray(run.args) ? run.args.filter((a: unknown) => typeof a === 'string') : []
      const kind = typeof item.kind === 'string' ? item.kind : 'item'
      entries.push({
        id: 'pl:' + appId + ':' + run.exe + ' ' + args.join(' '),
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
      iconKey: e.exe,
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
