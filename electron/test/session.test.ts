import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../src/main/config.ts'
import { createHandlers } from '../src/main/commands.ts'
import { MemoryKeychain } from '../src/main/keychain.ts'
import { Session, timeoutFor } from '../src/main/session.ts'
import { cfg, mock, pair } from './mock-api.ts'

const call = (method: string, path: string, over: object = {}) => ({ method, path, body: null, ifMatch: null, idempotencyKey: null, ...over })
const signedIn = async (api: string, over = {}) => {
  const kc = new MemoryKeychain()
  await kc.store('refresh-0')
  return { s: new Session(cfg(api, over), kc), kc }
}
const kind = (p: Promise<unknown>) => p.then(() => assert.fail('resolved'), (e: { kind: string }) => e.kind)

test('requests stay under the api prefix and use an allowed method', async () => {
  const m = await mock(() => [200, {}])
  const s = new Session(cfg(m.api), new MemoryKeychain())
  for (const p of ['/me', '/api/v1/../x', '//evil.test/api/v1/x', '/api/v1/a b', 'http://evil.test/api/v1/x', '/api/v1/a\\b', '/api/v1/%2e%2e/x', '/api/v1/a\r\nX: y']) {
    assert.equal(await kind(s.requestIf(call('GET', p))), 'bad_request', p)
  }
  assert.equal(await kind(s.requestIf(call('TRACE', '/api/v1/me'))), 'bad_request')
  assert.deepEqual(m.log, [])
  m.close()
})

test('If-Match rides the request and only that one', async () => {
  const m = await mock((r) => (r.path === '/api/v1/auth/refresh' ? [200, pair('access-2', 'refresh-2')] : r.auth === 'Bearer access-2' ? [200, {}] : [401, {}]))
  const { s } = await signedIn(m.api)
  assert.equal((await s.requestIf(call('PATCH', '/api/v1/admin/users/x', { body: { name: 'A' }, ifMatch: 7 }))).status, 200)
  assert.deepEqual(m.log.filter((r) => r.path.endsWith('users/x')).map((r) => r.ifMatch), ['7'])
  assert.equal((await s.requestIf(call('GET', '/api/v1/admin/users/x'))).status, 200)
  assert.equal(m.log.at(-1)!.ifMatch, '')
  m.close()
})

test('Idempotency-Key rides a JSON call and only a clean one', async () => {
  const m = await mock((r) => (r.path === '/api/v1/auth/refresh' ? [200, pair('access-2', 'refresh-2')] : [201, {}]))
  const { s } = await signedIn(m.api)
  const reply = { body: { body: '<div>x</div>' } }
  const p = '/api/v1/inquiries/x/reply'
  assert.equal((await s.requestIf(call('POST', p, { ...reply, idempotencyKey: 'abc-123' }))).status, 201)
  assert.equal((await s.requestIf(call('POST', p, reply))).status, 201)
  assert.deepEqual(m.log.filter((r) => r.path === p).map((r) => r.idem), ['abc-123', ''])
  const before = m.log.length
  for (const bad of ['a b', 'a\r\nX: y', 'k'.repeat(129)]) assert.equal(await kind(s.requestIf(call('POST', p, { ...reply, idempotencyKey: bad }))), 'bad_request')
  assert.equal(m.log.length, before)
  m.close()
})

test('a null body sends no body and no content-type; a body sends JSON', async () => {
  const m = await mock((r) => (r.path === '/api/v1/auth/refresh' ? [200, pair('a', 'r')] : [200, { ok: 1 }]))
  const { s } = await signedIn(m.api)
  const res = await s.requestIf(call('GET', '/api/v1/me'))
  assert.deepEqual(res, { status: 200, body: { ok: 1 }, refreshed: false })
  await s.requestIf(call('POST', '/api/v1/x', { body: { a: 1 } }))
  const [get, post] = m.log.filter((r) => r.path !== '/api/v1/auth/refresh')
  assert.deepEqual([get!.ct, post!.ct, post!.body], ['', 'application/json', { a: 1 }])
  m.close()
})

test('non-2xx and non-JSON answers come back as data, redirects are not followed', async () => {
  const m = await mock((r) => (r.path === '/api/v1/auth/refresh' ? [200, pair('a', 'r')] : r.path.endsWith('/gone') ? [404, { code: 'not_found' }] : [200, undefined]))
  const { s } = await signedIn(m.api)
  assert.deepEqual(await s.requestIf(call('GET', '/api/v1/gone')), { status: 404, body: { code: 'not_found' }, refreshed: false })
  assert.deepEqual(await s.requestIf(call('GET', '/api/v1/empty')), { status: 200, body: null, refreshed: false })
  m.close()
})

test('unreachable server reports offline; a slow one reports timeout', async () => {
  const { s } = await signedIn('http://127.0.0.1:1')
  assert.equal(await kind(s.requestIf(call('GET', '/api/v1/me'))), 'offline')
  const m = await mock(async (r) => (r.path === '/api/v1/auth/refresh' ? [200, pair('a', 'r')] : (await new Promise((ok) => setTimeout(ok, 400)), [200, {}])))
  const slow = await signedIn(m.api, { requestTimeoutMs: 100 })
  assert.equal(await kind(slow.s.requestIf(call('GET', '/api/v1/me'))), 'timeout')
  m.close()
})

test('health ping needs no sign-in and sends no token', async () => {
  const m = await mock(() => [503, {}])
  const s = new Session(cfg(m.api), new MemoryKeychain())
  assert.equal((await s.requestIf(call('GET', '/health/ready'))).status, 503)
  assert.equal(m.log[0]!.auth, '')
  for (const [mt, p] of [['POST', '/health/ready'], ['GET', '/health'], ['GET', '/health/ready/x']] as const) assert.equal(await kind(s.requestIf(call(mt, p))), 'bad_request', `${mt} ${p}`)
  assert.equal(m.log.length, 1)
  m.close()
})

test('only the provider calls get the long timeout', () => {
  assert.equal(timeoutFor('/api/v1/admin/ai/test', 10_000), 200_000)
  assert.equal(timeoutFor('/api/v1/admin/ai/models', 10_000), 200_000)
  assert.equal(timeoutFor('/api/v1/admin/ai', 10_000), 10_000)
  assert.equal(timeoutFor('/api/v1/me', 10_000), 10_000)
  assert.equal(timeoutFor('/api/v1/admin/ai/test', 300_000), 300_000)
})

test('config: build-time URLs lose the trailing slash; flags come from the environment', () => {
  const dir = mkdtempSync(join(tmpdir(), 'klei-cfg-'))
  writeFileSync(join(dir, 'build-config.json'), JSON.stringify({ api: 'https://api.example/', auth: 'https://auth.example//' }))
  const c = loadConfig(dir, { KLEI_SMOKE: '1' })
  assert.deepEqual([c.api, c.auth, c.smoke, c.loopback], ['https://api.example', 'https://auth.example', true, false])
  assert.deepEqual([c.signInTimeoutMs, c.requestTimeoutMs, c.uploadTimeoutMs, c.retryDelayMs], [300_000, 10_000, 120_000, 3_000])
})

test('api_request under KLEI_SMOKE: first answer is signed_out, then the app exits 0 after 1 s', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const exits: number[] = []
  const handlers = createHandlers({ session: new Session(cfg('http://127.0.0.1:1', { smoke: true }), new MemoryKeychain()), useMemory() {}, exit: (c) => exits.push(c) })
  const args = { request: call('GET', '/api/v1/me') } as never
  assert.equal(await kind(handlers.api_request!(args, { signal: new AbortController().signal, emit() {} } as never)), 'signed_out')
  t.mock.timers.tick(999)
  assert.deepEqual(exits, [])
  t.mock.timers.tick(1)
  assert.deepEqual(exits, [0])
})
