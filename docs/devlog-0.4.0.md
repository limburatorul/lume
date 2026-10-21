# Lume 0.4.0 — a more readable look, your own accent colour, icons for system tools

Date: 2026-10-21. Requested after daily use: the launcher was hard to read over a busy
desktop, the accent could only be the theme's or Windows', Index & data did not show what
the sister apps share, and Control Panel had no icon.

## What

- **Default theme redone for legibility.** Subtitles 0.38 → 0.66 alpha, hints 0.40 → 0.82,
  placeholder 0.28 → 0.45, title 14.5 px/450 → 15 px/500, subtitle 11.5 → 12 px, icons
  30 → 32 px, rows 52 → 54 px, query 19 → 20 px. A 1 px 45 % black text shadow lifts text off
  bright wallpaper showing through the acrylic. The selected row is a solid mix of 30 % accent
  into the surface with a 55 % accent outline, instead of a 9–34 % gradient. Matched letters
  are the accent mixed 35 % into white. Everything coloured derives from `--accent`
  (`color-mix`), and carbon and light now take the accent instead of hard-coded blues.
- **Accent colour picker.** Appearance → Accent colour: Theme, Windows (the old toggle, still
  `ui.useWindowsAccent`), eight presets, or Custom… (native colour picker). Stored as
  `ui.accentColor` (`#rrggbb` or null). The renderer only injects a value matching
  `^#[0-9a-f]{6}$`, since config.json is hand-editable and the value lands in a stylesheet.
- **Index & data counts the sister apps.** A second row: games from Shelf and films from Reel,
  counted from the same validated reader that puts them in the results
  (`sisterCounts()` in providers/sisters.ts), so a skipped item is not counted.
- **Icons Explorer draws, for everything.** `app.getFileIcon` (Chromium) picks an icon by
  extension, so a shortcut with no file target (Control Panel, Run), an icon inside a DLL or
  in the `.mun` files Windows 11 moved system icons to (Task Manager, Remote Desktop, Event
  Viewer and the other Administrative Tools, rundll32 launchers such as LAV), came out as a
  blank page or a generic program window. New `shellicons.ps1` asks the shell
  (`IShellItemImageFactory::GetImage`, icon only, 96 px, premultiplied alpha undone) for
  every path the native readers (PNG frames in an exe, image files) cannot do. Requests are
  batched: one PowerShell run per 30 ms burst, one at a time, list passed in a temp file
  named per run. `app.getFileIcon` remains the last resort when nothing drew it.
  The indexer puts the shortcut itself first when its icon location is a file other than its
  target, adds the icon location's exe as a fallback (File Explorer's shortcut points at a
  folder object the shell cannot draw), and gives Store apps without a logo
  `shell:AppsFolder\<AppID>` (Xbox games). Network paths are dropped before any access.
  The cache moved to `icon-cache\`; the old `icons\` held the generic glyphs and is deleted.
- **Sister results carry their app's icon.** Reel's films run through explorer.exe and showed
  a folder; the icon now comes from the sharing app's card exe.

## How it was tested

Isolated copy: an Electron wrapper set appData/userData into a scratch folder (checked
before loading), APPDATA pointed there too, with a read-only junction to the Start Menu and
copies of Shelf's and Reel's items and cards. Login item, openExternal and openPath were
stubbed; windows were shown inactive at x = −4000, so nothing came on screen or took focus.

- Typecheck clean, `npm test` 0 failures.
- All 564 icon keys of the 577-entry index resolved in 4.7 s (one cold run).
- Grouping identical PNGs: the blank page went from 18+8+4 entries (system tools, Google Play
  Games, File Explorer, …) to 40, all of which the shell itself draws blank (PDFs whose
  handler, Edge, registers no icon; Play Games shortcuts whose `.ico` is missing; Zoom
  Player web links). The generic program window is now only on exes that have no icon.
- A race found on the way: the list file was removed asynchronously after the next batch
  had written it; fixed with a per-run name and re-run clean.
- Index & data: 741 games from Shelf, 1491 films from Reel — the item counts of the files.
- Accent: a preset and Custom… written to config, applied live in the launcher.

## Not tested

- The installed build: running it would rewrite the real login item.
- The colour picker with a real mouse (it would take focus); its write path is the same as
  the presets'.
