import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MemoryKeychain } from '../src/main/keychain.ts'
import { Session } from '../src/main/session.ts'
import { cfg, mock, pair } from './mock-api.ts'

const get = (path = '/api/v1/me') => ({ method: 'GET', path, body: null, ifMatch: null, idempotencyKey: null })
const kind = (p: Promise<unknown>) => p.then(() => assert.fail('resolved'), (e: { kind: string }) => e.kind)
const withToken = (api: string, rt = 'refresh-0') => {
  const kc = new MemoryKeychain()
  kc.store(rt)
  return { s: new Session(cfg(api), kc), kc }
}
const REFRESH = '/api/v1/auth/refresh'

test('no stored refresh token: signed_out, nothing sent', async () => {
  const m = await mock(() => [200, {}])
  const s = new Session(cfg(m.api), new MemoryKeychain())
  assert.equal(await kind(s.requestIf(get())), 'signed_out')
  assert.equal(m.log.length, 0)
  m.close()
})

test('unusable keychain fails closed: keychain_unavailable, nothing sent', async () => {
  const m = await mock(() => [200, pair('a', 'r')])
  const s = new Session(cfg(m.api), new MemoryKeychain(true))
  assert.equal(await kind(s.requestIf(get())), 'keychain_unavailable')
  assert.equal(m.log.length, 0)
  m.close()
})

test('concurrent requests share one refresh', async () => {
  const m = await mock(async (r) => {
    if (r.path === REFRESH) return await new Promise((ok) => setTimeout(() => ok([200, pair('access-1', 'refresh-1')]), 100))
    return r.auth === 'Bearer access-1' ? [200, { name: 'Ada' }] : [401, { code: 'unauthenticated' }]
  })
  const { s, kc } = withToken(m.api)
  const all = await Promise.all([1, 2, 3, 4, 5].map(() => s.requestIf(get())))
  for (const r of all) assert.deepEqual([r.status, (r.body as { name: string }).name], [200, 'Ada'])
  assert.equal(m.count(REFRESH), 1)
  assert.equal(kc.load(), 'refresh-1')
  m.close()
})

test('stale token refreshes once and retries once; the next call does not report refreshed', async () => {
  const m = await mock((r, n) => {
    if (r.path === REFRESH) return n === 1 ? [200, pair('access-1', 'refresh-1')] : [200, pair('access-2', 'refresh-2')]
    return r.auth === 'Bearer access-2' ? [200, { ok: true }] : [401, { code: 'token_stale' }]
  })
  const { s, kc } = withToken(m.api)
  const first = await s.requestIf(get())
  assert.deepEqual([first.status, first.refreshed], [200, true])
  assert.equal(m.count(REFRESH), 2)
  assert.equal(m.count('/api/v1/me'), 2)
  assert.equal(kc.load(), 'refresh-2')
  assert.equal((await s.requestIf(get())).refreshed, false)
  m.close()
})

test('a caller whose rejected token is already replaced skips the refresh', async () => {
  // call A is slow and holds access-1; B refreshes to access-2 meanwhile; A's 401 on access-1 must reuse access-2.
  const m = await mock(async (r, n) => {
    if (r.path === REFRESH) return n === 1 ? [200, pair('access-1', 'refresh-1')] : [200, pair('access-2', 'refresh-2')]
    if (r.path === '/api/v1/a' && r.auth === 'Bearer access-1') await new Promise((ok) => setTimeout(ok, 200))
    return r.auth === 'Bearer access-2' ? [200, {}] : [401, {}]
  })
  const { s } = withToken(m.api)
  const a = s.requestIf(get('/api/v1/a'))
  await new Promise((ok) => setTimeout(ok, 50))
  const b = await s.requestIf(get('/api/v1/b'))
  assert.equal(b.refreshed, true)
  assert.equal((await a).refreshed, true)
  assert.equal(m.count(REFRESH), 2)
  m.close()
})

test('second 401 after a refresh ends the session', async () => {
  const m = await mock((r) => (r.path === REFRESH ? [200, pair('a', 'r')] : [401, {}]))
  const { s, kc } = withToken(m.api)
  assert.equal(await kind(s.requestIf(get())), 'session_expired')
  assert.equal(kc.load(), null)
  assert.equal(await kind(s.requestIf(get())), 'signed_out')
  m.close()
})

test('refused refresh (401) ends the session and clears the keychain', async () => {
  const m = await mock(() => [401, { code: 'unauthenticated' }])
  const { s, kc } = withToken(m.api)
  assert.equal(await kind(s.requestIf(get())), 'session_expired')
  assert.equal(kc.load(), null)
  assert.equal(await kind(s.requestIf(get())), 'signed_out')
  m.close()
})

test('refresh refused for a role without permissions reports no_access and clears', async () => {
  const m = await mock((r) => (r.path === REFRESH ? [403, { code: 'forbidden' }] : [401, {}]))
  const { s, kc } = withToken(m.api)
  assert.equal(await kind(s.requestIf(get())), 'no_access')
  assert.equal(kc.load(), null)
  m.close()
})

test('any other refresh status is failed "refresh failed" and keeps the stored token', async () => {
  const m = await mock(() => [503, {}])
  const { s, kc } = withToken(m.api)
  await assert.rejects(s.requestIf(get()), { kind: 'failed', message: 'refresh failed' })
  assert.equal(kc.load(), 'refresh-0')
  m.close()
})

test('malformed token response: failed "bad token response", nothing stored', async () => {
  for (const body of [{}, { accessToken: 'a' }, { accessToken: '', refreshToken: 'r' }, { accessToken: 1, refreshToken: 'r' }, null]) {
    const m = await mock(() => [200, body])
    const { s, kc } = withToken(m.api)
    await assert.rejects(s.requestIf(get()), { kind: 'failed', message: 'bad token response' })
    assert.equal(kc.load(), 'refresh-0', JSON.stringify(body))
    assert.equal(m.count('/api/v1/me'), 0)
    m.close()
  }
})

test('keychain refusing the new refresh token keeps no access token (fail closed)', async () => {
  const m = await mock((r) => (r.path === REFRESH ? [200, pair('access-1', 'refresh-1')] : [200, {}]))
  const kc = new MemoryKeychain()
  kc.store('refresh-0')
  kc.store = () => { throw new Error('denied') }
  const s = new Session(cfg(m.api), kc)
  assert.equal(await kind(s.requestIf(get())), 'keychain_unavailable')
  assert.equal(m.count('/api/v1/me'), 0)
  assert.equal(await kind(s.requestIf(get())), 'keychain_unavailable')
  assert.equal(m.count(REFRESH), 2)
  m.close()
})

test('tokens never appear in an error', async () => {
  const m = await mock(() => [503, { accessToken: 'SECRET-A', refreshToken: 'SECRET-R' }])
  const { s } = withToken(m.api, 'SECRET-STORED')
  const e = await s.requestIf(get()).then(() => null, (x) => x)
  assert.ok(!JSON.stringify({ k: e.kind, m: e.message }).includes('SECRET'))
  m.close()
})
