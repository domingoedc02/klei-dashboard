import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { APP_ID, KEYCHAIN_SERVICE, PRODUCT_NAME, USER_DATA_DIR } from '../src/main/identity.ts'

// Non-destructive package checks only. They do not replace the real-OS runs recorded in docs/release-checklist-electron.md.
const path = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const checklist = readFileSync(path('../../docs/release-checklist-electron.md'), 'utf8')
const tauri = JSON.parse(readFileSync(path('../../desktop/src-tauri/tauri.conf.json'), 'utf8')) as { identifier: string }

test('checklist: five targets, every step, every result column, and the two identities from the code', () => {
  for (const t of ['mac-arm64.dmg', 'mac-x64.dmg', 'win-x64.exe', 'linux-x64.AppImage', 'linux-x64.deb']) assert.ok(checklist.includes(t), t)
  for (const s of ['Fresh install', 'Sign in', 'Retention', 'Manual update', 'Reinstall', 'Sign out', 'Rollback', 'Uninstall']) assert.ok(checklist.includes(`**${s}`), s)
  for (const c of ['OS and arch', 'Version', 'Artifact SHA-256', 'Warnings seen', 'Credential retention', 'Profile separation', 'Uninstall cleanup', 'Rollback', 'Result', 'Evidence', 'Date', 'Operator']) assert.ok(checklist.includes(`| ${c} |`) || checklist.includes(`| ${c}`), c)
  assert.ok(checklist.includes(`\`${APP_ID}\``) && checklist.includes(`service \`${KEYCHAIN_SERVICE}\``) && checklist.includes(`\`${USER_DATA_DIR}\``))
  assert.ok(checklist.includes(`\`${tauri.identifier}\``))
  assert.notEqual(KEYCHAIN_SERVICE, tauri.identifier)
  assert.match(checklist, /PASS, CONCERNS or FAIL/)
})

test('checklist: test account only, manual update only, no claim of cleanup without looking', () => {
  assert.match(checklist, /test account only/i)
  assert.match(checklist, /never downloads, installs or restarts/)
  assert.match(checklist, /Claim nothing is removed unless you looked/)
  assert.ok(!/migrat(e|ion) (the |a )?(credential|token)s?/i.test(checklist.replace(/never move a credential[^.]*\./i, '')))
})

// Needs `npm run pack -- --mac --arm64 --dir` on this machine; the OS matrix is 19.3.
const app = path('../release/mac-arm64/Klei Bridal Preview.app')
const present = process.platform === 'darwin' && process.arch === 'arm64' && existsSync(app)

test('packed macOS app: update wording in the bundle, and a start leaves the Tauri profile alone', { skip: !present }, () => {
  const asar = readFileSync(join(app, 'Contents/Resources/app.asar'), 'latin1')
  assert.ok(asar.includes('Download update'))
  assert.ok(!asar.includes('Install and restart'))
  assert.ok(!asar.includes('Couldn\'t install the update'))

  const support = join(homedir(), 'Library/Application Support')
  const before = new Set(readdirSync(support))
  execFileSync(join(app, 'Contents/MacOS', PRODUCT_NAME), [], { env: { ...process.env, KLEI_SMOKE: '1' }, timeout: 40_000, stdio: 'pipe' })
  const added = readdirSync(support).filter((n) => !before.has(n))
  assert.ok(added.every((n) => n === USER_DATA_DIR), `only the preview profile may appear, got ${added.join(', ')}`)
  assert.ok(existsSync(join(support, USER_DATA_DIR)))
  assert.equal(existsSync(join(support, tauri.identifier)), before.has(tauri.identifier), 'Tauri profile folder neither created nor removed')
})
