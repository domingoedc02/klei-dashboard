import assert from 'node:assert/strict'
import { test } from 'node:test'
import { OsKeychain, SwitchKeychain, MemoryKeychain, type Entry } from '../src/main/keychain.ts'
import { KEYCHAIN_SERVICE } from '../src/main/identity.ts'

const fakeOs = () => {
  const calls: string[] = []
  let slot: string | null = null
  const entry: Entry = {
    getPassword: async () => (calls.push('get'), slot),
    setPassword: async (p) => (calls.push('set'), void (slot = p)),
    deletePassword: async () => (calls.push('delete'), slot !== null && ((slot = null), true)),
  }
  return { calls, entry, os: new OsKeychain('svc', async () => entry) }
}

test('memory mode round-trips without the OS and can be switched on', async () => {
  const f = fakeOs()
  const k = new SwitchKeychain(f.os, true)
  assert.equal(await k.load(), null)
  await k.store('r1')
  assert.equal(await k.load(), 'r1')
  await k.clear()
  assert.equal(await k.load(), null)
  assert.deepEqual(f.calls, [])

  const j = new SwitchKeychain(f.os, false)
  await j.store('os-token')
  assert.deepEqual(f.calls, ['set'])
  j.useMemory()
  assert.equal(await j.load(), null)
  await j.store('mem-token')
  assert.equal(await j.load(), 'mem-token')
  assert.deepEqual(f.calls, ['set'])
})

test('OS store: load of a missing entry is null, clear of a missing entry is success', async () => {
  const f = fakeOs()
  assert.equal(await f.os.load(), null)
  await f.os.clear()
  await f.os.store('t')
  assert.equal(await f.os.load(), 't')
  await f.os.clear()
  assert.equal(await f.os.load(), null)
})

test('OS store errors become keychain_unavailable without the OS message or the token', async () => {
  const warn = console.warn
  const seen: string[] = []
  console.warn = (...a: unknown[]) => void seen.push(a.join(' '))
  try {
    const bad = new OsKeychain('svc', async () => ({
      getPassword: async () => { throw new Error('os says no') },
      setPassword: async () => { throw new Error('os says no') },
      deletePassword: async () => { throw new Error('os says no') },
    }))
    for (const f of [() => bad.load(), () => bad.store('SECRET-TOKEN'), () => bad.clear()]) {
      await assert.rejects(f(), { message: 'keychain unavailable' })
    }
    assert.ok(seen.length === 3 && seen.every((l) => !l.includes('SECRET-TOKEN')), seen.join('|'))
    await assert.rejects(new OsKeychain('svc', async () => { throw new Error('no native module') }).load(), { message: 'keychain unavailable' })
  } finally {
    console.warn = warn
  }
})

test('a failed open is retried on the next call', async () => {
  let n = 0
  const f = fakeOs()
  const k = new OsKeychain('svc', async () => { if (++n === 1) throw new Error('locked'); return f.entry })
  await assert.rejects(k.load())
  assert.equal(await k.load(), null)
})

test('the Electron preview never shares the Tauri entry', () => {
  assert.equal(KEYCHAIN_SERVICE, 'co.klei.bridal.electron.preview')
  assert.notEqual(KEYCHAIN_SERVICE, 'co.klei.bridal')
})

test('MemoryKeychain(broken) fails every call', async () => {
  const k = new MemoryKeychain(true)
  await assert.rejects(k.load())
  await assert.rejects(k.store('x'))
  await assert.rejects(k.clear())
})
