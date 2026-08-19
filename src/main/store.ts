import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

interface Usage {
  count: number
  last: number
}

interface StoreData {
  /** itemId -> overall usage */
  items: Record<string, Usage>
  /** query -> itemId -> times this query led to that item */
  queries: Record<string, Record<string, number>>
}

const HALF_LIFE_DAYS = 30
const MAX_QUERY_KEYS = 2000

class UsageStore {
  private data: StoreData = { items: {}, queries: {} }
  private file = ''
  private dirty = false
  private timer: NodeJS.Timeout | null = null

  init() {
    this.file = path.join(app.getPath('userData'), 'usage.json')
    try {
      if (fs.existsSync(this.file)) {
        this.data = JSON.parse(fs.readFileSync(this.file, 'utf8').replace(/^\uFEFF/, ''))
      }
    } catch (err) {
      console.error('[store] could not read usage.json:', err)
    }
    if (!this.data.items) this.data.items = {}
    if (!this.data.queries) this.data.queries = {}
  }

  record(itemId: string, query: string) {
    const now = Date.now()
    const item = (this.data.items[itemId] ??= { count: 0, last: 0 })
    item.count++
    item.last = now

    const q = query.trim().toLowerCase()
    if (q) {
      const bucket = (this.data.queries[q] ??= {})
      bucket[itemId] = (bucket[itemId] ?? 0) + 1
      this.trimQueries()
    }
    this.scheduleSave()
  }

  /**
   * 0..1 boost from how often and how recently this item was used.
   * Recency decays with a 30-day half-life so old habits fade out.
   */
  frecency(itemId: string): number {
    const u = this.data.items[itemId]
    if (!u) return 0
    const ageDays = (Date.now() - u.last) / 86_400_000
    const recency = Math.pow(0.5, ageDays / HALF_LIFE_DAYS)
    const frequency = Math.log1p(u.count) / Math.log1p(50)
    return Math.min(1, frequency * 0.6 + recency * 0.4)
  }

  /**
   * 0..1 boost for "you typed this exact prefix and picked that item".
   * This is what makes `pych` land on PyCharm from the second use onward.
   */
  queryAffinity(query: string, itemId: string): number {
    const q = query.trim().toLowerCase()
    if (!q) return 0
    let best = 0
    // An exact query match counts fully; a stored query that starts with what
    // has been typed so far counts partially, so the boost kicks in mid-typing.
    const exact = this.data.queries[q]?.[itemId]
    if (exact) best = Math.min(1, Math.log1p(exact) / Math.log1p(10))
    if (best < 1) {
      for (const [storedQuery, bucket] of Object.entries(this.data.queries)) {
        if (storedQuery === q || !storedQuery.startsWith(q)) continue
        const n = bucket[itemId]
        if (!n) continue
        const partial = Math.min(1, Math.log1p(n) / Math.log1p(10)) * 0.7
        if (partial > best) best = partial
      }
    }
    return best
  }

  private trimQueries() {
    const keys = Object.keys(this.data.queries)
    if (keys.length <= MAX_QUERY_KEYS) return
    // Drop the least-reinforced entries first.
    const weight = (k: string) => Object.values(this.data.queries[k]).reduce((a, b) => a + b, 0)
    keys.sort((a, b) => weight(a) - weight(b))
    for (const k of keys.slice(0, keys.length - MAX_QUERY_KEYS)) delete this.data.queries[k]
  }

  private scheduleSave() {
    this.dirty = true
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, 2000)
  }

  /** Forgets everything the ranker has learned. */
  clear() {
    this.data = { items: {}, queries: {} }
    this.dirty = true
    this.flush()
  }

  flush() {
    if (!this.dirty) return
    this.dirty = false
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.data), 'utf8')
    } catch (err) {
      console.error('[store] could not write usage.json:', err)
    }
  }
}

export const usage = new UsageStore()
