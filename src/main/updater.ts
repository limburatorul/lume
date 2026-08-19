import { app, shell } from 'electron'
import electronUpdater from 'electron-updater'
import { EventEmitter } from 'node:events'
import type { UpdateStatus } from '../shared/types.js'
import pkg from '../../package.json' with { type: 'json' }
import { settings } from './settings.js'

const { autoUpdater } = electronUpdater

/** Wait before the first check so it never competes with the initial index. */
const FIRST_CHECK_DELAY = 25_000
const RECHECK_INTERVAL = 6 * 60 * 60 * 1000

/** "https://github.com/owner/repo.git" -> "owner/repo" */
const REPO = (pkg.repository?.url ?? '').replace(/^.*github\.com\//, '').replace(/\.git$/, '')
const RELEASES_PAGE = REPO ? `https://github.com/${REPO}/releases/latest` : ''

/** Compares "0.1.10" against "0.1.9" numerically rather than lexically. */
function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split(/[.-]/).map((p) => Number(p) || 0)
  const a = parse(candidate)
  const b = parse(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}

/**
 * Checking for a new version and installing it are separate capabilities.
 *
 * An installed build can do both: electron-updater reads the `latest.yml`
 * that electron-builder publishes next to each release, downloads the new
 * installer and verifies its SHA512 before handing over.
 *
 * The portable build has no installer to hand over to, and a development run
 * has no packaged app to replace — but both can still ask GitHub whether a
 * newer release exists and say so. That check is a plain API call, so it does
 * not depend on how the app was packaged.
 */
class Updater extends EventEmitter {
  private status: UpdateStatus = { state: 'idle' }
  private timer: NodeJS.Timeout | null = null
  private wired = false

  get current(): UpdateStatus {
    return this.status
  }

  /** Whether this build can replace itself, as opposed to only reporting. */
  private canInstall(): boolean {
    // electron-builder sets PORTABLE_EXECUTABLE_DIR for portable targets.
    return app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR
  }

  private manualReason(): string {
    if (!app.isPackaged) return 'running from source'
    return 'the portable build has no installer to update'
  }

  init() {
    if (this.canInstall()) {
      autoUpdater.autoDownload = true
      autoUpdater.autoInstallOnAppQuit = true
      // The app is not code-signed, so there is no publisher signature to
      // check. Integrity still rests on the SHA512 recorded in latest.yml,
      // which electron-updater verifies before staging the installer.
      autoUpdater.logger = null
      this.wire()
    }
    if (settings.get().checkForUpdates) this.schedule()
  }

  private wire() {
    if (this.wired) return
    this.wired = true

    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking' }))
    autoUpdater.on('update-available', (info) => this.set({ state: 'available', version: info.version }))
    autoUpdater.on('update-not-available', () => this.set({ state: 'current', checkedAt: Date.now() }))
    autoUpdater.on('download-progress', (p) =>
      this.set({ state: 'downloading', percent: Math.round(p.percent) }),
    )
    autoUpdater.on('update-downloaded', (info) => this.set({ state: 'ready', version: info.version }))
    autoUpdater.on('error', (err) => this.set({ state: 'error', message: err?.message ?? String(err) }))
  }

  private schedule() {
    if (this.timer) return
    setTimeout(() => void this.check(), FIRST_CHECK_DELAY)
    this.timer = setInterval(() => {
      if (settings.get().checkForUpdates) void this.check()
    }, RECHECK_INTERVAL)
  }

  /** Asks GitHub directly. Used where electron-updater cannot take over. */
  private async checkManually(): Promise<UpdateStatus> {
    if (!REPO) {
      return { state: 'error', message: 'No repository is configured in package.json.' }
    }
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Lume' },
      })
      if (!res.ok) return { state: 'error', message: `GitHub replied ${res.status}` }
      const body = (await res.json()) as { tag_name?: string; html_url?: string }
      const latest = (body.tag_name ?? '').replace(/^v/, '')
      if (!latest) return { state: 'error', message: 'The latest release has no version tag.' }
      if (!isNewer(latest, app.getVersion())) return { state: 'current', checkedAt: Date.now() }
      return {
        state: 'available',
        version: latest,
        // Presence of a URL is what tells the UI to offer a download link
        // rather than an install button.
        downloadUrl: body.html_url ?? RELEASES_PAGE,
        reason: this.manualReason(),
      }
    } catch (err) {
      return { state: 'error', message: err instanceof Error ? err.message : String(err) }
    }
  }

  /** Runs a check now, regardless of the automatic schedule. */
  async check(): Promise<UpdateStatus> {
    if (!this.canInstall()) {
      this.set({ state: 'checking' })
      this.set(await this.checkManually())
      return this.status
    }
    this.wire()
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      this.set({ state: 'error', message: err instanceof Error ? err.message : String(err) })
    }
    return this.status
  }

  /** Quits and runs the downloaded installer. Only valid in the 'ready' state. */
  install(): boolean {
    if (this.status.state !== 'ready') return false
    setImmediate(() => autoUpdater.quitAndInstall(false, true))
    return true
  }

  /** Opens the release page, for builds that must be updated by hand. */
  async openDownloadPage(): Promise<void> {
    const url =
      this.status.state === 'available' && this.status.downloadUrl
        ? this.status.downloadUrl
        : RELEASES_PAGE
    if (url) await shell.openExternal(url)
  }

  /** Called when the setting is toggled, so turning it on starts checking. */
  applySettings() {
    if (settings.get().checkForUpdates) this.schedule()
  }

  private set(status: UpdateStatus) {
    this.status = status
    this.emit('status', status)
  }
}

export const updater = new Updater()
