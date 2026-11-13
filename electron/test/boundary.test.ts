import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { resolveAppFile, serveAppFile } from '../src/main/app-files.ts'
import { APP_URL, isAppUrl, PERMISSIONS_ALLOWED, webPreferences } from '../src/main/boundary.ts'
import { CSP } from '../src/main/csp.ts'

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const tauri = JSON.parse(readFileSync(path('../../desktop/src-tauri/tauri.conf.json'), 'utf8'))

test('webPreferences equal the hardened set exactly', () => {
  assert.deepEqual(webPreferences(true), {
    contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
    webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, spellcheck: true, devTools: false,
  })
  assert.equal(webPreferences(false).devTools, true)
  const win = readFileSync(path('../src/main/window.ts'), 'utf8')
  for (const k of ['sandbox', 'nodeIntegration', 'contextIsolation', 'webSecurity', 'allowpopups']) assert.ok(!win.includes(k), `window.ts must not set ${k} itself`)
})

test('CSP equals the Tauri release CSP', () => assert.equal(CSP, tauri.app.security.csp))

test('permission allow list is empty', () => assert.deepEqual(PERMISSIONS_ALLOWED, []))

test('only app://klei/ is an app URL', () => {
  assert.ok(isAppUrl(APP_URL) && isAppUrl('app://klei/#/dashboard') && isAppUrl('app://klei/assets/x.js'))
  for (const u of ['app://evil/', 'app://klei:81/', 'app://u:p@klei/', 'https://klei/', 'http://klei-img.localhost/', 'file:///etc/passwd', 'data:text/html,x',
    'javascript:alert(1)', 'blob:app://klei/1', 'about:blank', 'APP://klei.evil/', '', 'not a url']) assert.ok(!isAppUrl(u), u)
})

test('app file serving is confined to the renderer root', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'klei-app-'))
  const root = join(dir, 'renderer')
  mkdirSync(join(root, 'assets'), { recursive: true })
  writeFileSync(join(root, 'index.html'), '<html></html>')
  writeFileSync(join(root, 'assets', 'a.js'), '1')
  writeFileSync(join(root, 'assets', 'a.map'), '1')
  writeFileSync(join(dir, 'secret.txt'), 'secret')
  symlinkSync(join(dir, 'secret.txt'), join(root, 'assets', 'link.js'))
  symlinkSync(dir, join(root, 'up'))
  const ok = ['/', '', '/index.html', '/assets/a.js']
  for (const p of ok) assert.ok(await resolveAppFile(root, p), p)
  const bad = ['/..', '/../secret.txt', '/assets/../../secret.txt', '/%2e%2e/secret.txt', '/%2e%2e%2fsecret.txt', '/assets/%2e%2e/index.html', '/assets/..%5c..%5csecret.txt',
    '//etc/passwd', '/assets//a.js', '/assets/', '/assets', '/missing.js', '/assets/link.js', '/up/secret.txt', '/C:/Windows/win.ini', '/%00', '/%zz', 'index.html', '/assets/./a.js']
  for (const p of bad) assert.equal(await resolveAppFile(root, p), undefined, p)

  const get = (url: string, method = 'GET') => serveAppFile(root, { url, method })
  const res = await get('app://klei/assets/a.js')
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'text/javascript; charset=utf-8')
  assert.equal(res.headers.get('content-security-policy'), CSP)
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  const index = await get('app://klei/')
  assert.equal(index.headers.get('content-type'), 'text/html; charset=utf-8')
  assert.equal(index.headers.get('content-security-policy'), CSP)
  for (const url of ['app://klei/assets/a.map', 'app://klei/../secret.txt', 'app://other/index.html']) {
    const r = await get(url)
    assert.equal(r.status, 404, url)
    assert.equal(r.headers.get('content-security-policy'), CSP)
  }
  assert.equal((await get('app://klei/', 'POST')).status, 405)
})
