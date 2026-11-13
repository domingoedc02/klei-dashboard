import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { APP_ID, PRODUCT_NAME } from '../src/main/identity.ts'

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const yml = readFileSync(path('../electron-builder.yml'), 'utf8')
const pkg = JSON.parse(readFileSync(path('../package.json'), 'utf8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> }

test('identity: preview app id and product name, never the Tauri ones', () => {
  assert.match(yml, new RegExp(`^appId: ${APP_ID.replaceAll('.', '\\.')}$`, 'm'))
  assert.match(yml, new RegExp(`^productName: ${PRODUCT_NAME}$`, 'm'))
  assert.notEqual(APP_ID, JSON.parse(readFileSync(path('../../desktop/src-tauri/tauri.conf.json'), 'utf8')).identifier)
  assert.ok(!/^appId: co\.klei\.bridal$/m.test(yml))
})

test('targets: dmg arm64 and x64, NSIS x64, AppImage and deb x64 - nothing else', () => {
  assert.match(yml, /target: dmg, arch: \[arm64, x64\]/)
  assert.match(yml, /target: nsis, arch: \[x64\]/)
  assert.match(yml, /target: AppImage, arch: \[x64\]/)
  assert.match(yml, /target: deb, arch: \[x64\]/)
  assert.equal([...yml.matchAll(/target: (\w+),/g)].length, 4)
})

test('no URL scheme is registered, no updater or publish feed is configured', () => {
  assert.ok(!/protocols|schemes|mimeType|publish:|generateUpdatesFilesForAllChannels|autoUpdate/i.test(yml))
  assert.ok(!/electron-updater|update-electron-app/.test(JSON.stringify(pkg)))
})

test('isolation: output, cache and resources stay under electron/; only built files are packed', () => {
  assert.match(yml, /^ {2}output: release$/m)
  assert.match(yml, /^ {2}buildResources: build\/icons$/m)
  assert.ok(!/\.\.\//.test(yml), 'no path leaves electron/')
  const files = [...yml.matchAll(/^ {2}- (\S+)$/gm)].map((m) => m[1])
  assert.deepEqual(files, ['package.json', 'build/package.json', 'build/main/**', 'build/shared/**', 'build/preload/**', 'build/renderer/**'])
  const pack = readFileSync(path('../scripts/pack.mjs'), 'utf8')
  assert.match(pack, /ELECTRON_BUILDER_CACHE: `\$\{root\}\.cache\/builder`/)
  assert.match(pack, /ELECTRON_CACHE: `\$\{root\}\.cache\/electron`/)
  assert.match(pack, /--publish', 'never'/)
  assert.match(readFileSync(path('../.gitignore'), 'utf8'), /^\/release\/$/m)
})

test('icons are copied from the Tauri set byte for byte and declared per OS', () => {
  const pack = readFileSync(path('../scripts/pack.mjs'), 'utf8')
  assert.match(pack, /copyFileSync\(`\$\{icons\}\$\{f\}`/)
  assert.match(pack, /\['icon\.icns', 'icon\.ico', 'icon\.png'\]/)
  for (const f of ['icon.icns', 'icon.ico', 'icon.png']) assert.ok(existsSync(path(`../../desktop/src-tauri/icons/${f}`)), f)
  assert.match(yml, /icon: icon\.icns/)
  assert.match(yml, /icon: icon\.ico/)
  assert.match(yml, /icon: icon\.png/)
})

test('the packaging tool is an exact pin and the native keyring and zip are runtime dependencies', () => {
  assert.match(pkg.devDependencies['electron-builder']!, /^\d+\.\d+\.\d+$/)
  assert.match(pkg.devDependencies.electron!, /^\d+\.\d+\.\d+$/)
  assert.ok(pkg.dependencies['@napi-rs/keyring'] && pkg.dependencies['@zip.js/zip.js'])
  assert.ok(!('electron-builder' in pkg.dependencies), 'the tool is not shipped inside the app')
})

// Runs only when `npm run pack -- --mac --arm64 --dir` has been run on this machine; the matrix builds are 19.3.
const app = path('../release/mac-arm64/Klei Bridal Preview.app')
test('packed macOS arm64 app: metadata, no URL types, native keyring unpacked, smoke launch exits 0', { skip: process.platform !== 'darwin' || process.arch !== 'arm64' || !existsSync(app) }, () => {
  const plist = join(app, 'Contents/Info.plist')
  const read = (k: string) => execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${k}`, plist], { encoding: 'utf8' }).trim()
  assert.equal(read('CFBundleIdentifier'), APP_ID)
  assert.equal(read('CFBundleName'), PRODUCT_NAME)
  assert.throws(() => execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleURLTypes', plist], { stdio: 'pipe' }), 'no URL scheme in the bundle')
  assert.ok(existsSync(join(app, 'Contents/Resources/app.asar.unpacked/node_modules/@napi-rs/keyring-darwin-arm64/keyring.darwin-arm64.node')))
  const bin = join(app, 'Contents/MacOS', PRODUCT_NAME)
  execFileSync(bin, [], { env: { ...process.env, KLEI_SMOKE: '1' }, timeout: 40_000, stdio: 'pipe' })
})
