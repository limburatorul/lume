import type { ResultItem } from '../../shared/types.js'
import { appsProvider, frequentApps } from '../providers/apps.js'
import { calculatorProvider } from '../providers/calculator.js'
import { shellProvider } from '../providers/shell.js'
import { systemProvider } from '../providers/system.js'
import { websearchProvider } from '../providers/websearch.js'
import { settings } from '../settings.js'
import { isPinned, PINNED_SCORE } from './rank.js'

/**
 * Runs every provider and merges their results. Providers are synchronous and
 * cheap (the app index is already in memory), so a query is a single tick - no
 * debouncing or partial-result streaming needed at this scale.
 */
export function search(rawQuery: string): ResultItem[] {
  const query = rawQuery.trim()
  const cfg = settings.get()

  if (!query) return frequentApps(cfg.maxResults)

  // The shell prefix is an explicit mode switch: nothing else should compete.
  if (cfg.shellPrefix && query.startsWith(cfg.shellPrefix)) {
    return shellProvider(query).slice(0, cfg.maxResults)
  }

  const items = [
    ...calculatorProvider(query),
    ...appsProvider(query),
    ...systemProvider(query),
    ...websearchProvider(query),
  ]

  // Applied here rather than in a provider so a learned system command gets the
  // same treatment as a learned app. See rank.ts for why this overrides rather
  // than nudges.
  for (const item of items) {
    if (isPinned(query, item.id, cfg.frecencyWeight)) item.score = PINNED_SCORE
  }

  items.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    // Stable, predictable tiebreak: shorter titles read as the better match.
    if (a.title.length !== b.title.length) return a.title.length - b.title.length
    return a.title.localeCompare(b.title)
  })

  // Guard against an app and a system command colliding on the same id.
  const seen = new Set<string>()
  const unique: ResultItem[] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    unique.push(item)
    if (unique.length >= cfg.maxResults) break
  }
  return unique
}
