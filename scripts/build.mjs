import esbuild from 'esbuild'
import { cp, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const watch = process.argv.includes('--watch')

const shared = {
  bundle: true,
  sourcemap: true,
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
}

const configs = [
  {
    ...shared,
    entryPoints: ['src/main/index.ts'],
    outfile: 'dist/main/index.js',
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['electron'],
    banner: {
      // esbuild ESM output loses __dirname; recreate it.
      js: "import { createRequire as __cr } from 'node:module';import { fileURLToPath as __f } from 'node:url';import { dirname as __d } from 'node:path';const require=__cr(import.meta.url);const __filename=__f(import.meta.url);const __dirname=__d(__filename);",
    },
  },
  {
    ...shared,
    entryPoints: ['src/preload/index.ts'],
    outfile: 'dist/preload/index.cjs',
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['electron'],
  },
  {
    ...shared,
    entryPoints: ['src/preload/settings.ts'],
    outfile: 'dist/preload/settings.cjs',
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['electron'],
  },
  {
    ...shared,
    entryPoints: ['src/renderer/main.ts'],
    outfile: 'dist/renderer/main.js',
    platform: 'browser',
    target: 'chrome128',
    format: 'iife',
  },
  {
    ...shared,
    entryPoints: ['src/settings/settings.ts'],
    outfile: 'dist/settings/settings.js',
    platform: 'browser',
    target: 'chrome128',
    format: 'iife',
  },
]

async function copyStatic() {
  await mkdir('dist/renderer', { recursive: true })
  await mkdir('dist/settings', { recursive: true })
  await mkdir('dist/main', { recursive: true })
  await cp('src/renderer/index.html', 'dist/renderer/index.html')
  await cp('src/renderer/base.css', 'dist/renderer/base.css')
  await cp('src/settings/index.html', 'dist/settings/index.html')
  await cp('src/settings/settings.css', 'dist/settings/settings.css')
  await cp('src/main/indexer/uwp.ps1', 'dist/main/uwp.ps1')
  await cp('themes', 'dist/themes', { recursive: true })
  await cp('assets', 'dist/assets', { recursive: true })
}

if (!watch && existsSync('dist')) await rm('dist', { recursive: true, force: true })

if (watch) {
  const ctxs = await Promise.all(configs.map((c) => esbuild.context(c)))
  await Promise.all(ctxs.map((c) => c.watch()))
  await copyStatic()
  // Static assets are small; poll-copy them so edits land without a restart.
  const { watch: fsWatch } = await import('node:fs')
  for (const dir of ['src/renderer', 'src/settings', 'themes']) {
    fsWatch(dir, { recursive: true }, () => copyStatic().catch(() => {}))
  }
  console.log('[build] watching…')
} else {
  await Promise.all(configs.map((c) => esbuild.build(c)))
  await copyStatic()
  console.log('[build] done')
}
