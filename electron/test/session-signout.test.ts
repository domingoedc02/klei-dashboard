import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHandlers } from '../src/main/commands.ts'
import { MemoryKeychain, SwitchKeychain } from '../src/main/keychain.ts'
import { Session } from '../src/main/session.ts'
import { cfg, mock, pair } from './mock-api.ts'

const me = { method: 'GET', path: '/api/v1/me', body: null, ifMatch: null, idempotencyKey: null }
const withToken = async (api: string) => {
  const kc = new MemoryKeychain()
  await kc.store('refresh-0')
  return { s: new Session(cfg(api), kc), kc }
}

test('sign_out revokes on the server and empties the keychain', async () => {
  const m = await mock(() => [204])
  const { s, kc } = await withToken(m.api)
  await s.signOut()
  assert.equal(await kc.load(), null)
  assert.deepEqual([m.log[0]!.method, m.log[0]!.path, m.log[0]!.body], ['POST', '/api/v1/auth/logout', { refreshToken: 'refresh-0' }])
  m.close()
})

test('sign_out works offline', async () => {
  const { s, kc } = await withToken('http://127.0.0.1:1')
  await s.signOut()
  assert.equal(await kc.load(), null)
})

test('sign_out drops the access token: the next call is signed_out and sends nothing authorised', async () => {
  const m = await mock((r) => (r.path === '/api/v1/auth/refresh' ? [200, pair('access-1', 'refresh-1')] : r.path.endsWith('/logout') ? [204] : [200, {}]))
  const { s } = await withToken(m.api)
  assert.equal((await s.requestIf(me)).status, 200)
  await s.signOut()
  await assert.rejects(s.requestIf(me), { kind: 'signed_out' })
  assert.equal(m.log.filter((r) => r.path === '/api/v1/me').length, 1)
  m.close()
})

test('sign_out with a keychain that cannot clear reports keychain_unavailable', async () => {
  const s = new Session(cfg('http://127.0.0.1:1'), new MemoryKeychain(true))
  await assert.rejects(s.signOut(), { kind: 'keychain_unavailable' })
})

test('sign_out with nothing stored sends nothing', async () => {
  const m = await mock(() => [204])
  const s = new Session(cfg(m.api), new MemoryKeychain())
  await s.signOut()
  assert.equal(m.log.length, 0)
  m.close()
})

test('session_only switches the credential store to memory; handlers return null', async () => {
  const stored: string[] = []
  const os = { load: async () => null, store: async (t: string) => void stored.push(t), clear: async () => {} }
  const sw = new SwitchKeychain(os, false)
  const m = await mock(() => [204])
  const handlers = createHandlers({ session: new Session(cfg(m.api), sw), useMemory: () => sw.useMemory(), exit() {} })
  const ctx = { signal: new AbortController().signal, emit() {} } as never
  assert.equal(await handlers.session_only!({} as never, ctx), null)
  await sw.store('after-switch')
  assert.deepEqual(stored, [])
  assert.equal(await handlers.sign_out!({} as never, ctx), null)
  assert.equal(await sw.load(), null)
  m.close()
})
