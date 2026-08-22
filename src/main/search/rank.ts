import { usage } from '../store.js'

/**
 * Where a result lands in the list.
 *
 * Three rules, in order of how strongly they bind:
 *
 * 1. Whatever this exact query has been used to launch goes first, full stop.
 *    Picking a result is the user saying what those characters mean to them,
 *    and a blended score cannot honour that: after one use, affinity is worth
 *    about 0.18 of a point, enough to lift a close second into first but not a
 *    weak third. So it is an override, not another weighted signal.
 *
 * 2. An app that has been launched at all outranks one that never has, when
 *    their matches are comparable. Not unconditionally — typing the exact name
 *    of a fresh install should still find it — so this is a bonus large enough
 *    to settle near-ties and small enough that a decisively better match wins.
 *
 * 3. Otherwise, match quality blended with how much the app is used, which is
 *    what keeps a daily driver on top when something similarly named appears.
 */

/** Above every organic score, which is clamped to 1, and below the explicit
 *  modes (calculator 1.15, keyword search 1.2, shell 1.3). */
export const PINNED_SCORE = 1.05

/**
 * Edge given to anything launched before. Tuned against the case it must not
 * break: typing "blender" when Blender has never been opened and a
 * once-launched "Blend for Visual Studio" also matches — the far better match
 * still has to win.
 */
const LAUNCHED_BONUS = 0.08

/** True when this query has been used to launch this item more than any other. */
export function isPinned(query: string, itemId: string, frecencyWeight: number): boolean {
  if (frecencyWeight <= 0) return false
  return usage.topForQuery(query) === itemId
}

/**
 * Organic score for a result, in 0..1. `matchScore` is the fuzzy quality of the
 * match; everything else comes from what the user has actually launched.
 */
export function rankScore(query: string, matchScore: number, itemId: string, frecencyWeight: number): number {
  if (frecencyWeight <= 0) return Math.min(1, matchScore)

  const learned = Math.max(usage.frecency(itemId), usage.queryAffinity(query, itemId) * 1.1)
  const launched = usage.timesLaunched(itemId) > 0 ? LAUNCHED_BONUS : 0
  // Clamped so no organic result can reach a pinned one's score.
  return Math.min(1, matchScore * (1 - frecencyWeight) + learned * frecencyWeight + launched)
}
