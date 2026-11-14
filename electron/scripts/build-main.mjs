// Compiles main (tsc, CommonJS), bundles the sandboxed preload (esbuild, one file) and bakes KLEI_API_URL / KLEI_AUTH_URL into build/main/build-config.json (read by main only, 16.1).
// KLEI_RELEASE=1 (packaged build) without both values fails, like Tauri's `const _` assert in config.rs.
// KLEI_DOWNLOAD_BASE_URL (18.3) is the download site's base URL with its secret path token: required and https in a release build, checked here, baked for main only, never printed.
import { execFileSync } from 'node:child_process'
import { build } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DEV_BASE, parseBase } from '../src/main/download-url.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const { KLEI_API_URL: api, KLEI_AUTH_URL: auth, KLEI_RELEASE: release, KLEI_DOWNLOAD_BASE_URL: site } = process.env

if (release === '1' && !(api && auth)) {
  console.error('release builds need KLEI_API_URL and KLEI_AUTH_URL')
  process.exit(1)
}
let download
try {
  download = parseBase(site || (release === '1' ? undefined : DEV_BASE), release === '1')
} catch (e) {
  console.error(e.message)
  process.exit(1)
}
const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))
execFileSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit' })
mkdirSync(`${root}build/main`, { recursive: true })
// The package is ESM (scripts, tests); Electron loads main (build/main, build/shared) as CommonJS.
writeFileSync(`${root}build/package.json`, '{"type":"commonjs"}')
// A sandboxed preload cannot require local files: everything but `electron` is inlined.
await build({
  entryPoints: [`${root}src/preload/index.ts`],
  outfile: `${root}build/preload/index.js`,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron'],
  logLevel: 'warning',
})
writeFileSync(
  `${root}build/main/build-config.json`,
  JSON.stringify({ api: api || 'http://127.0.0.1:8080', auth: auth || 'http://127.0.0.1:8081', download }),
)
