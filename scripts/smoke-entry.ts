import { scoreCandidate } from '../src/main/search/fuzzy.js'
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

console.log('\nfailures:', failures)
process.exit(failures ? 1 : 0)
