/**
 * fzf-style fuzzy scorer.
 *
 * Two passes: a cheap subsequence check to reject non-matches, then a small DP
 * that rewards matches on word boundaries and consecutive runs. Targets here are
 * app names (a few dozen chars), so the O(n*m) table is never a problem.
 */

const SCORE_MATCH = 16
const BONUS_BOUNDARY = 8
const BONUS_CAMEL = 7
const BONUS_CONSECUTIVE = 8
const BONUS_FIRST_CHAR_MULT = 2
const PENALTY_GAP_START = -3
const PENALTY_GAP_EXTENSION = -1

export interface MatchResult {
  /** Raw score; higher is better. */
  score: number
  /** Indices into the target string that the query matched. */
  positions: number[]
}

const isAlnum = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
const isUpper = (c: number) => c >= 65 && c <= 90
const isLower = (c: number) => c >= 97 && c <= 122

/** Bonus for the target character at `i` starting a new "word". */
function boundaryBonus(text: string, i: number): number {
  if (i === 0) return BONUS_BOUNDARY
  const prev = text.charCodeAt(i - 1)
  const cur = text.charCodeAt(i)
  if (!isAlnum(prev)) return BONUS_BOUNDARY
  if (isLower(prev) && isUpper(cur)) return BONUS_CAMEL
  if (!(prev >= 48 && prev <= 57) && cur >= 48 && cur <= 57) return BONUS_CAMEL
  return 0
}

export function fuzzyMatch(query: string, text: string): MatchResult | null {
  if (!query) return { score: 0, positions: [] }
  const q = query.toLowerCase()
  const lower = text.toLowerCase()
  const n = text.length
  const m = q.length
  if (m > n) return null

  // Pass 1 — forward subsequence check, and narrow the DP window.
  let qi = 0
  let firstIdx = -1
  let lastIdx = -1
  for (let i = 0; i < n && qi < m; i++) {
    if (lower.charCodeAt(i) === q.charCodeAt(qi)) {
      if (qi === 0) firstIdx = i
      qi++
      lastIdx = i
    }
  }
  if (qi < m) return null

  // Pull `lastIdx` back to the earliest position that still fits the tail,
  // so the DP window stays tight on long titles.
  let qj = m - 1
  let end = lastIdx
  for (let i = lastIdx; i >= firstIdx && qj >= 0; i--) {
    if (lower.charCodeAt(i) === q.charCodeAt(qj)) {
      if (qj === m - 1) end = i
      qj--
    }
  }
  const start = firstIdx
  const width = end - start + 1

  // Pass 2 — DP over the window. `score[i][j]` = best score ending with
  // query[j] matched at window position i; `consec` tracks run length.
  const size = width * m
  const score = new Int32Array(size)
  const consec = new Uint16Array(size)
  const NEG = -1 << 20
  let maxScore = NEG
  let maxIdx = -1

  for (let j = 0; j < m; j++) {
    const qc = q.charCodeAt(j)
    let inGap = false
    let prevRowBest = NEG
    for (let i = 0; i < width; i++) {
      const idx = j * width + i
      const ti = start + i
      let best = NEG
      let run = 0

      if (lower.charCodeAt(ti) === qc) {
        if (j === 0) {
          best = SCORE_MATCH + boundaryBonus(text, ti) * BONUS_FIRST_CHAR_MULT
          run = 1
        } else if (i > 0) {
          const diagIdx = (j - 1) * width + (i - 1)
          const diag = score[diagIdx]
          if (diag > NEG) {
            const prevRun = consec[diagIdx]
            const bonus = prevRun > 0 ? BONUS_CONSECUTIVE : boundaryBonus(text, ti)
            best = diag + SCORE_MATCH + bonus
            run = prevRun + 1
          }
        }
      }

      // Carrying the previous cell forward models a gap in the match.
      if (i > 0) {
        const left = score[j * width + (i - 1)]
        if (left > NEG) {
          const gapped = left + (inGap ? PENALTY_GAP_EXTENSION : PENALTY_GAP_START)
          if (gapped > best) {
            best = gapped
            run = 0
            inGap = true
          } else if (best > NEG) {
            inGap = false
          }
        }
      }

      score[idx] = best
      consec[idx] = run
      if (j === m - 1 && best > maxScore) {
        maxScore = best
        maxIdx = i
      }
      prevRowBest = best
    }
  }

  if (maxIdx < 0 || maxScore <= NEG) return null

  // Backtrack the chosen path to recover highlight positions.
  const positions: number[] = []
  let i = maxIdx
  for (let j = m - 1; j >= 0 && i >= 0; ) {
    const ti = start + i
    const idx = j * width + i
    const matchedHere =
      lower.charCodeAt(ti) === q.charCodeAt(j) &&
      (j === 0 ? true : i > 0 && score[(j - 1) * width + (i - 1)] > NEG) &&
      consec[idx] > 0
    if (matchedHere) {
      positions.push(ti)
      i--
      j--
    } else {
      i--
    }
  }
  positions.reverse()

  return { score: maxScore, positions }
}

/**
 * Normalised 0..1 score. Divides by the best achievable score for this query
 * length so short and long queries stay comparable, then nudges shorter titles
 * up so "Steam" outranks "Steam Cleanup Utility" for the query "steam".
 *
 * The density factor is what keeps the long tail out: a match scattered across
 * a whole filename ("s..t..e..a..m" inside "smartd_mailer.conf.sample.ps1") is
 * technically a subsequence but is never what the user meant.
 */
export function fuzzyScore(query: string, text: string): MatchResult & { normalized: number } | null {
  const r = fuzzyMatch(query, text)
  if (!r) return null
  const ideal = query.length * (SCORE_MATCH + BONUS_CONSECUTIVE) + BONUS_BOUNDARY * BONUS_FIRST_CHAR_MULT
  let normalized = r.score / ideal
  const lengthRatio = query.length / Math.max(text.length, 1)
  normalized = normalized * 0.85 + lengthRatio * 0.15

  if (r.positions.length > 1) {
    // An acronym ("vsc" -> Visual Studio Code) is spread out by definition, so
    // it is exempt: every one of its characters lands on a word start.
    const allAtWordStart = r.positions.every((i) => boundaryBonus(text, i) > 0)
    if (!allAtWordStart) {
      const span = r.positions[r.positions.length - 1] - r.positions[0] + 1
      const density = r.positions.length / span
      normalized *= 0.35 + 0.65 * density
    }
  }

  // Starting mid-word ("ard" inside "smartd") is a weaker signal than starting
  // where a word does.
  if (r.positions.length && boundaryBonus(text, r.positions[0]) === 0) normalized *= 0.78

  return { ...r, normalized: Math.max(0, Math.min(1, normalized)) }
}

/**
 * Best score across a set of haystacks (name, exe name, keywords). Returns
 * positions only when the winner is the first haystack, since that is the only
 * string the UI highlights.
 */
export function scoreCandidate(query: string, primary: string, extras: string[] = []) {
  let best = fuzzyScore(query, primary)
  let bestNorm = best ? best.normalized : -1
  let positions = best ? best.positions : []
  for (const e of extras) {
    const r = fuzzyScore(query, e)
    // Secondary fields are worth clearly less than a hit on the visible title,
    // since the user cannot see what they matched against.
    if (r && r.normalized * 0.62 > bestNorm) {
      bestNorm = r.normalized * 0.62
      positions = []
    }
  }
  if (bestNorm < 0) return null
  return { normalized: bestNorm, positions }
}
