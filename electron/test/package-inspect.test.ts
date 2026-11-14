import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildManifest, entries, tagVersion, validVersion } from '../scripts/release-manifest.mjs'
import { inspect } from '../scripts/inspect-package.mjs'

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const asar = createRequire(path('../package.json'))('@electron/asar') as { createPackage(src: string, dest: string): Promise<void> }
const APP_ID = 'co.klei.bridal.electron.preview'
const plist = (extra = '', id = APP_ID) => `<plist><dict><key>CFBundleIdentifier</key><string>${id}</string>${extra}</dict></plist>`

/** A fake unpacked app: `files` go inside app.asar, `unpacked` beside it. */
async function fake(files: Record<string, string>, { mac = false, keyring = true, info = plist() }: { mac?: boolean; keyring?: boolean; info?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'inspect-'))
  const src = join(root, 'src')
  for (const [f, t] of Object.entries(files)) {
    mkdirSync(join(src, f, '..'), { recursive: true })
    writeFileSync(join(src, f), t)
  }
  const dir = join(root, 'out')
  const res = mac ? join(dir, 'App.app/Contents/Resources') : join(dir, 'resources')
  mkdirSync(res, { recursive: true })
  await asar.createPackage(src, join(res, 'app.asar'))
  if (keyring) {
    const n = join(res, 'app.asar.unpacked/node_modules/@napi-rs/keyring-linux-x64-gnu')
    mkdirSync(n, { recursive: true })
    writeFileSync(join(n, 'keyring.linux-x64-gnu.node'), 'x')
  }
  if (mac) writeFileSync(join(dir, 'App.app/Contents/Info.plist'), info)
  return dir
}
const OK = { 'build/main/index.js': 'console.log(1)', 'package.json': '{}' }

test('inspect: a clean linux-shaped and mac-shaped package passes', async () => {
  assert.deepEqual(inspect(await fake(OK)), [])
  assert.deepEqual(inspect(await fake(OK, { mac: true })), [])
})

test('inspect: source maps, Tauri source, .env and key files are named', async () => {
  const p = inspect(await fake({ ...OK, 'a.js.map': '{}', 'src-tauri/x.rs': '', '.env': 'A=1', 'k/id.pem': 'x' }))
  for (const w of ['source map', 'Tauri source', '.env file', 'key file']) assert.ok(p.some((m) => m.startsWith(w)), w)
})

test('inspect: secret-shaped text in the asar fails, and the message does not repeat it', async () => {
  const jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'sig'].join('.')
  const p = inspect(await fake({ ...OK, 'build/x.js': `t="${jwt}"`, 'build/y.js': 'ELECTRON_DEPLOY_KEY' }))
  assert.ok(p.includes('JWT-shaped string inside app.asar') && p.includes('deploy setting name inside app.asar'))
  assert.ok(!p.join('\n').includes(jwt))
})

test('inspect: native credential library not unpacked, wrong app id and a URL scheme are caught', async () => {
  assert.ok(inspect(await fake(OK, { keyring: false })).some((m) => /not unpacked/.test(m)))
  assert.ok(inspect(await fake(OK, { mac: true, info: plist('', 'co.klei.bridal') })).some((m) => m.startsWith('app id is not')))
  assert.ok(inspect(await fake(OK, { mac: true, info: plist('<key>CFBundleURLTypes</key><array/>') })).some((m) => /URL scheme/.test(m)))
})

test('inspect: a folder without app.asar is reported, not crashed on', () => {
  const dir = mkdtempSync(join(tmpdir(), 'inspect-'))
  assert.deepEqual(inspect(dir), [`no app.asar under ${dir}`])
})

const NAMES = ['mac-arm64.dmg', 'mac-x64.dmg', 'win-x64.exe', 'linux-x64.AppImage', 'linux-x64.deb']
const installers = (v = '1.2.3', names = NAMES) => {
  const d = mkdtempSync(join(tmpdir(), 'rel-'))
  for (const n of names) writeFileSync(join(d, `klei-bridal-preview-${v}-${n}`), n)
  writeFileSync(join(d, `klei-bridal-preview-${v}-mac-arm64.dmg.blockmap`), 'ignored')
  writeFileSync(join(d, 'builder-debug.yml'), 'ignored')
  return d
}

test('manifest: five installers become release.json fields only, sorted, with size and sha256, no URL', async () => {
  const m = buildManifest(await entries(installers()), '1.2.3', new Date('2026-11-14T00:00:00Z'))
  assert.deepEqual(Object.keys(m), ['version', 'pubDate', 'channel', 'files'])
  assert.equal(m.channel, 'preview')
  assert.equal(m.pubDate, '2026-11-14T00:00:00.000Z')
  assert.equal(m.files.length, 5)
  assert.deepEqual(Object.keys(m.files[0]!).sort(), ['arch', 'kind', 'name', 'os', 'sha256', 'size'])
  assert.match(m.files[0]!.sha256, /^[0-9a-f]{64}$/)
  assert.ok(!/https?:|download/i.test(JSON.stringify(m)))
  assert.deepEqual(m.files.map((f: { name: string }) => f.name), [...m.files.map((f: { name: string }) => f.name)].sort())
})

test('manifest: four or six installers, a duplicate target, a mixed version and a bad name each fail', async () => {
  const five = await entries(installers())
  assert.throws(() => buildManifest(five.slice(1), '1.2.3'), /expected 5/)
  assert.throws(() => buildManifest([...five, five[0]], '1.2.3'), /expected 5/)
  assert.throws(() => buildManifest([...five.slice(1), { ...five[1], name: five[1].name.replace('mac-x64', 'mac-arm64') }], '1.2.3'), /duplicate/)
  assert.throws(() => buildManifest(five, '1.2.4'), /installer version differs/)
  assert.throws(() => buildManifest(five, '1.2'), /not semver/)
  await assert.rejects(entries(installers('1.2.3', [...NAMES, 'win-arm64.exe'])), /unexpected installer name/)
  await assert.rejects(entries(installers('latest')), /unexpected installer name/)
})

test('tag: electron-v<semver> must equal the package version; anything else is refused', () => {
  assert.equal(tagVersion('electron-v0.0.0', '0.0.0'), '0.0.0')
  assert.equal(tagVersion('electron-v1.2.3-rc.1', '1.2.3-rc.1'), '1.2.3-rc.1')
  for (const t of ['v1.2.3', 'electron-v1.2', 'electron-v1.2.3 ', 'electron-v01.2.3', 'electron-v1.2.3+build', 'electron-1.2.3', '']) assert.throws(() => tagVersion(t, '1.2.3'), /tag is not/, t)
  assert.throws(() => tagVersion('electron-v1.2.4', '1.2.3'), /differs from package.json/)
  assert.equal(validVersion('1.2.3'), true)
  assert.equal(validVersion('1.2.3+x'), false)
})
