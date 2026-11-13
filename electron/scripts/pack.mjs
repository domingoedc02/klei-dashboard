// Packages the built app (18.1). Copies the Tauri icons read-only into build/icons and keeps every cache under electron/.
// Usage: node scripts/pack.mjs [electron-builder args]   e.g. --mac --arm64 --dir
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const icons = `${root}../desktop/src-tauri/icons/`
mkdirSync(`${root}build/icons`, { recursive: true })
for (const f of ['icon.icns', 'icon.ico', 'icon.png']) copyFileSync(`${icons}${f}`, `${root}build/icons/${f}`)

const bin = fileURLToPath(new URL('../node_modules/electron-builder/cli.js', import.meta.url))
execFileSync(process.execPath, [bin, '--config', 'electron-builder.yml', '--publish', 'never', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_BUILDER_CACHE: `${root}.cache/builder`, ELECTRON_CACHE: `${root}.cache/electron`, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
})
