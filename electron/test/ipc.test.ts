import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BridgeError } from '../src/shared/errors.ts'
import { COMMANDS } from '../src/shared/commands.ts'
import { frame, loopback, stubHandlers } from './loopback.ts'

// Handler errors are converted, so a tripwire must count runs instead of throwing.
let ran = 0
const tripwire = Object.fromEntries(COMMANDS.map((c) => [c, async () => void ran++])) as never
const afterEach_ = () => { assert.equal(ran, 0, 'a handler ran'); ran = 0 }
const BAD = { err: { kind: 'bad_request', message: 'bad request' } }

test('sender frame must be the main frame of the preview window on app://klei', async () => {
  const wrong = [
    { name: 'no frame', opts: { frame: null } },
    { name: 'sub-frame', opts: { frame: frame({ parent: {} }) } },
    { name: 'foreign origin', opts: { frame: frame({ origin: 'https://evil.example', url: 'https://evil.example/' }) } },
    { name: 'foreign url, right origin string', opts: { frame: frame({ url: 'https://evil.example/' }) } },
    { name: 'app url with other host', opts: { frame: frame({ origin: 'app://klei', url: 'app://other/' }) } },
    { name: 'not the main frame object', opts: { frame: frame() } },
    { name: 'other window', opts: { trusted: false } },
  ]
  for (const { name, opts } of wrong) {
    const { invoker, event, logs } = loopback(tripwire, opts)
    assert.deepEqual(await invoker.invoke(event, 'sign_in', {}, undefined), BAD, name)
    assert.deepEqual(logs, ['untrusted sender'], name)
    afterEach_()
  }
})

test('unknown command, inherited names and non-strings never reach a handler', async () => {
  const { invoker, event, logs } = loopback(tripwire)
  for (const c of ['nope', 'constructor', '__proto__', 'toString', '', 5, null, undefined, {}, ['sign_in']]) assert.deepEqual(await invoker.invoke(event, c, {}, undefined), BAD, String(c))
  assert.equal(logs.length, 10)
  assert.ok(logs.every((l) => l === 'unknown command'))
  afterEach_()
})

test('wrong payloads and extra keys are rejected before the handler, and the log carries no arguments', async () => {
  const { invoker, event, logs } = loopback(tripwire)
  const SECRET = 'secret-token-123'
  assert.deepEqual(await invoker.invoke(event, 'sign_in', { x: SECRET }, undefined), BAD)
  assert.deepEqual(await invoker.invoke(event, 'set_dirty', { dirty: SECRET }, undefined), BAD)
  assert.deepEqual(await invoker.invoke(event, 'api_request', { request: { method: 'GET', path: '/x', evil: SECRET } }, undefined), BAD)
  assert.deepEqual(await invoker.invoke(event, 'api_request', { request: { method: 'GET', path: SECRET.repeat(500) } }, undefined), BAD)
  assert.deepEqual(await invoker.invoke(event, 'export_gowns', { kind: 'start', ids: [SECRET.repeat(5)] }, '11111111-1111-4111-8111-111111111111'), BAD)
  assert.equal(logs.length, 5)
  assert.ok(!logs.join('').includes(SECRET))
  afterEach_()
})

test('event id rules: channel commands need a uuid, plain commands must not carry one, ids are not reusable while live', async () => {
  const { invoker, event } = loopback(stubHandlers({ upload_files: () => new Promise(() => {}) }))
  assert.deepEqual(await invoker.invoke(event, 'upload_files', { kind: 'photo', targetId: 't' }, undefined), BAD)
  assert.deepEqual(await invoker.invoke(event, 'upload_files', { kind: 'photo', targetId: 't' }, 'not-a-uuid'), BAD)
  assert.deepEqual(await invoker.invoke(event, 'sign_in', {}, '11111111-1111-4111-8111-111111111111'), BAD)
  const id = '22222222-2222-4222-8222-222222222222'
  void invoker.invoke(event, 'upload_files', { kind: 'photo', targetId: 't' }, id)
  await new Promise((r) => setTimeout(r, 5))
  assert.deepEqual(await invoker.invoke(event, 'upload_files', { kind: 'photo', targetId: 't' }, id), BAD)
  assert.equal(invoker.liveCalls(), 1)
})

test('non-BridgeError failures become failed/request failed; seeded secrets never reach the page; BridgeError passes through', async () => {
  const SECRETS = ['Bearer abc.def', 'refresh-token-xyz', '/Users/ej/.klei/db', '{"detail":"stack"}', 'at Object.<anonymous>']
  const e = Object.assign(new Error(SECRETS.join(' ')), { kind: 'no_access', body: SECRETS[3], stack: SECRETS[4] })
  const { bridge } = loopback(
    stubHandlers({
      sign_in: () => Promise.reject(e),
      sign_out: () => Promise.reject(SECRETS.join(' ')),
      check_update: () => Promise.reject(new BridgeError('too_large', 'too big')),
      session_only: () => Promise.reject(Object.assign(new BridgeError('failed', 'x'), { kind: 'not_a_kind' })),
    }),
  )
  for (const call of [bridge.sign_in, bridge.sign_out, bridge.session_only]) {
    const err = await call().then(() => assert.fail(), (x) => x)
    assert.deepEqual(err, { kind: 'failed', message: 'request failed' })
    for (const s of SECRETS) assert.ok(!JSON.stringify(err).includes(s))
  }
  assert.deepEqual(await bridge.check_update().then(() => assert.fail(), (x) => x), { kind: 'too_large', message: 'too big' })
})

test('every stub rejects failed / not implemented', async () => {
  const { createHandlers } = await import('../src/main/commands.ts')
  const handlers = createHandlers({ session: {} as never, useMemory() {}, exit() {} })
  assert.deepEqual(Object.keys(handlers).sort(), [...COMMANDS].sort())
  const { bridge } = loopback(handlers)
  assert.deepEqual(await bridge.check_update().then(() => assert.fail(), (x) => x), { kind: 'failed', message: 'not implemented' })
  assert.deepEqual(await bridge.install_update().then(() => assert.fail(), (x) => x), { kind: 'failed', message: 'not implemented' })
})

test('a handler sees validated args and the abort signal; results come back unchanged', async () => {
  let seen: unknown
  const { bridge } = loopback(stubHandlers({ api_request: (a: never) => ((seen = a), Promise.resolve({ status: 200, body: null })) }))
  assert.deepEqual(await bridge.api_request({ method: 'GET', path: '/x' }), { status: 200, body: null })
  assert.deepEqual(seen, { request: { method: 'GET', path: '/x', body: null, ifMatch: null, idempotencyKey: null } })
})

test('channel events: increasing index, one end marker, ordered before the reply; callbacks released', async () => {
  const { bridge, invoker, fs } = loopback(
    stubHandlers({ upload_files: async (_a: never, c: { emit(m: unknown): void }) => (c.emit({ n: 1 }), c.emit({ n: 2 }), { stored: [], rejected: [], cancelled: false }) }),
  )
  const got: unknown[] = []
  await bridge.upload_files('photo', 't', (e: unknown) => got.push(e))
  assert.deepEqual(got, [{ n: 1 }, { n: 2 }])
  assert.deepEqual(fs.sent.map((s) => s.payload), [{ index: 0, message: { n: 1 } }, { index: 1, message: { n: 2 } }, { end: true, index: 2 }])
  assert.equal(invoker.liveCalls(), 0)
  assert.equal([...fs.listeners.values()].reduce((n, s) => n + s.size, 0), 0)
})

test('a handler that fails still gets an end marker', async () => {
  const { bridge, fs } = loopback(stubHandlers({ export_gowns: async () => { throw new BridgeError('too_large', 'big') } }))
  assert.deepEqual(await bridge.export_gowns('start', ['a'], () => {}).then(() => assert.fail(), (x) => x), { kind: 'too_large', message: 'big' })
  assert.deepEqual(fs.sent.map((s) => s.payload), [{ end: true, index: 0 }])
})

test('page reload or close: running calls are aborted like cancel, later events are dropped, ids forgotten', async () => {
  let signal!: AbortSignal
  let emit!: (m: unknown) => void
  let finish!: () => void
  const { invoker, event, fs } = loopback(
    stubHandlers({
      export_gowns: (_a: never, c: { signal: AbortSignal; emit(m: unknown): void }) => {
        signal = c.signal
        emit = c.emit
        return new Promise((r) => (finish = () => r('done')))
      },
    }),
  )
  const id = '33333333-3333-4333-8333-333333333333'
  const p = invoker.invoke(event, 'export_gowns', { kind: 'start', ids: ['a'] }, id)
  await new Promise((r) => setTimeout(r, 5))
  emit('one')
  assert.equal(invoker.liveCalls(), 1)
  invoker.release(fs.sender.id)
  assert.equal(signal.aborted, true)
  assert.equal(invoker.liveCalls(), 0)
  emit('after release')
  finish()
  await p
  assert.deepEqual(fs.sent.map((s) => s.payload), [{ index: 0, message: 'one' }])
})

test('a destroyed sender gets no events and no crash', async () => {
  const { invoker, event, fs } = loopback(stubHandlers({ upload_files: async (_a: never, c: { emit(m: unknown): void }) => (fs.sender.destroyed = true, c.emit('x'), 'ok') }))
  assert.deepEqual(await invoker.invoke(event, 'upload_files', { kind: 'photo', targetId: 't' }, '44444444-4444-4444-8444-444444444444'), { ok: 'ok', ended: true })
  assert.deepEqual(fs.sent, [])
})
