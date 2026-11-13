import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const ROOT = path('..')
// Playwright and the Electron binary come from existing installs; nothing is added to the lockfile.
const { _electron } = createRequire(path('../../desktop/package.json'))('@playwright/test')
const electronBin: string = createRequire(path('../package.json'))('electron')

const hits: string[] = []
const server = createServer((req, res) => { hits.push(`${req.method} ${req.url}`); res.end('x') })
const profile = mkdtempSync(join(tmpdir(), 'klei-hostile-'))
let base = ''

before(async () => {
  execFileSync(process.execPath, [join(ROOT, 'scripts/build-main.mjs')], { stdio: 'inherit' })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
after(() => { server.close(); rmSync(profile, { recursive: true, force: true }) })

const launch = (env: Record<string, string>) =>
  _electron.launch({ executablePath: electronBin, args: [join(ROOT, 'build/main/index.js')], cwd: ROOT, env: { ...process.env, KLEI_USER_DATA: profile, ...env } })

test('compromised page: no network, no popups, no navigation, no Node, no permissions', { timeout: 60_000 }, async () => {
  const app = await launch({ KLEI_RENDERER_DIR: path('./fixtures/hostile') })
  try {
    const page = await app.firstWindow()
    await page.waitForFunction(() => typeof (window as unknown as { attack?: unknown }).attack === 'function')
    assert.equal(page.url(), 'app://klei/')
    const { out, violations } = await page.evaluate((b: string) => (window as unknown as { attack(b: string): Promise<{ out: Record<string, unknown>; violations: string[] }> }).attack(b), base)

    for (const k of ['fetch', 'xhr', 'ws', 'eventsource', 'img']) assert.equal(out[k], 'blocked', k)
    // A frame blocked by CSP still fires onload (with an error page), so judge it by the violation and by the server seeing nothing.
    assert.ok(violations.includes('frame-src'), `violations: ${violations}`)
    assert.equal(out.webviewIsReal, false)
    assert.deepEqual(out.open, ['denied', 'denied', 'denied'])
    assert.equal(out.stayed, true)
    assert.equal(out.node, true)
    assert.equal(out.notification, 'denied')
    assert.equal(out.geolocation, 'denied')
    for (const k of ['clipboardRead', 'usb']) assert.equal(out[k], 'blocked', k)
    // Audio capture can stay pending without ever reaching the permission handler; the contract is only that it is never granted.
    assert.notEqual(out.media, 'allowed')
    assert.ok(violations.includes('connect-src'), `violations: ${violations}`)
    assert.deepEqual(hits, [], 'the local server must see nothing')
    assert.equal(await app.evaluate(({ BrowserWindow }: { BrowserWindow: { getAllWindows(): unknown[] } }) => BrowserWindow.getAllWindows().length), 1)
  } finally {
    await app.close()
  }
})

test('real renderer loads from app://klei/ with the CSP and no violation', { timeout: 60_000 }, async () => {
  const app = await launch({})
  try {
    const page = await app.firstWindow()
    const violations: string[] = []
    page.on('console', (m: { text(): string }) => { if (/Content Security Policy|Refused to/.test(m.text())) violations.push(m.text()) })
    await page.waitForLoadState('load')
    await page.waitForFunction(() => document.fonts.status === 'loaded')
    assert.equal(page.url(), 'app://klei/')
    assert.ok(await page.evaluate(() => document.styleSheets.length > 0))
    assert.deepEqual(violations, [])
  } finally {
    await app.close()
  }
})
