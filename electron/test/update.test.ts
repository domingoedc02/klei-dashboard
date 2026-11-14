import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { validate } from '../src/shared/commands.ts'
import { createHandlers } from '../src/main/commands.ts'
import { DEV_BASE, parseBase } from '../src/main/download-url.ts'
import { MemoryKeychain } from '../src/main/keychain.ts'
import { Session } from '../src/main/session.ts'
import { check, compare, DIRTY, install, MAX_BYTES } from '../src/main/update.ts'
import { UPDATE_COPY } from '../vite.config.mjs'
import { cfg } from './mock-api.ts'

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const TOKEN = 'T'.repeat(43)
const ctx = { signal: new AbortController().signal, emit() {} }

interface Seen { method: string; url: string; headers: IncomingMessage['headers'] }
async function site(reply: (req: IncomingMessage, res: ServerResponse) => void) {
  const seen: Seen[] = []
  const server = createServer((req, res) => { seen.push({ method: req.method!, url: req.url!, headers: req.headers }); reply(req, res) })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/${TOKEN}`, seen, close: () => server.closeAllConnections() ?? server.close() }
}
const json = (body: string, status = 200) => (_: IncomingMessage, res: ServerResponse) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(body) }

test('semver precedence follows the spec and refuses anything else', () => {
  const order = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.1.0', '2.0.0', '10.0.0']
  for (let i = 1; i < order.length; i++) {
    assert.ok(compare(order[i]!, order[i - 1]!) > 0, `${order[i]} > ${order[i - 1]}`)
    assert.ok(compare(order[i - 1]!, order[i]!) < 0)
  }
  assert.equal(compare('1.2.3', '1.2.3'), 0)
  for (const bad of ['', '1', '1.2', '1.2.3.4', '01.2.3', '1.2.3+build', 'v1.2.3', '1.2.3-', '1.2.3-01', '1.2.x', ' 1.2.3', '1.2.3\n', '9999999999.0.0']) {
    assert.throws(() => compare(bad, '1.0.0'), { kind: 'failed' }, JSON.stringify(bad))
  }
})

test('check: newer is available, equal and older are none; the request is one GET with only version, os and arch', async () => {
  const s = await site(json('{"version":"1.4.0","pubDate":"2026-01-01T00:00:00Z"}'))
  assert.deepEqual(await check(s.base, '1.3.9', { platform: 'darwin', arch: 'arm64' }), { status: 'available', version: '1.4.0' })
  assert.deepEqual(await check(s.base, '1.4.0'), { status: 'none' })
  assert.deepEqual(await check(s.base, '2.0.0'), { status: 'none' })
  assert.deepEqual(await check(s.base, '1.4.0-rc.1'), { status: 'available', version: '1.4.0' })
  const first = s.seen[0]!
  assert.equal(first.method, 'GET')
  assert.equal(first.url, `/${TOKEN}/latest.json?version=1.3.9&os=macos&arch=arm64`)
  assert.deepEqual(Object.keys(first.headers).sort(), ['accept', 'accept-encoding', 'accept-language', 'connection', 'host', 'sec-fetch-mode', 'user-agent'].filter((k) => k in first.headers).sort())
  for (const h of ['authorization', 'cookie', 'referer', 'origin']) assert.ok(!(h in first.headers), h)
  s.close()
})

test('check: a redirect, a bad status, a bad body or a bad version fails with fixed text and never names the address', async () => {
  const cases: [string, (req: IncomingMessage, res: ServerResponse) => void][] = [
    ['redirect', (_, res) => { res.writeHead(302, { location: 'http://127.0.0.1:1/evil' }); res.end() }],
    ['404', json('', 404)],
    ['500', json('{}', 500)],
    ['not json', json('<html>')],
    ['array', json('[]')],
    ['no version', json('{}')],
    ['number version', json('{"version":2}')],
    ['loose version', json('{"version":"v2.0.0"}')],
    ['build metadata', json('{"version":"2.0.0+x"}')],
    ['huge', json(`{"version":"2.0.0","pad":"${'a'.repeat(MAX_BYTES * 2)}"}`)],
  ]
  for (const [name, reply] of cases) {
    const s = await site(reply)
    const err = await check(s.base, '1.0.0').then(() => assert.fail(name), (e: unknown) => e as { kind: string; message: string })
    assert.deepEqual([err.kind, err.message], ['failed', 'update check failed'], name)
    assert.ok(!JSON.stringify(err).includes(TOKEN) && !err.message.includes('127.0.0.1'), name)
    assert.equal(s.seen.length, 1, `${name}: redirect followed or retried`)
    s.close()
  }
})

test('check: an unreachable host is offline, a silent one times out, and an invalid running version fails before any request', async () => {
  const dead = await site(json('{}'))
  dead.close()
  await assert.rejects(check(dead.base, '1.0.0'), { kind: 'offline', message: 'server unreachable' })
  const slow = await site(() => {})
  await assert.rejects(check(slow.base, '1.0.0', { timeoutMs: 150 }), { kind: 'timeout', message: 'request timed out' })
  const none = await site(json('{"version":"2.0.0"}'))
  await assert.rejects(check(none.base, 'not-a-version'), { kind: 'failed' })
  assert.equal(none.seen.length, 0)
  slow.close()
  none.close()
})

test('install: dirty refuses with update_refused and the exact text, and opens nothing', async () => {
  const opened: string[] = []
  await assert.rejects(install('https://x.example/t', true, async (u) => void opened.push(u)), { kind: 'update_refused', message: 'You have unsent work. Finish or discard it first.' })
  assert.equal(DIRTY, 'You have unsent work. Finish or discard it first.')
  assert.deepEqual(opened, [])
})

test('install: clean opens the fixed page once and resolves; an open failure is a fixed message', async () => {
  const opened: string[] = []
  await install('https://x.example/tok', false, async (u) => void opened.push(u))
  assert.deepEqual(opened, ['https://x.example/tok/'])
  await assert.rejects(install('https://x.example/tok', false, () => Promise.reject(new Error('https://x.example/tok secret'))), { kind: 'failed', message: 'could not open the download page' })
})

test('handlers: arguments are empty objects only, the page cannot supply a URL, the page URL is the configured one', async () => {
  for (const cmd of ['check_update', 'install_update'] as const) {
    assert.deepEqual(validate(cmd, {}), {})
    for (const hostile of [{ url: 'https://evil.example' }, { base: 'https://evil.example' }, 'https://evil.example', null, [], { __proto__: { url: 'x' }, url: 'x' }]) {
      assert.throws(() => validate(cmd, hostile), { kind: 'bad_request' }, `${cmd} ${JSON.stringify(hostile)}`)
    }
  }
  const opened: string[] = []
  const s = await site(json('{"version":"9.0.0"}'))
  const session = new Session(cfg('http://127.0.0.1:1', { download: s.base }), new MemoryKeychain())
  const h = createHandlers({ session, useMemory() {}, exit() {}, version: '1.0.0', open: async (u) => void opened.push(u) })
  assert.deepEqual(await h.check_update({}, ctx), { status: 'available', version: '9.0.0' })
  session.setDirty(true)
  await assert.rejects(h.install_update({}, ctx), { kind: 'update_refused' })
  assert.deepEqual(opened, [])
  session.setDirty(false)
  assert.equal(await h.install_update({}, ctx), null)
  assert.deepEqual(opened, [`${s.base}/`])
  s.close()
})

test('base URL: https with a 43+ character token only; local http only outside a release; no value in the message', () => {
  const ok = `https://dl.example.com/${TOKEN}`
  assert.equal(parseBase(ok, true), ok)
  assert.equal(parseBase(`${ok}/`, true), ok)
  assert.equal(parseBase(DEV_BASE, false), DEV_BASE)
  for (const [raw, release] of [
    [undefined, true], ['', false], ['not a url', false], [`http://dl.example.com/${TOKEN}`, false], [DEV_BASE, true], [`http://localhost:8090/${TOKEN}`, false],
    [`https://dl.example.com/${'T'.repeat(42)}`, true], ['https://dl.example.com/', true], [`https://dl.example.com/a/${TOKEN}`, true], [`https://dl.example.com/${TOKEN}?x=1`, true],
    [`https://u:p@dl.example.com/${TOKEN}`, true], [`https://dl.example.com/${TOKEN}#f`, true], [`https://dl.example.com/${'T'.repeat(42)}.`, true],
  ] as const) {
    assert.throws(() => parseBase(raw, release), (e: Error) => !e.message.includes(TOKEN) && !e.message.includes('dl.example') && /^KLEI_DOWNLOAD_BASE_URL/.test(e.message), String(raw))
  }
})

test('build: a release build without a good KLEI_DOWNLOAD_BASE_URL fails without printing it; a dev build bakes the local one', () => {
  const run = (env: Record<string, string>) =>
    spawnSync(process.execPath, [path('../scripts/build-main.mjs')], { env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8' })
  const urls = { KLEI_API_URL: 'https://a.example', KLEI_AUTH_URL: 'https://b.example' }
  for (const bad of [{} as Record<string, string>, { KLEI_DOWNLOAD_BASE_URL: `http://dl.example.com/${TOKEN}` }, { KLEI_DOWNLOAD_BASE_URL: `https://dl.example.com/${'T'.repeat(42)}` }]) {
    const r = run({ KLEI_RELEASE: '1', ...urls, ...bad })
    assert.equal(r.status, 1)
    assert.ok(!(r.stdout + r.stderr).includes('dl.example') && !(r.stdout + r.stderr).includes(TOKEN))
  }
  const good = `https://dl.example.com/${TOKEN}`
  assert.equal(run({ KLEI_RELEASE: '1', ...urls, KLEI_DOWNLOAD_BASE_URL: good }).status, 0)
  assert.equal(JSON.parse(readFileSync(path('../build/main/build-config.json'), 'utf8')).download, good)
  assert.equal(run({}).status, 0)
  assert.equal(JSON.parse(readFileSync(path('../build/main/build-config.json'), 'utf8')).download, DEV_BASE)
})

test('the page-side wording: every replacement matches the original once, and the original files are not edited', () => {
  for (const [file, rules] of Object.entries(UPDATE_COPY)) {
    const src = readFileSync(path(`../../desktop/${file}`), 'utf8')
    for (const [from, to] of rules) {
      assert.equal(src.split(from).length, 2, `${file}: ${from}`)
      assert.ok(!src.includes(to), `${file} already says ${to}`)
    }
  }
  assert.ok(!/update_unverified|UNVERIFIED/.test(readFileSync(path('../src/main/update.ts'), 'utf8').replace(/\/\/.*$/gm, '')))
})
