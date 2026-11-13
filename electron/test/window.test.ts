import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { APP_ID, MAIN_LABEL, MAIN_WINDOW, PRODUCT_NAME, SMOKE_EXIT_MS, USER_DATA_DIR } from '../src/main/identity.ts'

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const tauri = JSON.parse(readFileSync(path('../../desktop/src-tauri/tauri.conf.json'), 'utf8'))

test('window options equal the Tauri window', () => {
  const w = tauri.app.windows[0]
  assert.equal(MAIN_LABEL, w.label ?? 'main')
  assert.deepEqual(
    { title: MAIN_WINDOW.title, width: MAIN_WINDOW.width, height: MAIN_WINDOW.height, minWidth: MAIN_WINDOW.minWidth, minHeight: MAIN_WINDOW.minHeight },
    { title: w.title, width: w.width, height: w.height, minWidth: w.minWidth, minHeight: w.minHeight },
  )
  assert.equal(MAIN_WINDOW.show, false)
  assert.equal(MAIN_WINDOW.useContentSize, true, 'Tauri sizes are inner sizes')
})

test('preview identity is separate from the Tauri identity', () => {
  assert.equal(APP_ID, 'co.klei.bridal.electron.preview')
  assert.notEqual(APP_ID, tauri.identifier)
  assert.equal(PRODUCT_NAME, 'Klei Bridal Preview')
  assert.notEqual(USER_DATA_DIR, tauri.productName)
  assert.equal(SMOKE_EXIT_MS, 60_000)
})

test('package.json is private, pinned, has no link to desktop/', () => {
  const pkg = JSON.parse(readFileSync(path('../package.json'), 'utf8'))
  assert.equal(pkg.private, true)
  for (const s of ['build', 'typecheck', 'test']) assert.ok(pkg.scripts[s], s)
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  for (const [name, v] of Object.entries<string>(deps)) {
    assert.match(v, /^\d+\.\d+\.\d+$/, `${name} must be an exact version`)
    assert.ok(!/desktop|file:|link:|workspace:/.test(v), name)
  }
  assert.ok(!pkg.workspaces)
})

test('release build without KLEI_API_URL or KLEI_AUTH_URL fails; dev build bakes defaults', () => {
  const run = (env: Record<string, string>) =>
    spawnSync(process.execPath, [path('../scripts/build-main.mjs')], { env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8' })
  assert.equal(run({ KLEI_RELEASE: '1' }).status, 1)
  assert.equal(run({ KLEI_RELEASE: '1', KLEI_API_URL: 'https://a.example' }).status, 1)
  assert.equal(run({}).status, 0)
  assert.deepEqual(JSON.parse(readFileSync(path('../build/main/build-config.json'), 'utf8')), { api: 'http://127.0.0.1:8080', auth: 'http://127.0.0.1:8081' })
  assert.equal(run({ KLEI_RELEASE: '1', KLEI_API_URL: 'https://a.example', KLEI_AUTH_URL: 'https://b.example' }).status, 0)
  assert.deepEqual(JSON.parse(readFileSync(path('../build/main/build-config.json'), 'utf8')), { api: 'https://a.example', auth: 'https://b.example' })
  execFileSync(process.execPath, [path('../scripts/build-main.mjs')], { env: { PATH: process.env.PATH ?? '' } })
})
