import type { ResultItem } from '../../shared/types.js'
import { settings } from '../settings.js'

/**
 * Anything after the shell prefix (default `>`) is handed to PowerShell or cmd.
 * Enter keeps the console open so you can read the output; the alternatives
 * cover fire-and-forget and elevated runs.
 */
export function shellProvider(query: string): ResultItem[] {
  const cfg = settings.get()
  const prefix = cfg.shellPrefix
  if (!prefix || !query.startsWith(prefix)) return []

  const command = query.slice(prefix.length).trim()
  if (!command) {
    return [
      {
        id: 'shell:hint',
        title: 'Run a command',
        subtitle: 'Type a ' + cfg.shell + ' command after ' + prefix,
        glyph: '>_',
        score: 1.2,
        provider: 'shell',
        action: { kind: 'internal', name: 'noop' },
      },
    ]
  }

  return [
    {
      id: 'shell:run',
      title: command,
      subtitle: 'Run in ' + cfg.shell + ' (console stays open)',
      glyph: '>_',
      score: 1.3,
      provider: 'shell',
      action: { kind: 'shellExec', command },
      altActions: [
        { label: 'Run hidden (no window)', action: { kind: 'shellExec', command, hidden: true } },
        { label: 'Run as administrator', action: { kind: 'shellExec', command, admin: true }, hint: 'Ctrl+Enter' },
        { label: 'Copy command', action: { kind: 'copy', text: command } },
      ],
    },
  ]
}
