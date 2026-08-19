import type { ResultItem } from '../../shared/types.js'
import { settings } from '../settings.js'

const URL_RE = /^(https?:\/\/|www\.)\S+$/i
const BARE_DOMAIN_RE =
  /^(?!\d+(\.\d+)*$)[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*\.(com|net|org|io|dev|ro|co|app|ai|gg|xyz|me|to|sh|edu|gov|info|eu|uk|de)(\/\S*)?$/i

function buildUrl(template: string, query: string) {
  return template.replace('{q}', encodeURIComponent(query))
}

export function websearchProvider(query: string): ResultItem[] {
  const q = query.trim()
  if (!q) return []
  const cfg = settings.get()
  const out: ResultItem[] = []

  // 1. Direct navigation: "github.com/foo" or a full URL.
  if (URL_RE.test(q) || BARE_DOMAIN_RE.test(q)) {
    const url = /^https?:\/\//i.test(q) ? q : 'https://' + q
    out.push({
      id: 'url:open',
      title: 'Open ' + q,
      subtitle: url,
      glyph: '🌐',
      score: 1.1,
      provider: 'web',
      action: { kind: 'openUrl', url },
      altActions: [{ label: 'Copy URL', action: { kind: 'copy', text: url } }],
    })
  }

  // 2. Keyword-triggered engines: "yt lofi" or a bare "yt" to open the site.
  const [head, ...rest] = q.split(/\s+/)
  const engine = cfg.searchEngines.find((e) => e.keyword.toLowerCase() === head.toLowerCase())
  if (engine) {
    const term = rest.join(' ')
    const url = term
      ? buildUrl(engine.url, term)
      : new URL(buildUrl(engine.url, 'x')).origin
    out.push({
      id: 'web:' + engine.keyword,
      title: term ? term : 'Open ' + engine.name,
      subtitle: 'Search ' + engine.name,
      glyph: engine.glyph ?? '🔎',
      // Beats app matches: the keyword prefix is an explicit instruction.
      score: 1.2,
      provider: 'web',
      action: { kind: 'openUrl', url },
      altActions: [{ label: 'Copy search URL', action: { kind: 'copy', text: url } }],
    })
  }

  // 3. Fallback on the default engine, scored low so it lands at the bottom.
  const fallback = cfg.searchEngines.find((e) => e.keyword === cfg.defaultEngine) ?? cfg.searchEngines[0]
  if (fallback && !engine && q.length >= 2) {
    out.push({
      id: 'web:fallback',
      title: 'Search ' + fallback.name + ' for "' + q + '"',
      subtitle: fallback.name,
      glyph: fallback.glyph ?? '🔎',
      score: 0.05,
      provider: 'web',
      action: { kind: 'openUrl', url: buildUrl(fallback.url, q) },
    })
  }

  return out
}
