# Lume

A fast, CSS-themeable keyboard launcher for Windows. Electron + TypeScript, bundled
with esbuild, packaged with electron-builder. Published as `limburatorul/lume`.

The npm package is named `lume-launcher`; the product, the binary and the appId
(`dev.tucu.lume`) all say **Lume**. The repository directory is still called
`FlowLauncher` for historical reasons — that name should not appear in code or docs.

## Commands

```
npm run dev         # esbuild watch + static asset copy
npm start           # build, then launch Electron
npm run typecheck   # tsc --noEmit — the only type gate, run it before committing
npm test            # scripts/smoke.mjs — bundles smoke-entry.ts and runs it
npm run package     # electron-builder --win → release/ (nsis + portable)
npm run shot        # regenerate README screenshots - rarely; see below
```

There is no linter and no formatter config. Match the surrounding style by hand.

## Architecture

Three Electron contexts, and everything crossing between them is typed in
`src/shared/types.ts`. Add to that file first when introducing a new IPC payload.

- **main** (`src/main/`) — window, tray, hotkey, indexing, search, execution.
- **preload** (`src/preload/`) — two separate bridges, one per window, built to CJS.
- **renderer** (`src/renderer/` launcher, `src/settings/` settings window).

`src/main/index.ts` is the composition root: it owns the tray, the global hotkey,
every `ipcMain` handler, and the `wireEvents()` block that connects module events
to window updates. New IPC channels and cross-module wiring belong there, not
scattered into the modules themselves.

### Search pipeline

`search/engine.ts` runs every provider synchronously on each keystroke, merges,
sorts and de-duplicates. Providers live in `src/main/providers/` and are plain
functions `(query: string) => ResultItem[]`. To add one, write the function and
add it to the array in `engine.ts` — there is no registry.

Two queries bypass the merge entirely: an empty query returns `frequentApps()`,
and a query starting with `config.shellPrefix` goes only to the shell provider.

Ranking lives in `search/rank.ts`: a fuzzy match score (`search/fuzzy.ts`)
blended with learned usage from `store.ts` by `config.frecencyWeight`, plus two
rules that deliberately are not part of that blend — a bonus for anything ever
launched, and an outright override for whatever a query has been used to launch
(`isPinned`, applied in `engine.ts` so system commands get it too).

`store.ts` keeps per-item frecency with a 30-day half-life, query→item affinity
for the ramp while a prefix is being typed, and `topForQuery`, which is the
override. It takes its directory through `init(dir)` rather than importing
Electron, so `rank.ts` and the store can be exercised by `npm test`. Only the
*primary* action of an `apps` or `system` result is recorded; alternates are
treated as deliberate one-offs.

### Module shape

Stateful modules export a singleton instance of a class, not a bag of functions:
`export const usage = new UsageStore()`. Those with lifecycles expose `init()` and
are started in order inside `app.whenReady()`. Ones that others react to extend
`EventEmitter` (`themes`, `settings`, `appIndex`, `updater`) and are subscribed to
in `wireEvents()`.

## Conventions

- No semicolons, single quotes, 2-space indent.
- ESM everywhere in `src/main`, with **`.js` extensions on relative imports**.
  `moduleResolution` is `bundler`, so tsc would accept extensionless too — but every
  existing import carries the extension, so keep writing it that way.
- Comments explain *why*, in full sentences, and are rare. Do not add comments
  that restate the code; the existing ones all carry information the code cannot.
- Errors from Windows APIs and the filesystem are caught, logged with a
  `[module]` prefix, and degraded gracefully. The launcher never crashes on a
  bad theme file, an unreadable shortcut or a taken hotkey.
- User-visible failures that the user can act on get a `Notification`, not a
  silent fallback — see `registerHotkey()`.

## Things that will bite

- `scripts/build.mjs` injects a banner recreating `__dirname` and `require` for
  the main bundle, because esbuild's ESM output drops them. Anything resolving
  paths at runtime in main depends on it.
- Static assets (`*.html`, `*.css`, `themes/`, `assets/`, `uwp.ps1`) are copied by
  `copyStatic()` in the build script, not bundled. A new static file must be added
  there or it will be missing from `dist/` and from the package.
- `uwp.ps1` is listed under `asarUnpack` — it is spawned as a real file, so it
  cannot live inside the asar archive.
- The committed screenshots are settled. Do not regenerate them as part of other
  work - only on request, or when the UI has changed enough that they
  misrepresent the app. A run drives the real desktop: it minimises open windows
  and screen-grabs them, which is not a cost worth paying for a cosmetic refresh.
- README screenshots are real screen grabs, because the acrylic backdrop only
  exists in the composited desktop and `capturePage()` cannot see it.
  `scripts/shots.mjs` paints a full-screen backdrop, reads window bounds back over
  the debugging protocol and crops to them, which keeps the author's own desktop
  out of the images. It rewrites `config.json` while running and restores it after.
- Only one instance runs. `--settings` and `--hidden` are forwarded to the live
  instance through the `second-instance` handler.
