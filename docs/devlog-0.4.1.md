# Lume 0.4.1 — What's new, and the action menu under a long list

Date: 2026-10-22.

## What

- **What's new, in the studio's format.** A window of its own (`src/whatsnew/`), 1240 × 720 like the
  other apps': releases on the left under the month they came out (patches grouped under their x.y,
  as in Shelf), the chosen one on the right under a 960 × 170 banner. The notes are
  `src/whatsnew/changelog.ts`, bundled into the page, so it works offline and needs no preload: the
  running version arrives in the URL (`?v=`) to open on its release. 0.4 shows a picture made from the
  studio's banner template (`Marketing\banners\lume-0.4.js`, October: the launcher, search bars, result
  rows, the action menu, app icons and accent swatches over made-up desktops, no text), shipped as
  `assets/whats-new/0.4.webp`; 0.1–0.3 get a drawn banner in Lume's violet with a search bar and rows.
  It borrows the settings window's stylesheet, title strip and window-control colours.
- **Where it opens.** Tray menu → What's new (under Settings…), Settings → About → What's new, and once
  after an update: the version seen is kept in `last-seen-version` beside `config.json`. A profile
  without that file but with a `config.json` from before this start is an update from 0.4.0 or older;
  a fresh install shows nothing.
- **The action menu under a long list** (fix by the coordinator, included here): when the results were
  taller than the window's 900 px cap, the menu was added below the list, outside the window, and never
  showed. The panel now stops at 900 px, the list scrolls, and the selected row is scrolled into view
  when the menu opens.

## How it was tested

- `npm run typecheck` clean; `npm test` 0 failures, three new checks on the notes (newest first, real
  dates, the package version has its entry).
- Isolated copy: Electron with its own APPDATA and userData in the scratchpad, login item, openExternal
  and openPath stubbed, a hotkey nobody holds, over the debugging port.
  - With `last-seen-version` 0.4.0 and a config, What's new opened by itself on 0.4 (`?v=0.4.1`), the
    picture 1920 × 340 shown at 960 px, v0.4.1 and v0.4.0 listed; the file then read 0.4.1.
  - 0.1 showed the drawn banner and its 11 updates.
  - Closed, then Settings → About → What's new opened it again.
  - An empty profile (a fresh install) opened only the launcher.
- `npm run package -- --publish never` → `release\Lume-0.4.1-x64.exe` and `Lume-0.4.1-portable.exe`;
  the asar holds `dist\whatsnew\` and `dist\assets\whats-new\0.4.webp`.

## Not tested

- The tray item by a real click (it calls the same `openWhatsNew()`), and a real update from 0.4.0
  through the installer. The installed build was not run: it would rewrite the real login item.
