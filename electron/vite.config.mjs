// Electron-owned build of the original renderer (story 14.4). Reads desktop/ only; output and cache go under electron/.
// Vite, the React plugin, React and @tauri-apps/api come from electron/node_modules (pinned to the versions in desktop/package.json), so a clean checkout builds without installing anything under desktop/.
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = fileURLToPath(new URL('../', import.meta.url))
export const DESKTOP = join(REPO, 'desktop')
export const OUTDIR = join(REPO, 'electron/build/renderer')
export const BASELINE_OUTDIR = join(REPO, 'electron/build/baseline-renderer')
const EN = join(REPO, 'electron')
const require = createRequire(join(EN, 'package.json'))
export const loadVite = () => import(pathToFileURL(require.resolve('vite')).href)
const react = (await import(pathToFileURL(require.resolve('@vitejs/plugin-react')).href)).default

// 18.3: the approved Electron-only update flow (the button opens the download page; nothing installs or restarts). The original source stays read-only; its wording is replaced in the built bundle only.
// Each replacement must match exactly once, so a changed original fails this build instead of shipping the old promise.
export const UPDATE_COPY = {
  'src/shell/Shell.tsx': [
    ['<span>Version {update.ready} is ready.</span>', '<span>Version {update.ready} is available.</span>'],
    ['>Install and restart</button>', '>Download update</button>'],
  ],
  'src/shell/useUpdate.tsx': [
    ["title: \"Can't install yet\"", "title: \"Can't download yet\""],
    ['"Couldn\'t install the update. Try again later."', '"Couldn\'t open the download page. Try again later."'],
  ],
}
export const updateCopy = {
  name: 'klei-update-copy',
  enforce: 'pre',
  transform(code, id) {
    const rules = Object.entries(UPDATE_COPY).find(([f]) => id.replaceAll('\\', '/').endsWith(`/desktop/${f}`))?.[1]
    if (!rules) return null
    return rules.reduce((t, [from, to]) => {
      if (t.split(from).length !== 2) throw new Error(`update copy: expected one match in ${id}`)
      return t.replace(from, to)
    }, code)
  },
}

// The page's root is desktop/, so bare imports would look for desktop/node_modules; these send them to electron/node_modules.
const modules = [{ find: /^(react|react-dom|@tauri-apps\/api)(\/.*)?$/, replacement: `${EN}/node_modules/$1$2` }]

// `electron` target: aliased so the page talks to window.klei. `baseline` target: the original bundle, for the Tauri-shim parity harness.
export const config = {
  root: DESKTOP,
  configFile: false,
  clearScreen: false,
  logLevel: 'warn',
  base: './',
  cacheDir: join(REPO, 'electron/.cache/vite'),
  plugins: [updateCopy, react()],
  resolve: { alias: [{ find: '@tauri-apps/api/core', replacement: join(REPO, 'electron/src/renderer-compat/core.ts') }, ...modules] },
  server: { fs: { allow: [DESKTOP, join(REPO, 'electron/src')] } },
  build: { outDir: OUTDIR, emptyOutDir: true, assetsInlineLimit: 0, target: 'es2022' },
}
export const baselineConfig = { ...config, plugins: [react()], resolve: { alias: modules }, build: { ...config.build, outDir: BASELINE_OUTDIR } }
