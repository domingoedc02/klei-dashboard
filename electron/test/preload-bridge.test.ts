import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createBridge, type Ipc } from '../src/preload/bridge.ts'
import { COMMANDS } from '../src/shared/commands.ts'
import { KINDS } from '../src/shared/errors.ts'
import { loopback, stubHandlers } from './loopback.ts'

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const rejection = async (p: Promise<unknown>) => p.then(() => assert.fail('resolved'), (e: unknown) => e)

// A preload fed by hand: `invoke` answers what the test says, `emit` plays main's event messages.
function manual(answer: (id: string) => Promise<unknown>) {
  const ls = new Map<string, (e: unknown, p: unknown) => void>()
  const ipc: Ipc = {
    invoke: (_c, _cmd, _a, id) => answer(id as string),
    on: (c, l) => void ls.set(c, l),
    removeListener: (c, l) => void (ls.get(c) === l && ls.delete(c)),
  }
  let n = 0
  return { bridge: createBridge(ipc, () => `id-${++n}`), emit: (id: string, p: unknown) => ls.get(`klei:ev:${id}`)?.({}, p), ls }
}

test('exposes exactly the nine methods, nothing else', () => {
  const { bridge } = loopback(stubHandlers())
  assert.deepEqual(Object.keys(bridge).sort(), [...COMMANDS].sort())
  for (const v of Object.values(bridge)) assert.equal(typeof v, 'function')
})

test('a rejection reaches the page as a plain { kind, message }, never an Error', async () => {
  const { bridge } = loopback(stubHandlers({ sign_in: () => Promise.reject(new Error('token=SECRET at /Users/x/file.ts:1')) }))
  const e = await rejection(bridge.sign_in())
  assert.deepEqual(e, { kind: 'failed', message: 'request failed' })
  assert.ok(!(e instanceof Error))
  assert.ok((KINDS as readonly string[]).includes((e as { kind: string }).kind))
})

test('a garbled or missing envelope becomes failed, and an ipc fault never leaks its text', async () => {
  const bad = { invoke: () => Promise.resolve({ err: { kind: 'bogus', message: 'x' } }), on() {}, removeListener() {} }
  assert.deepEqual(await rejection(createBridge(bad).sign_in()), { kind: 'failed', message: 'request failed' })
  const none = { invoke: () => Promise.resolve(undefined), on() {}, removeListener() {} }
  assert.deepEqual(await rejection(createBridge(none).sign_in()), { kind: 'failed', message: 'request failed' })
  const boom = { invoke: () => Promise.reject(new Error('/secret/path')), on() {}, removeListener() {} }
  assert.deepEqual(await rejection(createBridge(boom).sign_in()), { kind: 'failed', message: 'request failed' })
})

test('extra keys, wrong types and oversize fail bad_request before ipc is touched', async () => {
  const { bridge, calls } = loopback(stubHandlers())
  const cases: (() => Promise<unknown>)[] = [
    () => bridge.api_request({ method: 'GET', path: '/x', extra: 1 }),
    () => bridge.api_request({ method: 5, path: '/x' }),
    () => bridge.api_request({ method: 'GET', path: 'x'.repeat(2049) }),
    () => bridge.api_request({ method: 'GET', path: '/x', idempotencyKey: 'k'.repeat(129) }),
    () => bridge.api_request({ method: 'GET', path: '/x', ifMatch: -1 }),
    () => bridge.api_request({ method: 'GET', path: '/x', ifMatch: 1.5 }),
    () => bridge.api_request(null),
    () => bridge.api_request([]),
    () => bridge.set_dirty('yes'),
    () => bridge.upload_files('bogus', 't', () => {}),
    () => bridge.upload_files('photo', 5, () => {}),
    () => bridge.upload_files('photo', 't', 'not a function'),
    () => bridge.export_gowns('start', Array.from({ length: 1001 }, () => 'a'), () => {}),
    () => bridge.export_gowns('start', ['a'.repeat(65)], () => {}),
    () => bridge.export_gowns('start', 'a', () => {}),
    () => bridge.export_gowns('start', [1], () => {}),
  ]
  for (const [i, c] of cases.entries()) assert.deepEqual(await rejection(c()), { kind: 'bad_request', message: 'bad request' }, `case ${i}`)
  assert.equal(calls.length, 0)
})

test('events arrive in index order, then the call settles after the end marker', async () => {
  const m = manual(async (id) => {
    m.emit(id, { index: 2, message: 'c' })
    m.emit(id, { index: 0, message: 'a' })
    m.emit(id, { end: true, index: 3 })
    m.emit(id, { index: 1, message: 'b' })
    return { ok: 'done', ended: true }
  })
  const got: unknown[] = []
  assert.equal(await m.bridge.upload_files('photo', 't', (e: unknown) => got.push(e)), 'done')
  assert.deepEqual(got, ['a', 'b', 'c'])
})

test('the call waits for a late end marker; listener is released; later events are dropped', async () => {
  const m = manual(async () => ({ ok: 1, ended: true }))
  const got: unknown[] = []
  let settled = false
  const p = m.bridge.export_gowns('start', ['a'], (e: unknown) => got.push(e)).then(() => (settled = true))
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(settled, false, 'must wait for the end marker')
  m.emit('id-1', { index: 0, message: 'x' })
  m.emit('id-1', { end: true, index: 1 })
  await p
  m.emit('id-1', { index: 1, message: 'late' })
  assert.deepEqual(got, ['x'])
  assert.equal(m.ls.size, 0, 'callback table empty')
})

test('a rejected channel call still waits for its end marker, then rejects; a throwing callback does not break it', async () => {
  const m = manual(async (id) => {
    m.emit(id, { index: 0, message: 'a' })
    m.emit(id, { end: true, index: 1 })
    return { err: { kind: 'cancelled', message: 'cancelled' }, ended: true }
  })
  assert.deepEqual(await rejection(m.bridge.upload_files('photo', 't', () => { throw new Error('page bug') })), { kind: 'cancelled', message: 'cancelled' })
  assert.equal(m.ls.size, 0)
})

test('a channel call main rejected before running (no end marker) does not hang', async () => {
  const m = manual(async () => ({ err: { kind: 'bad_request', message: 'bad request' } }))
  assert.deepEqual(await rejection(m.bridge.upload_files('photo', 't', () => {})), { kind: 'bad_request', message: 'bad request' })
  assert.equal(m.ls.size, 0)
})

test('event ids are never reused within a bridge', async () => {
  const seen: string[] = []
  const ipc: Ipc = { invoke: async (_c, _m, _a, id) => (seen.push(id as string), { ok: 1 }), on() {}, removeListener() {} }
  const b = createBridge(ipc)
  for (let i = 0; i < 50; i++) await b.upload_files('cancel', 't', () => {})
  assert.equal(new Set(seen).size, 50)
  assert.ok(seen.every((s) => /^[0-9a-f-]{36}$/.test(s)))
})

test('preload source imports only electron and local files, and uses ipcRenderer.invoke/on/removeListener only', () => {
  for (const f of ['../src/preload/bridge.ts', '../src/preload/index.ts', '../src/shared/commands.ts', '../src/shared/errors.ts', '../src/shared/events.ts']) {
    const text = readFileSync(path(f), 'utf8')
    for (const m of text.matchAll(/(?:from|import)\s+'([^']+)'/g)) assert.ok(m[1] === 'electron' || m[1]!.startsWith('./') || m[1]!.startsWith('../'), `${f}: ${m[1]}`)
    assert.ok(!/\brequire\(|process\.|ipcRenderer\.(send|sendSync|postMessage|sendTo|sendToHost)/.test(text), f)
  }
  const index = readFileSync(path('../src/preload/index.ts'), 'utf8')
  assert.match(index, /exposeInMainWorld\(\s*'klei'/)
  assert.equal(index.match(/exposeInMainWorld/g)?.length, 1)
})
