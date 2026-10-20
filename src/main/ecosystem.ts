import fs from 'node:fs'
import path from 'node:path'
import type { WorksWith } from '../shared/types.js'

/*
 * The Protagonist Labs apps find each other through one folder: every app
 * writes a card describing itself into apps\, and what it shares into data\.
 * Nothing here may ever throw at the caller - a sister that is missing, half
 * written or from a newer schema simply does not exist as far as Lume knows.
 */

export interface Card {
  id: string
  name: string
  exe: string
  edition?: string
  paid?: boolean
  page?: string
  commands?: Record<string, string[]>
}

export function sharedRoot(): string {
  return path.join(process.env.APPDATA ?? '', 'ProtagonistLabs')
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''))
    return value && typeof value === 'object' && value.schema === 1 ? value : null
  } catch {
    return null
  }
}

/** A sister's card, or null when it is absent, unreadable, or its exe is gone (uninstalled). */
export function readCard(id: string): Card | null {
  const card = readJson(path.join(sharedRoot(), 'apps', id + '.json'))
  if (!card || typeof card.exe !== 'string' || typeof card.name !== 'string') return null
  if (!fs.existsSync(card.exe)) return null
  return card as unknown as Card
}

/** Every installed sister's card, keyed by id. */
function allCards(): Map<string, Card> {
  const cards = new Map<string, Card>()
  let files: string[] = []
  try {
    files = fs.readdirSync(path.join(sharedRoot(), 'apps'))
  } catch {
    return cards
  }
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    const card = readCard(f.slice(0, -5))
    if (card) cards.set(card.id, card)
  }
  return cards
}

let cardWrite: Promise<void> = Promise.resolve()

export interface DeclaredHotkey {
  combo: string
  does: string
  registered: boolean
}

/**
 * Written atomically and off the start path; a failure only costs the sisters a stale card.
 * hotkeys lets HotkeyScan name Lume as the holder of a combination and see whether it got it.
 */
export function writeCard(version: string, exe: string, hotkeys: DeclaredHotkey[]): Promise<void> {
  const dir = path.join(sharedRoot(), 'apps')
  const file = path.join(dir, 'lume.json')
  const card = {
    schema: 1,
    updated: new Date().toISOString(),
    id: 'lume',
    name: 'Lume',
    version,
    exe,
    edition: 'free',
    paid: false,
    page: 'https://protagonistlabs.app/lume/',
    commands: { settings: ['--settings'] },
    hotkeys,
  }
  // Chained: a hotkey change right after start would otherwise share the .tmp file with the first write.
  cardWrite = cardWrite
    .then(() => fs.promises.mkdir(dir, { recursive: true }))
    .then(() => fs.promises.writeFile(file + '.tmp', JSON.stringify(card, null, 2)))
    .then(() => fs.promises.rename(file + '.tmp', file))
    .catch((err) => console.error('[ecosystem] could not write the card:', err))
  return cardWrite
}

/**
 * Electron accelerators and HotkeyScan agree on almost every name; only the
 * cross-platform modifier spellings need translating.
 */
export function toHotkeyScanCombo(accelerator: string): string {
  return accelerator
    .split('+')
    .map((part) => {
      const p = part.trim().toLowerCase()
      if (p === 'commandorcontrol' || p === 'cmdorctrl') return 'Ctrl'
      if (p === 'super' || p === 'meta' || p === 'command' || p === 'cmd') return 'Win'
      if (p === 'option' || p === 'altgr') return 'Alt'
      return part.trim()
    })
    .join('+')
}

/** HotkeyScan's `--check` when it is installed, otherwise its page. */
export function seeWhoHolds(accelerator: string): { exe: string; args: string[] } | { url: string } {
  const card = readCard('hotkeyscan')
  const template = card?.commands?.check
  if (card && Array.isArray(template)) {
    const combo = toHotkeyScanCombo(accelerator)
    return { exe: card.exe, args: template.map((a) => String(a).replace('{combo}', combo)) }
  }
  return { url: 'https://protagonistlabs.app/hotkeyscan/?utm_source=lume&utm_medium=app&utm_campaign=hotkey-taken' }
}

/** Most useful first: only the first three missing ones are suggested. */
const SISTERS: Array<{ id: string; name: string; adds: string; would: string }> = [
  { id: 'shelf', name: 'Shelf', adds: 'puts your games in the results', would: 'would put your games in the results' },
  { id: 'filelabs', name: 'File Labs', adds: 'puts your folders in the results', would: 'would put your folders in the results' },
  { id: 'hotkeyscan', name: 'HotkeyScan', adds: 'shows which app holds a taken hotkey', would: 'would show which app holds a taken hotkey' },
  { id: 'reel', name: 'Reel', adds: 'puts your films in the results', would: 'would put your films in the results' },
  { id: 'planner', name: 'Planner', adds: 'puts your tasks in the results', would: 'would put your tasks in the results' },
  { id: 'stash', name: 'Stash', adds: 'puts your Thunderbird backups in the results', would: 'would put your Thunderbird backups in the results' },
]

const PAID: Array<{ id: string; name: string }> = [
  { id: 'shelf', name: 'Shelf' },
  { id: 'stash', name: 'Stash' },
  { id: 'frostpane', name: 'Frostpane' },
  { id: 'reel', name: 'Reel' },
  { id: 'planner', name: 'Planner' },
  { id: 'reminder', name: 'Reminder' },
]

const UTM = 'utm_source=lume&utm_medium=app&utm_campaign=works-with'

/** The "Works with" section of the About page: only what is true on this PC. */
export function worksWith(): WorksWith {
  const cards = allCards()
  const installed = SISTERS.filter((s) => cards.has(s.id)).map((s) => ({ name: s.name, text: s.adds }))
  const missing = SISTERS.filter((s) => !cards.has(s.id))
    .slice(0, 3)
    .map((s) => ({ name: s.name, text: s.would, url: `https://protagonistlabs.app/${s.id}/?${UTM}` }))

  // Someone who bought one of the paid apps gets 30% off the ones they lack: one quiet line, never per app.
  const bought = [...cards.values()].some((c) => c.paid === true && c.edition === 'full')
  const offer = bought
    ? PAID.filter((p) => !cards.has(p.id))
        .slice(0, 4)
        .map((p) => ({
          name: p.name,
          url: `https://protagonistlabs.app/${p.id}/?code=${p.id === 'shelf' ? 'SECOND30SHELF' : 'SECOND30'}&${UTM}`,
        }))
    : []
  return { lines: [...installed, ...missing], offer }
}
