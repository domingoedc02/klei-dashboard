import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHandlers } from '../src/main/commands.ts'
import { challengeFor, type StartRedirect } from '../src/main/auth.ts'
import { MemoryKeychain } from '../src/main/keychain.ts'
import { Session } from '../src/main/session.ts'
import { cfg, mock, pair } from './mock-api.ts'

/** A fake browser and redirect: `opened` resolves with the authorize URL; `callback(url)` is what the redirect hands to the session. */
const rig = (api: string, kc = new MemoryKeychain(), over = {}) => {
  let resolveOpened!: (u: URL) => void
  let opened = new Promise<URL>((ok) => (resolveOpened = ok))
  let callback!: (url: URL) => Promise<void>
  let stopped = 0
  const redirect: StartRedirect = async (complete) => {
    callback = complete
    return { uri: 'http://127.0.0.1:50000/callback', stop: () => void stopped++ }
  }
  const s = new Session(cfg(api, over), kc, { open: (u) => resolveOpened(new URL(u)), redirect })
  return { s, kc, next: () => opened, again: () => void (opened = new Promise<URL>((ok) => (resolveOpened = ok))), cb: (u: URL) => callback(u), stopped: () => stopped }
}
const back = (authorize: URL, q: Record<string, string | undefined>) => new URL(`${authorize.searchParams.get('redirect')}?${new URLSearchParams(Object.entries(q).flatMap(([k, v]) => (v === undefined ? [] : [[k, v]])))}`)
const kind = (p: Promise<unknown>) => p.then(() => assert.fail('resolved'), (e: { kind: string }) => e.kind)

test('sign_in opens the authorize URL, exchanges the code, and stores only the refresh token', async () => {
  const m = await mock(() => [200, pair('access-1', 'refresh-1')])
  const r = rig(m.api)
  const waiting = r.s.signIn()
  const a = await r.next()
  assert.equal(a.origin + a.pathname, 'http://127.0.0.1:1/authorize')
  assert.equal(a.searchParams.get('client'), 'desktop')
  assert.equal(a.searchParams.get('challenge')!.length, 43)
  assert.equal(a.searchParams.get('redirect'), 'http://127.0.0.1:50000/callback')
  await r.cb(back(a, { code: 'abc', state: a.searchParams.get('state')! }))
  await waiting
  assert.equal(await r.kc.load(), 'refresh-1')
  const ex = m.log[0]!
  assert.deepEqual([ex.method, ex.path, (ex.body as { code: string }).code], ['POST', '/api/v1/auth/token', 'abc'])
  assert.equal(challengeFor((ex.body as { verifier: string }).verifier), a.searchParams.get('challenge'))
  assert.equal(ex.auth, '')
  assert.equal(r.stopped(), 1)
  // the access token is in memory: the next call needs no refresh
  const me = await r.s.requestIf({ method: 'GET', path: '/api/v1/me', body: null, ifMatch: null, idempotencyKey: null })
  assert.equal(m.log.at(-1)!.auth, 'Bearer access-1')
  assert.equal(me.refreshed, false)
  m.close()
})

test('a wrong state is refused without calling the backend', async () => {
  const m = await mock(() => [200, pair('a', 'r')])
  const r = rig(m.api)
  const waiting = r.s.signIn()
  const a = await r.next()
  await assert.rejects(r.cb(back(a, { code: 'abc', state: 'not-the-state' })), { message: 'state mismatch' })
  assert.equal(await kind(waiting), 'failed')
  assert.equal(m.log.length, 0)
  assert.equal(await r.kc.load(), null)
  m.close()
})

test('a missing or empty code fails "no code"', async () => {
  const m = await mock(() => [200, pair('a', 'r')])
  for (const q of [{ code: undefined }, { code: '' }]) {
    const r = rig(m.api)
    const waiting = r.s.signIn()
    const a = await r.next()
    await assert.rejects(r.cb(back(a, { ...q, state: a.searchParams.get('state')! })), { kind: 'failed', message: 'no code' })
    await kind(waiting)
  }
  assert.equal(m.log.length, 0)
  m.close()
})

test('a rejected code stores nothing', async () => {
  const m = await mock(() => [400, { code: 'bad_request' }])
  const r = rig(m.api)
  const waiting = r.s.signIn()
  const a = await r.next()
  await assert.rejects(r.cb(back(a, { code: 'old', state: a.searchParams.get('state')! })), { kind: 'failed', message: 'code rejected' })
  assert.equal(await kind(waiting), 'failed')
  assert.equal(await r.kc.load(), null)
  m.close()
})

test('a callback is one attempt: a second one finds no sign-in in progress', async () => {
  const m = await mock(() => [400, {}])
  const r = rig(m.api)
  const waiting = r.s.signIn()
  const a = await r.next()
  const url = back(a, { code: 'x', state: a.searchParams.get('state')! })
  await assert.rejects(r.cb(url))
  await assert.rejects(r.cb(url), { kind: 'failed', message: 'no sign-in in progress' })
  await kind(waiting)
  assert.equal(m.log.length, 1)
  m.close()
})

test('a malformed token response stores nothing', async () => {
  const m = await mock(() => [200, { accessToken: 'a' }])
  const r = rig(m.api)
  const waiting = r.s.signIn()
  const a = await r.next()
  await assert.rejects(r.cb(back(a, { code: 'x', state: a.searchParams.get('state')! })), { message: 'bad token response' })
  await kind(waiting)
  assert.equal(await r.kc.load(), null)
  m.close()
})

test('sign_in times out and clears its pending state', async () => {
  const r = rig('http://127.0.0.1:1', new MemoryKeychain(), { signInTimeoutMs: 80 })
  const waiting = r.s.signIn()
  const a = await r.next()
  await assert.rejects(waiting, { kind: 'timeout', message: 'sign-in timed out' })
  await assert.rejects(r.cb(back(a, { code: 'x', state: a.searchParams.get('state')! })), { message: 'no sign-in in progress' })
  assert.equal(r.stopped(), 1)
})

test('a second sign_in cancels the first; the first state is dead, the second completes', async () => {
  const m = await mock(() => [200, pair('a', 'r1')])
  const r = rig(m.api)
  const first = r.s.signIn()
  const a1 = await r.next()
  r.again()
  const second = r.s.signIn()
  const a2 = await r.next()
  assert.equal(await kind(first), 'cancelled')
  assert.notEqual(a1.searchParams.get('state'), a2.searchParams.get('state'))
  await r.cb(back(a2, { code: 'x', state: a2.searchParams.get('state')! }))
  await second
  assert.equal(await r.kc.load(), 'r1')
  m.close()
})

test('sign_out cancels a pending sign_in', async () => {
  const m = await mock(() => [204])
  const r = rig(m.api)
  const waiting = r.s.signIn()
  await r.next()
  await r.s.signOut()
  assert.equal(await kind(waiting), 'cancelled')
  m.close()
})

test('an unusable keychain fails sign_in closed, before the browser opens', async () => {
  let opened = 0
  const s = new Session(cfg('http://127.0.0.1:1'), new MemoryKeychain(true), { open: () => void opened++ })
  assert.equal(await kind(s.signIn()), 'keychain_unavailable')
  assert.equal(opened, 0)
})

test('the sign_in handler resolves null on success', async () => {
  const m = await mock(() => [200, pair('a', 'r')])
  const r = rig(m.api)
  const h = createHandlers({ session: r.s, useMemory() {}, exit() {} })
  const call = h.sign_in!({} as never, { signal: new AbortController().signal, emit() {} } as never)
  const a = await r.next()
  await r.cb(back(a, { code: 'x', state: a.searchParams.get('state')! }))
  assert.equal(await call, null)
  m.close()
})
