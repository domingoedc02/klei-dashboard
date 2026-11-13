// Compiles main (tsc, CommonJS), bundles the sandboxed preload (esbuild, one file) and bakes KLEI_API_URL / KLEI_AUTH_URL into build/main/build-config.json (read by main only, 16.1).
// KLEI_RELEASE=1 (packaged build) without both values fails, like Tauri's `const _` assert in config.rs.
import { execFileSync } from 'node:child_process'
import { build } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const { KLEI_API_URL: api, KLEI_AUTH_URL: auth, KLEI_RELEASE: release } = process.env

if (release === '1' && !(api && auth)) {
  console.error('release builds need KLEI_API_URL and KLEI_AUTH_URL')
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
  JSON.stringify({ api: api || 'http://127.0.0.1:8080', auth: auth || 'http://127.0.0.1:8081' }),
)
