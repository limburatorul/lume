import path from 'node:path'
import type { AltAction, ResultItem } from '../../shared/types.js'
import { appIndex, type AppEntry } from '../indexer/apps.js'
import { scoreCandidate } from '../search/fuzzy.js'
import { settings } from '../settings.js'
import { usage } from '../store.js'

const MIN_SCORE = 0.28

function altActionsFor(entry: AppEntry): AltAction[] {
  const alts: AltAction[] = []
  if (entry.kind === 'uwp') {
    alts.push({ label: 'Copy app ID', action: { kind: 'copy', text: entry.launch } })
    return alts
  }
  const exe = entry.exePath ?? entry.launch
  alts.push({
    label: 'Run as administrator',
    action: { kind: 'launch', target: exe, admin: true },
    hint: 'Ctrl+Enter',
  })
  alts.push({
    label: 'Open containing folder',
    action: { kind: 'revealPath', path: exe },
    hint: 'Ctrl+Shift+Enter',
  })
  alts.push({ label: 'Copy path', action: { kind: 'copy', text: exe } })
  return alts
}

export function appsProvider(query: string): ResultItem[] {
  const q = query.trim()
  if (!q) return []
  const cfg = settings.get()
  const out: ResultItem[] = []

  for (const entry of appIndex.all) {
    const match = scoreCandidate(q, entry.name, entry.keywords)
    if (!match || match.normalized < MIN_SCORE) continue

    // Learned signal: general usage plus "this exact query led here before".
    const learned = Math.max(usage.frecency(entry.id), usage.queryAffinity(q, entry.id) * 1.1)
    const score = match.normalized * (1 - cfg.frecencyWeight) + learned * cfg.frecencyWeight

    out.push({
      id: entry.id,
      title: entry.name,
      subtitle: entry.kind === 'uwp' ? 'Store app' : shortenPath(entry.subtitle),
      iconKey: entry.iconPath,
      glyph: entry.kind === 'url' ? '🔗' : '▢',
      score,
      provider: 'apps',
      matches: match.positions,
      action:
        entry.kind === 'uwp'
          ? { kind: 'launchUwp', appId: entry.launch }
          : entry.kind === 'url'
            ? { kind: 'openUrl', url: entry.launch }
            : { kind: 'openPath', path: entry.launch },
      altActions: altActionsFor(entry),
    })
  }

  return out
}

/** Keeps subtitles readable: "…\JetBrains\PyCharm\bin\pycharm64.exe". */
function shortenPath(p: string): string {
  if (!p.includes('\\') && !p.includes('/')) return p
  const parts = p.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 3) return p
  return '…' + path.sep + parts.slice(-3).join(path.sep)
}

/** Home screen: the things you actually open, most recent first. */
export function frequentApps(limit: number): ResultItem[] {
  const scored = appIndex.all
    .map((entry) => ({ entry, score: usage.frecency(entry.id) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  return scored.map(({ entry, score }) => ({
    id: entry.id,
    title: entry.name,
    subtitle: entry.kind === 'uwp' ? 'Store app' : shortenPath(entry.subtitle),
    iconKey: entry.iconPath,
    glyph: entry.kind === 'url' ? '🔗' : '▢',
    score,
    provider: 'apps',
    action:
      entry.kind === 'uwp'
        ? { kind: 'launchUwp', appId: entry.launch }
        : entry.kind === 'url'
          ? { kind: 'openUrl', url: entry.launch }
          : { kind: 'openPath', path: entry.launch },
    altActions: altActionsFor(entry),
  }))
}
