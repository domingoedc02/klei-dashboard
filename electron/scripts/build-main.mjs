// Compiles main/preload and bakes KLEI_API_URL / KLEI_AUTH_URL into build/main/build-config.json (read by main only, 16.1).
// KLEI_RELEASE=1 (packaged build) without both values fails, like Tauri's `const _` assert in config.rs.
import { execFileSync } from 'node:child_process'
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
// The package is ESM (scripts, tests); Electron loads main as CommonJS.
writeFileSync(`${root}build/main/package.json`, '{"type":"commonjs"}')
writeFileSync(
  `${root}build/main/build-config.json`,
  JSON.stringify({ api: api || 'http://127.0.0.1:8080', auth: auth || 'http://127.0.0.1:8081' }),
)
