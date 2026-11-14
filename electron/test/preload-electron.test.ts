import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const ROOT = path('..')
const { _electron } = createRequire(path('../package.json'))('@playwright/test')
const electronBin: string = createRequire(path('../package.json'))('electron')
const profile = mkdtempSync(join(tmpdir(), 'klei-preload-'))
const SHOTS = process.env.KLEI_SHOT_DIR

// Nothing listens on port 1, so check_update is offline and no test can reach a real download site.
before(() => { execFileSync(process.execPath, [join(ROOT, 'scripts/build-main.mjs')], { stdio: 'inherit', env: { ...process.env, KLEI_DOWNLOAD_BASE_URL: `http://127.0.0.1:1/${'x'.repeat(43)}` } }) })
after(() => rmSync(profile, { recursive: true, force: true }))

const launch = (env: Record<string, string> = {}) =>
  _electron.launch({ executablePath: electronBin, args: [join(ROOT, 'build/main/index.js')], cwd: ROOT, env: { ...process.env, KLEI_USER_DATA: profile, ...env } })

type Klei = Record<string, (...a: unknown[]) => Promise<unknown>>

test('real preload: nine methods, no Node, plain errors, channel calls settle', { timeout: 60_000 }, async () => {
  const app = await launch()
  try {
    const page = await app.firstWindow()
    const problems: string[] = []
    page.on('console', (m: { text(): string }) => { if (/Content Security Policy|Refused to|Uncaught/.test(m.text())) problems.push(m.text()) })
    page.on('pageerror', (e: Error) => problems.push(String(e)))
    await page.waitForLoadState('load')
    await page.waitForFunction(() => typeof (window as unknown as { klei?: unknown }).klei === 'object')

    const r = await page.evaluate(async () => {
      const k = (window as unknown as { klei: Record<string, (...a: unknown[]) => Promise<unknown>> }).klei
      const err = (p: Promise<unknown>) => p.then(() => 'resolved', (e: unknown) => ({ plain: Object.getPrototypeOf(e) === Object.prototype, keys: Object.keys(e as object).sort(), e: JSON.parse(JSON.stringify(e)) }))
      const events: unknown[] = []
      return {
        keys: Object.keys(k).sort(),
        names: Object.getOwnPropertyNames(k).sort(),
        symbols: Object.getOwnPropertySymbols(k).length,
        globals: [typeof (window as never as { ipcRenderer: unknown }).ipcRenderer, typeof require, typeof process, typeof Buffer].join(),
        electronGlobals: Object.keys(window).filter((n) => /electron|ipc|klei/i.test(n)),
        offline: await err(k.check_update()!),
        badKeys: await err(k.api_request!({ method: 'GET', path: '/x', evil: 1 })),
        badType: await err(k.set_dirty!('yes')),
        refused: await (async () => { await k.set_dirty!(true); const e = await err(k.install_update!()); await k.set_dirty!(false); return e })(),
        uploadBad: await err(k.upload_files!('nope', 't', () => {})),
        exportBad: await err(k.export_gowns!('start', new Array(1001).fill('a'), () => {})),
        events,
        isFrozen: Object.isFrozen(k),
      }
    })
    assert.deepEqual(r.keys, ['api_request', 'check_update', 'export_gowns', 'install_update', 'session_only', 'set_dirty', 'sign_in', 'sign_out', 'upload_files'])
    assert.deepEqual(r.names, r.keys)
    assert.equal(r.symbols, 0)
    assert.equal(r.globals, 'undefined,undefined,undefined,undefined')
    assert.deepEqual(r.electronGlobals, ['klei'])
    assert.deepEqual(r.offline, { plain: true, keys: ['kind', 'message'], e: { kind: 'offline', message: 'server unreachable' } })
    assert.deepEqual(r.refused, { plain: true, keys: ['kind', 'message'], e: { kind: 'update_refused', message: 'You have unsent work. Finish or discard it first.' } })
    const bad = { plain: true, keys: ['kind', 'message'], e: { kind: 'bad_request', message: 'bad request' } }
    for (const k of ['badKeys', 'badType', 'uploadBad', 'exportBad'] as const) assert.deepEqual(r[k], bad, k)
    assert.deepEqual(r.events, [])
    assert.deepEqual(problems, [])
  } finally {
    await app.close()
  }
})

test('a sub-frame on app://klei gets no bridge; the main page keeps working after a reload', { timeout: 60_000 }, async () => {
  const app = await launch({ KLEI_RENDERER_DIR: path('./fixtures/hostile') })
  try {
    const page = await app.firstWindow()
    await page.waitForFunction(() => typeof (window as unknown as { klei?: unknown }).klei === 'object')
    const sub = await page.evaluate(
      () => new Promise<string>((res) => {
        const f = document.createElement('iframe')
        f.src = 'app://klei/'
        f.onload = () => res(`loaded:${typeof (f.contentWindow as unknown as { klei?: unknown }).klei}`)
        document.body.append(f)
        setTimeout(() => res('timeout'), 5000)
      }),
    )
    assert.equal(sub, 'loaded:undefined')
    const inner = page.frames().find((f: { url(): string }, i: number) => i > 0 && f.url() === 'app://klei/')
    if (inner) assert.equal(await inner.evaluate(() => typeof (window as unknown as { klei?: unknown }).klei), 'undefined')
    await page.reload()
    await page.waitForFunction(() => typeof (window as unknown as { klei?: unknown }).klei === 'object')
    const again = await page.evaluate(() => (window as unknown as { klei: Klei }).klei.sign_out!().then(() => 'resolved', (e: { kind: string }) => e.kind))
    assert.equal(again, 'resolved')
  } finally {
    await app.close()
  }
})

test('signed-out stubs: the real renderer at 1280x800 shows an error state, no crash, no violations', { timeout: 60_000 }, async () => {
  const app = await launch()
  try {
    const page = await app.firstWindow()
    const problems: string[] = []
    page.on('console', (m: { text(): string }) => { if (/Content Security Policy|Refused to/.test(m.text())) problems.push(m.text()) })
    page.on('pageerror', (e: Error) => problems.push(String(e)))
    await page.waitForLoadState('load')
    await page.waitForSelector('.app, #root > *', { timeout: 15000 })
    await page.waitForTimeout(1500)
    const size = await page.evaluate(() => `${window.innerWidth}x${window.innerHeight}`)
    assert.equal(size, '1280x800')
    const text = await page.evaluate(() => document.body.innerText.trim().slice(0, 200))
    assert.ok(text.length > 0, 'page is blank')
    assert.deepEqual(problems, [])
    if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, 'stubs-1280x800.png') }); console.log('TEXT:', JSON.stringify(text)) }
  } finally {
    await app.close()
  }
})
