// Builds the original renderer, read-only, into electron/build/renderer (story 14.2 helper; 14.4 owns the final build config).
// Nothing is written under desktop/: output and cache both go under electron/. desktop/node_modules is only read.
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = fileURLToPath(new URL('../../../', import.meta.url))
const DESKTOP = join(REPO, 'desktop')
const require = createRequire(join(DESKTOP, 'package.json'))
const { build } = await import(pathToFileURL(require.resolve('vite')).href)
const react = (await import(pathToFileURL(require.resolve('@vitejs/plugin-react')).href)).default

export const OUTDIR = join(REPO, 'electron/build/renderer')

await build({
  root: DESKTOP,
  configFile: false,
  clearScreen: false,
  logLevel: 'warn',
  cacheDir: join(REPO, 'electron/.cache/vite'),
  plugins: [react()],
  build: { outDir: OUTDIR, emptyOutDir: true, assetsInlineLimit: 0, target: 'es2022' },
})
console.log(OUTDIR)
