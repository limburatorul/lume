import type { Action, ResultItem } from '../../shared/types.js'
import { scoreCandidate } from '../search/fuzzy.js'

interface Command {
  id: string
  title: string
  subtitle: string
  glyph: string
  keywords: string[]
  action: Action
}

/** Launcher-management and a few OS commands, matched fuzzily like apps. */
const COMMANDS: Command[] = [
  {
    id: 'sys:settings',
    title: 'Lume: Settings',
    subtitle: 'Appearance, hotkey, startup, search engines',
    glyph: '⚙',
    keywords: ['settings', 'preferences', 'options', 'config', 'setari'],
    action: { kind: 'internal', name: 'openSettings' },
  },
  {
    id: 'sys:reindex',
    title: 'Lume: Rebuild app index',
    subtitle: 'Rescan Start Menu, Desktop and Store apps',
    glyph: '↻',
    keywords: ['reindex', 'refresh', 'rescan'],
    action: { kind: 'internal', name: 'reindex' },
  },
  {
    id: 'sys:themes',
    title: 'Lume: Open themes folder',
    subtitle: 'Edit a .css file - changes apply live',
    glyph: '🎨',
    keywords: ['theme', 'css', 'style', 'appearance'],
    action: { kind: 'internal', name: 'openThemes' },
  },
  {
    id: 'sys:config',
    title: 'Lume: Open config file',
    subtitle: 'config.json, for editing settings by hand',
    glyph: '📄',
    keywords: ['config', 'json'],
    action: { kind: 'internal', name: 'openConfig' },
  },
  {
    id: 'sys:devtools',
    title: 'Lume: Toggle developer tools',
    subtitle: 'Inspect the launcher UI while styling it',
    glyph: '🛠',
    keywords: ['devtools', 'inspect', 'debug'],
    action: { kind: 'internal', name: 'toggleDevTools' },
  },
  {
    id: 'sys:restart',
    title: 'Lume: Restart',
    subtitle: 'Reload the launcher',
    glyph: '⟳',
    keywords: ['restart', 'reload'],
    action: { kind: 'internal', name: 'restart' },
  },
  {
    id: 'sys:quit',
    title: 'Lume: Quit',
    subtitle: 'Exit the launcher',
    glyph: '⏻',
    keywords: ['quit', 'exit', 'close'],
    action: { kind: 'internal', name: 'quit' },
  },
  {
    id: 'sys:lock',
    title: 'Lock workstation',
    subtitle: 'Windows lock screen',
    glyph: '🔒',
    keywords: ['lock'],
    action: { kind: 'shellExec', command: 'rundll32.exe user32.dll,LockWorkStation', hidden: true },
  },
  {
    id: 'sys:sleep',
    title: 'Sleep',
    subtitle: 'Put the computer to sleep',
    glyph: '🌙',
    keywords: ['sleep', 'suspend'],
    action: { kind: 'shellExec', command: 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0', hidden: true },
  },
  {
    id: 'sys:shutdown',
    title: 'Shut down',
    subtitle: 'Power off the computer',
    glyph: '⏻',
    keywords: ['shutdown', 'poweroff', 'power off'],
    action: { kind: 'shellExec', command: 'shutdown /s /t 0', hidden: true },
  },
  {
    id: 'sys:reboot',
    title: 'Restart Windows',
    subtitle: 'Reboot the computer',
    glyph: '⟲',
    keywords: ['reboot', 'restart windows'],
    action: { kind: 'shellExec', command: 'shutdown /r /t 0', hidden: true },
  },
  {
    id: 'sys:recyclebin',
    title: 'Empty Recycle Bin',
    subtitle: 'Permanently delete recycled files',
    glyph: '🗑',
    keywords: ['recycle', 'bin', 'trash', 'empty'],
    action: { kind: 'shellExec', command: 'Clear-RecycleBin -Force', hidden: true },
  },
]

const MIN_SCORE = 0.35

export function systemProvider(query: string): ResultItem[] {
  const q = query.trim()
  if (q.length < 2) return []
  const out: ResultItem[] = []

  for (const cmd of COMMANDS) {
    const match = scoreCandidate(q, cmd.title, cmd.keywords)
    if (!match || match.normalized < MIN_SCORE) continue
    out.push({
      id: cmd.id,
      title: cmd.title,
      subtitle: cmd.subtitle,
      glyph: cmd.glyph,
      // Slightly below a strong app match so typing "res" still finds Resolve.
      score: match.normalized * 0.9,
      provider: 'system',
      matches: match.positions,
      action: cmd.action,
    })
  }
  return out
}
