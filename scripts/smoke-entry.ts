import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scoreCandidate } from '../src/main/search/fuzzy.js'
import { isPinned, rankScore, PINNED_SCORE } from '../src/main/search/rank.js'
import { usage } from '../src/main/store.js'
import { evaluate } from '../src/main/providers/calculator.js'

const APPS = [
  'PyCharm Community Edition 2024.1', 'Cheat Engine 7.5', 'Arduino IDE', 'AIDA64 Extreme',
  'GitHub Desktop', 'Notepad++', 'Windows Terminal', 'Steam', 'Paint', 'Microsoft Store',
  'Visual Studio Code', 'Embarcadero RAD Studio', 'Enpass', 'Steam Cleanup Utility',
  'Adobe Photoshop 2024', 'Blender', 'Discord', 'Spotify', 'OBS Studio', 'Task Manager',
  // Noise seen in the real index - these must stay below the display threshold.
  'smartd_mailer.conf.sample.ps1 (view)', 'States Builder Trade Empire',
  'VidiKeep Streaming Video Downloader', 'Command Line Parameters', 'Whats New',
]

const MIN_SCORE = 0.28

const QUERIES = ['cheat', 'ard', 'pych', 'aida', 'ghu', 'notep', 'termin', 'stea', 'paint', 'vsc', 'store', 'emb', 'enpa', 'obs', 'tsk']

let failures = 0
for (const q of QUERIES) {
  const ranked = APPS
    .map((name) => ({ name, s: scoreCandidate(q, name)?.normalized ?? -1 }))
    .filter((x) => x.s > MIN_SCORE)
    .sort((a, b) => b.s - a.s)
  const top = ranked.slice(0, 3).map((r) => r.name + ' (' + r.s.toFixed(2) + ')')
  console.log(q.padEnd(8), '->', top.join('  |  ') || '(no match)')
  if (!ranked.length) failures++
  // A junk entry may still be a legitimate substring match; what must never
  // happen is it outranking the app the query is obviously reaching for.
  const isNoise = (n: string) => /smartd|States Builder|Command Line|Whats New/.test(n)
  if (ranked[0] && isNoise(ranked[0].name)) {
    console.log('        NOISE AT RANK 1:', ranked[0].name)
    failures++
  }
}

console.log('\n--- calculator ---')
const CASES: Array<[string, number]> = [
  ['2+2', 4], ['10/4', 2.5], ['2^10', 1024], ['(3+4)*2', 14], ['sqrt(144)', 12],
  ['-5 + 3', -2], ['17 % 5', 2], ['2 * pi', Math.PI * 2], ['max(3, 9)', 9],
  ['1.5e3 + 1', 1501], ['0xff', 255], ['12k / 4', 3000], ['log(1000)', 3], ['10 // 3', 3],
  ['10%', 0.1], ['5 + 10%', 5.1], ['sqrt(144) * 2 + 10%', 24.1], ['17 % 5', 2], ['(2+3)% * 4', 0.2],
]
for (const [expr, expected] of CASES) {
  let got: number | string
  try { got = evaluate(expr) } catch (e) { got = 'ERROR: ' + (e as Error).message }
  const ok = typeof got === 'number' && Math.abs(got - expected) < 1e-9
  if (!ok) failures++
  console.log((ok ? 'ok  ' : 'FAIL') + '  ' + expr.padEnd(14) + ' = ' + got + (ok ? '' : '  (expected ' + expected + ')'))
}

/* ------------------------------------------------------------- learning */

console.log('\n--- what the ranker learns ---')
{
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lume-rank-'))
  usage.init(dir)
  const WEIGHT = 0.35

  /**
   * Mirrors how engine.ts orders results: score every candidate, let a pinned
   * one override, then sort. The rules themselves live in rank.ts, which is
   * the code under test — only the three lines of assembly are repeated here,
   * because the engine itself pulls in Electron and cannot be imported.
   */
  const rank = (query: string, apps: Array<{ id: string; name: string }>) =>
    apps
      .map((a) => {
        const m = scoreCandidate(query, a.name)
        const base = m ? rankScore(query, m.normalized, a.id, WEIGHT) : 0
        return { ...a, score: isPinned(query, a.id, WEIGHT) ? PINNED_SCORE : base }
      })
      .filter((a) => a.score > MIN_SCORE)
      .sort((x, y) => y.score - x.score)

  const expectFirst = (label: string, query: string, apps: Array<{ id: string; name: string }>, id: string) => {
    const order = rank(query, apps)
    const ok = order[0]?.id === id
    if (!ok) failures++
    console.log(
      (ok ? 'ok  ' : 'FAIL') +
        '  ' +
        label.padEnd(52) +
        order.map((a) => a.name + ' ' + a.score.toFixed(2)).join(' | '),
    )
  }

  // 1. A result that starts out third becomes first after a single launch.
  const NOTE = [
    { id: 'app:notes', name: 'Notes' },
    { id: 'app:notepad', name: 'Notepad' },
    { id: 'app:notepadpp', name: 'Notepad++' },
  ]
  expectFirst('before: best fuzzy match leads', 'note', NOTE, 'app:notes')
  usage.record('app:notepadpp', 'note')
  expectFirst('after one launch: your pick leads', 'note', NOTE, 'app:notepadpp')

  // 2. Changing your mind still works, rather than sticking forever.
  usage.record('app:notepad', 'note')
  usage.record('app:notepad', 'note')
  expectFirst('a new habit overtakes the old one', 'note', NOTE, 'app:notepad')

  // 3. A daily driver holds its place when a similarly named app is installed.
  const CHEAT = [
    { id: 'app:cheat-engine', name: 'Cheat Engine 7.5' },
    { id: 'app:cheat', name: 'Cheat' },
  ]
  for (let i = 0; i < 8; i++) usage.record('app:cheat-engine', 'cheat engine')
  expectFirst('a new install does not displace a habit', 'cheat', CHEAT, 'app:cheat-engine')

  // 4. Launched beats never-launched when the match quality is comparable.
  const EDIT = [
    { id: 'app:editor-x', name: 'Editor X' },
    { id: 'app:editpad', name: 'EditPad' },
  ]
  usage.record('app:editpad', 'editpad')
  expectFirst('launched beats never-launched on a near tie', 'edit', EDIT, 'app:editpad')

  // 5. ...but that edge is bounded, so typing the exact name of a fresh
  //    install still finds it. Asserted on the scores directly: a contrived
  //    pair of app names proves nothing if one of them falls below the
  //    display threshold and never competes in the first place.
  usage.record('app:launched-once', 'whatever')
  const fresh = (m: number) => rankScore('q', m, 'app:never-launched', WEIGHT)
  const known = (m: number) => rankScore('q', m, 'app:launched-once', WEIGHT)

  const boundary: Array<[string, boolean]> = [
    ['a weak launched match loses to a strong new one', known(0.4) < fresh(0.95)],
    ['a close launched match still wins', known(0.7) > fresh(0.95)],
    ['equal matches favour the launched one', known(0.8) > fresh(0.8)],
  ]
  for (const [label, ok] of boundary) {
    if (!ok) failures++
    console.log((ok ? 'ok  ' : 'FAIL') + '  ' + label)
  }
  console.log(
    '      crossover: a launched app wins while its match is within ~' +
      ((known(0.8) - fresh(0.8)) / 0.65).toFixed(2) +
      ' of the newcomer’s',
  )

  rmSync(dir, { recursive: true, force: true })
}

console.log('\nfailures:', failures)
process.exit(failures ? 1 : 0)
