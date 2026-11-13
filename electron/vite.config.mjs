// Electron-owned build of the original renderer (story 14.4). Reads desktop/ only; output and cache go under electron/.
// Vite, React plugin and @tauri-apps/api resolve from desktop/node_modules (read-only) until 15.1 installs a pinned copy under electron/.
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = fileURLToPath(new URL('../', import.meta.url))
export const DESKTOP = join(REPO, 'desktop')
export const OUTDIR = join(REPO, 'electron/build/renderer')
export const BASELINE_OUTDIR = join(REPO, 'electron/build/baseline-renderer')
const require = createRequire(join(DESKTOP, 'package.json'))
export const loadVite = () => import(pathToFileURL(require.resolve('vite')).href)
const react = (await import(pathToFileURL(require.resolve('@vitejs/plugin-react')).href)).default

// `electron` target: aliased so the page talks to window.klei. `baseline` target: the original bundle, for the Tauri-shim parity harness.
export const config = {
  root: DESKTOP,
  configFile: false,
  clearScreen: false,
  logLevel: 'warn',
  base: './',
  cacheDir: join(REPO, 'electron/.cache/vite'),
  plugins: [react()],
  resolve: { alias: { '@tauri-apps/api/core': join(REPO, 'electron/src/renderer-compat/core.ts') } },
  server: { fs: { allow: [DESKTOP, join(REPO, 'electron/src')] } },
  build: { outDir: OUTDIR, emptyOutDir: true, assetsInlineLimit: 0, target: 'es2022' },
}
export const baselineConfig = { ...config, resolve: {}, build: { ...config.build, outDir: BASELINE_OUTDIR } }
