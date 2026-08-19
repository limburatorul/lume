import esbuild from 'esbuild'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

const out = path.join(os.tmpdir(), 'lume-smoke.mjs')
await esbuild.build({
  entryPoints: ['scripts/smoke-entry.ts'],
  bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error',
})
await import(pathToFileURL(out).href)
fs.rmSync(out, { force: true })
