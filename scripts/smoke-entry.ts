import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scoreCandidate } from '../src/main/search/fuzzy.js'
import { isPinned, rankScore, PINNED_SCORE } from '../src/main/search/rank.js'
import { usage } from '../src/main/store.js'
import { evaluate } from '../src/main/providers/calculator.js'
import { sistersProvider } from '../src/main/providers/sisters.js'
import { seeWhoHolds, toHotkeyScanCombo, worksWith } from '../src/main/ecosystem.js'

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

/* ------------------------------------------------------- sister apps */

console.log('\n--- sister apps ---')
{
  const root = mkdtempSync(path.join(os.tmpdir(), 'lume-sisters-'))
  const shared = path.join(root, 'ProtagonistLabs')
  mkdirSync(path.join(shared, 'apps'), { recursive: true })
  mkdirSync(path.join(shared, 'data'), { recursive: true })
  const put = (rel: string, value: unknown) =>
    writeFileSync(path.join(shared, rel), typeof value === 'string' ? value : JSON.stringify(value))
  const card = (id: string, name: string, exe: string, extra = {}) =>
    put('apps/' + id + '.json', { schema: 1, updated: '2026-10-15T00:00:00Z', id, name, exe, ...extra })

  // Any file that exists stands in for an installed app's exe.
  const exe = process.execPath
  card('shelf', 'Shelf', exe, { paid: true, edition: 'full' })
  put('data/shelf.items.json', {
    schema: 1,
    items: [
      { title: 'The Witcher 3', subtitle: 'Steam', kind: 'game', run: { exe, args: ['--launch', 'w3'] } },
      { title: 'Witcher with no run', kind: 'game' },
      { title: 'Witcher bad args', kind: 'game', run: { exe, args: ['--launch', 7] } },
    ],
  })
  card('reel', 'Reel', exe)
  put('data/reel.items.json', '{ not json')
  put('data/planner.items.json', { schema: 1, items: [{ title: 'Witcher plan', kind: 'task', run: { exe } }] })
  card('filelabs', 'File Labs', path.join(root, 'gone.exe'))
  put('data/filelabs.items.json', { schema: 1, items: [{ title: 'Witcher folder', kind: 'folder', run: { exe } }] })
  card('stash', 'Stash', exe)
  put('data/stash.items.json', { schema: 2, items: [{ title: 'Witcher future', kind: 'x', run: { exe } }] })
  card('hotkeyscan', 'HotkeyScan', exe, { commands: { check: ['--check', '{combo}'] } })

  process.env.APPDATA = root
  const got = sistersProvider('witcher')
  const w3 = got.find((r) => r.title === 'The Witcher 3')
  const bad = got.find((r) => r.title === 'Witcher bad args')
  const checks: Array<[string, boolean]> = [
    ['reads a sister\'s items', w3?.subtitle === 'Shelf · game' && w3.detail === 'Steam'],
    ['runs run.exe with run.args', w3?.action.kind === 'launch' && w3.action.target === exe && w3.action.args?.join(' ') === '--launch w3'],
    ['drops non-string args', bad?.action.kind === 'launch' && bad.action.args?.join(' ') === '--launch'],
    ['skips an item without run', !got.some((r) => r.title === 'Witcher with no run')],
    ['skips items of an app without a card', !got.some((r) => r.title === 'Witcher plan')],
    ['skips items of an uninstalled app', !got.some((r) => r.title === 'Witcher folder')],
    ['skips a wrong schema', !got.some((r) => r.title === 'Witcher future')],
    ['survives garbage json', got.length === 2],
    ['electron accelerator to HotkeyScan', toHotkeyScanCombo('CommandOrControl+Super+Space') === 'Ctrl+Win+Space'],
  ]
  const holds = seeWhoHolds('Alt+Space')
  checks.push(['see who holds it runs HotkeyScan --check', 'exe' in holds && holds.args.join(' ') === '--check Alt+Space'])
  const { lines, offer } = worksWith()
  const names = lines.map((l) => l.name).join(',')
  checks.push(['works with: installed first, without a link', lines[0]?.name === 'Shelf' && !lines[0].url])
  checks.push(['works with: installed, then missing', names === 'Shelf,HotkeyScan,Reel,File Labs,Planner'])
  checks.push(['works with: a missing sister links its page, no code', lines.some((l) => l.name === 'File Labs' && l.url === 'https://protagonistlabs.app/filelabs/?utm_source=lume&utm_medium=app&utm_campaign=works-with')])
  checks.push(['works with: no 30% off on a sister line', !lines.some((l) => /30%|code=/.test(l.text + (l.url ?? '')))])
  checks.push(['works with: one offer line, missing paid apps, max 4', offer.map((o) => o.name).join(',') === 'Frostpane,Planner,Reminder'])
  checks.push(['works with: offer links carry the code', offer.every((o) => o.url.includes('?code=SECOND30&utm_source=lume'))])

  process.env.APPDATA = path.join(root, 'nowhere')
  checks.push(['no shared folder: no results', sistersProvider('witcher').length === 0])
  checks.push(['no HotkeyScan: its page', 'url' in seeWhoHolds('Alt+Space')])
  checks.push(['works with: at most three missing, most useful first', worksWith().lines.map((l) => l.name).join(',') === 'Shelf,File Labs,HotkeyScan'])
  checks.push(['works with: nothing bought, no offer', worksWith().offer.length === 0])

  for (const [label, ok] of checks) {
    if (!ok) failures++
    console.log((ok ? 'ok  ' : 'FAIL') + '  ' + label)
  }
  rmSync(root, { recursive: true, force: true })
}

console.log('\nfailures:', failures)
process.exit(failures ? 1 : 0)
