import { app, clipboard, shell } from 'electron'
import { spawn } from 'node:child_process'
import path from 'node:path'
import type { Action } from '../shared/types.js'
import { appIndex } from './indexer/apps.js'
import { settings } from './settings.js'
import { themes } from './themes.js'

export interface ExecuteContext {
  hideWindow: () => void
  toggleDevTools: () => void
  openSettings: () => void
}

/** Escapes a string for embedding in a single-quoted PowerShell literal. */
function psQuote(value: string) {
  return "'" + value.replace(/'/g, "''") + "'"
}

/**
 * Spawns a helper and forgets about it.
 *
 * `elevates` is the one case that must not be detached: ShellExecute's "runas"
 * does nothing at all - no prompt, no error, exit code 0 - when the process
 * asking for it was created with DETACHED_PROCESS. The wrapper exits straight
 * away regardless, and the elevated process is created by the system rather
 * than as its child, so nothing stays tied to Lume.
 */
function run(command: string, args: string[], opts: { hidden?: boolean; elevates?: boolean } = {}) {
  const child = spawn(command, args, {
    detached: !opts.elevates,
    stdio: 'ignore',
    windowsHide: opts.hidden ?? true,
  })
  child.unref()
  child.on('error', (err) => console.error('[exec] spawn failed:', err))
}

/** Launches through PowerShell's Start-Process, which handles UAC and args. */
function startProcess(target: string, args: string[] | undefined, cwd: string | undefined, admin: boolean) {
  const parts = ['Start-Process', '-FilePath', psQuote(target)]
  if (args?.length) parts.push('-ArgumentList', args.map(psQuote).join(','))
  if (cwd) parts.push('-WorkingDirectory', psQuote(cwd))
  if (admin) parts.push('-Verb', 'RunAs')
  run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', parts.join(' ')], { hidden: true, elevates: admin })
}

export async function execute(action: Action, ctx: ExecuteContext): Promise<void> {
  const cfg = settings.get()

  switch (action.kind) {
    case 'launch': {
      startProcess(action.target, action.args, action.cwd, action.admin ?? false)
      ctx.hideWindow()
      return
    }

    case 'openPath': {
      if (action.path.toLowerCase().endsWith('.lnk')) {
        // Let the shell resolve the shortcut so its own args and working
        // directory are honoured, exactly as a double-click in Explorer would.
        run('cmd.exe', ['/c', 'start', '', action.path], { hidden: true })
      } else {
        const err = await shell.openPath(action.path)
        if (err) console.error('[exec] openPath failed:', err)
      }
      ctx.hideWindow()
      return
    }

    case 'launchUwp': {
      run('explorer.exe', ['shell:AppsFolder\\' + action.appId], { hidden: true })
      ctx.hideWindow()
      return
    }

    case 'revealPath': {
      shell.showItemInFolder(path.normalize(action.path))
      ctx.hideWindow()
      return
    }

    case 'openUrl': {
      await shell.openExternal(action.url)
      ctx.hideWindow()
      return
    }

    case 'copy': {
      clipboard.writeText(action.text)
      ctx.hideWindow()
      return
    }

    case 'shellExec': {
      const isPwsh = cfg.shell === 'powershell'
      if (action.admin) {
        const inner = isPwsh
          ? ['-NoExit', '-Command', action.command]
          : ['/k', action.command]
        const exe = isPwsh ? 'powershell.exe' : 'cmd.exe'
        const argList = inner.map(psQuote).join(',')
        run(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            'Start-Process -FilePath ' + psQuote(exe) + ' -ArgumentList ' + argList + ' -Verb RunAs',
          ],
          { hidden: true, elevates: true },
        )
      } else if (action.hidden) {
        if (isPwsh) {
          run('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', action.command], {
            hidden: true,
          })
        } else {
          run('cmd.exe', ['/c', action.command], { hidden: true })
        }
      } else {
        // Visible console that stays open so output is readable.
        if (isPwsh) {
          run('cmd.exe', ['/c', 'start', '', 'powershell.exe', '-NoExit', '-Command', action.command], {
            hidden: true,
          })
        } else {
          run('cmd.exe', ['/c', 'start', '', 'cmd.exe', '/k', action.command], { hidden: true })
        }
      }
      ctx.hideWindow()
      return
    }

    case 'internal': {
      switch (action.name) {
        case 'noop':
          return
        case 'reindex':
          ctx.hideWindow()
          await appIndex.rebuild()
          return
        case 'openConfig':
          ctx.hideWindow()
          await shell.openPath(settings.filePath)
          return
        case 'openThemes':
          ctx.hideWindow()
          await shell.openPath(themes.dir)
          return
        case 'openSettings':
          ctx.hideWindow()
          ctx.openSettings()
          return
        case 'toggleDevTools':
          ctx.toggleDevTools()
          return
        case 'restart':
          app.relaunch()
          app.exit(0)
          return
        case 'quit':
          app.quit()
          return
      }
      return
    }
  }
}
