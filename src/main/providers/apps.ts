import path from 'node:path'
import type { AltAction, ResultItem } from '../../shared/types.js'
import { appIndex, type AppEntry } from '../indexer/apps.js'
import { scoreCandidate } from '../search/fuzzy.js'
import { rankScore } from '../search/rank.js'
import { settings } from '../settings.js'
import { usage } from '../store.js'

const MIN_SCORE = 0.28

function altActionsFor(entry: AppEntry): AltAction[] {
  const alts: AltAction[] = []
  if (entry.kind === 'uwp') {
    alts.push({ label: 'Copy app ID', action: { kind: 'copy', text: entry.launch } })
    return alts
  }
  if (entry.kind === 'url') {
    // A link has no file to elevate or reveal; the address is all there is.
    alts.push({ label: 'Copy link', action: { kind: 'copy', text: entry.launch } })
    return alts
  }
  const exe = entry.exePath ?? entry.launch
  alts.push({
    label: 'Run as administrator',
    // Elevate the shortcut rather than its target, as Explorer does: the .lnk
    // carries the arguments and working directory, which a bare exe loses.
    action: { kind: 'launch', target: entry.launch, admin: true },
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

    const score = rankScore(q, match.normalized, entry.id, cfg.frecencyWeight)

    out.push({
      id: entry.id,
      title: entry.name,
      subtitle: subtitleFor(entry),
      detail: pathOf(entry),
      iconKey: entry.iconPath,
      glyph: entry.kind === 'url' ? 'link' : 'app',
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

/**
 * What the row says when it is not the one selected: the shortcut's own
 * description if it wrote one, and otherwise what kind of thing it is. A path
 * is no help in choosing between results - it is only worth reading once you
 * have chosen - so it lives in `detail` instead.
 */
function subtitleFor(entry: AppEntry): string {
  if (entry.subtitle) return entry.subtitle
  return entry.kind === 'uwp' ? 'Store app' : entry.kind === 'url' ? 'Link' : 'Application'
}

/** The file behind the row, shown while it is selected. */
function pathOf(entry: AppEntry): string | undefined {
  if (entry.kind === 'uwp') return undefined
  if (entry.kind === 'url') return entry.launch
  return shortenPath(entry.exePath ?? entry.launch)
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
    subtitle: subtitleFor(entry),
    detail: pathOf(entry),
    iconKey: entry.iconPath,
    glyph: entry.kind === 'url' ? 'link' : 'app',
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
