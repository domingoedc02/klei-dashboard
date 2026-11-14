import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHandlers } from '../src/main/commands.ts'
import { MemoryKeychain } from '../src/main/keychain.ts'
import { Session } from '../src/main/session.ts'
import { cfg } from './mock-api.ts'
import { loopback } from './loopback.ts'

const rig = () => {
  const session = new Session(cfg('http://127.0.0.1:1'), new MemoryKeychain())
  return { session, ...loopback(createHandlers({ session, useMemory() {}, exit() {} })) }
}

test('the dirty flag round-trips through set_dirty and one accessor', async () => {
  const { session, bridge } = rig()
  assert.equal(session.isDirty(), false)
  assert.equal(await bridge.set_dirty(true), null)
  assert.equal(session.isDirty(), true)
  assert.equal(await bridge.set_dirty(false), null)
  assert.equal(session.isDirty(), false)
})

test('a non-boolean is bad_request and leaves the flag alone', async () => {
  const { session, bridge } = rig()
  await bridge.set_dirty(true)
  for (const bad of ['true', 1, 0, null, undefined, {}, []]) {
    await assert.rejects(bridge.set_dirty(bad as never), { kind: 'bad_request', message: 'bad request' }, String(bad))
  }
  assert.equal(session.isDirty(), true)
})

test('the flag is process state: a new bridge on the same session (a reload) sees it unchanged', async () => {
  const session = new Session(cfg('http://127.0.0.1:1'), new MemoryKeychain())
  const handlers = createHandlers({ session, useMemory() {}, exit() {} })
  await loopback(handlers).bridge.set_dirty(true)
  assert.equal(session.isDirty(), true)
  const afterReload = loopback(handlers)
  assert.equal(session.isDirty(), true)
  await afterReload.bridge.set_dirty(false)
  assert.equal(session.isDirty(), false)
})
