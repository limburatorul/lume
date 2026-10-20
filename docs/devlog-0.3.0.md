# Lume 0.3.0 — Stash backups in the results, a stricter sister reader, hotkey on the card

Date: 2026-10-20. Ecosystem integration plan items 4 and 8.

## What

- **Stash in the results.** `data\stash.items.json` (written by Stash 2.2: the last
  backups, `kind: "backup"`, `run: { exe, args: ["--browse", file] }`) is read like every
  other `*.items.json`. Backups get a new `archive` glyph (a box with a lid) instead of the
  generic app square. Stash is now in About → Works with: "puts your Thunderbird backups in
  the results", last in the list, so the three suggestions shown to someone with nothing
  installed are unchanged.
- **The sister reader no longer trusts run.exe and run.args.** For every app, not only
  Stash, an item is skipped unless run.exe is a drive path (`X:\…`), ends in `.exe`, has no
  control characters and is an existing file; and unless it has at most 8 string arguments,
  each at most 1,024 characters with no control characters. Non-string arguments are still
  dropped as before. run.exe is deliberately not required to equal the card's exe: Reel runs
  its player/explorer and Planner the copy inside each plan folder. One stat per distinct exe
  per 30 s read.
- **PowerShell quoting fix.** `psQuote` (every launch goes through `Start-Process`) doubled
  only `'`. PowerShell also closes a single-quoted string at `‘ ’ ‚ ‛`; an argument
  containing `’; Write-Output INJECTED; ’` ran the middle command. All four are now doubled.
- **The card declares the hotkey.** `apps\lume.json` gains
  `hotkeys: [{ combo, does: "Show or hide Lume", registered }]`, combo in HotkeyScan's
  notation via the existing `toHotkeyScanCombo` (`CommandOrControl` → `Ctrl`, `Super` → `Win`;
  HotkeyScan's parser takes modifiers in any order and knows the key names Lume's hotkey
  field normally produces; a shifted symbol such as `!` would not parse there). The card is no longer written at the top of start-up but after each hotkey
  registration, and only when the combo or its registered state changed (every settings save
  goes through `registerHotkey`). Writes are chained, so two back-to-back writes cannot share
  the `.tmp` file.

## Why

Plan item 4: Lume searches everything the sister apps share; Stash's backups were the gap.
Its items run a command line written by another program, so the reader had to stop running
whatever it was handed. Plan item 8: HotkeyScan can only name Lume as the owner of Alt+Space
if Lume says so.

## How it was tested

`npm run typecheck` clean, `npm run build` clean, `npm test`: 51 checks, 0 failures
(the sister section went from 20 to 24 checks).

New checks, all in a temp `APPDATA`:
- A `stash.items.json` in the exact Stash 2.2 shape, with a UTF-8 BOM: the backup appears as
  "Stash · backup", glyph `archive`, `--browse <zip>`.
- Ten hostile Stash items: relative exe, UNC exe, an existing `.bat`, a missing exe, exe
  with a newline, exe not a string, 9 args, a 1,025-char arg, an arg with `\n`, an arg with
  NUL — all skipped; two at the limits, 8 args and a 1,024-char arg — kept. Exactly 3 of 13 survive.
- Mutation check: with the new exe/args checks disabled, that test fails (1 failure); restored, 0.
- Works with lists `Shelf,HotkeyScan,Reel,Stash,File Labs,Planner` with Stash's text.
- `writeCard` twice back to back (Alt+Space unregistered, then CommandOrControl+Shift+K
  registered): the file holds the second, `[{"combo":"Ctrl+Shift+K","does":"Show or hide Lume","registered":true}]`.
- The schema-2 test moved from a `stash` file to a `spacescan` one, which is not in Works with.

PowerShell quoting, measured in `powershell.exe -Command`: `'a’; Write-Output INJECTED; ’b'`
prints `a`, `INJECTED`, `b`; with the quote doubled it prints the literal string once.

## Not tested

- A packaged build was not run. `publishCard` only writes from a packaged build, and a
  packaged copy runs `applyStartupSetting`, whose `setLoginItemSettings` uses the same
  registry value (AppUserModelId `dev.tucu.lume`) as the installed Lume, so a test copy would
  rewrite the user's real "start with Windows" entry even with APPDATA redirected. The card
  content and write ordering are covered by the unit test above; the dedupe in `publishCard`
  is four lines and was read, not run.
- Against a real Stash 2.2 file: Stash is being built in parallel; tested on a synthetic
  file in the contract's shape.
