import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { test } from 'node:test'
import { createHandlers } from '../src/main/commands.ts'
import { MemoryKeychain } from '../src/main/keychain.ts'
import { Session } from '../src/main/session.ts'
import { attachFiles, keyFor, run, setAvatar, triage, Uploader, type Picked } from '../src/main/uploads.ts'
import { cfg, mock, pair, type Reply, type Req } from './mock-api.ts'

const BATCH = '0b1c2d3e-0000-4000-8000-000000000001'
const PHOTOS = `/api/v1/uploads/${BATCH}/photos`
const id = (n: number) => `0b1c2d3e-0000-4000-8000-${String(n).padStart(12, '0')}`
const stored = (n = 1): Reply => [201, { id: id(n) }]
const has = (r: Req, name: string) => r.raw.includes(`filename="${name}"`)

const shared = (r: Req, held: string[] = []): Reply | null =>
  r.path === '/api/v1/auth/refresh' ? [200, pair('access-1', 'refresh-1')]
    : r.path === '/api/v1/uploads/current' ? [200, { id: BATCH, phase: 'empty', photoIds: held, rejected: 0 }]
      : null

async function signedIn(api: string, over: Parameters<typeof cfg>[1] = {}) {
  const kc = new MemoryKeychain()
  await kc.store('refresh-0')
  return new Session(cfg(api, over), kc)
}

function folder(files: [string, number][]) {
  const dir = mkdtempSync(join(tmpdir(), 'klei-up-'))
  for (const [name, len] of files) writeFileSync(join(dir, name), Buffer.alloc(len, 7))
  return { paths: (...names: string[]) => names.map((n) => join(dir, n)), done: () => rmSync(dir, { recursive: true, force: true }) }
}

const collect = () => {
  const seen: { done: number; total: number; waiting: boolean; photoId: string | null }[] = []
  return { seen, emit: (p: { type: 'progress' } & (typeof seen)[number]) => void seen.push(p) }
}
const live = () => new AbortController().signal

test('a file goes as multipart part "file" with the bearer and a 32-char key', async () => {
  const m = await mock((r) => shared(r) ?? stored())
  const f = folder([['gown.jpg', 40]])
  const { seen, emit } = collect()
  const out = await run(await signedIn(m.api), BATCH, f.paths('gown.jpg'), live(), emit)
  assert.equal(out.stored.length, 1)
  assert.deepEqual([out.rejected, out.cancelled], [[], false])
  const sent = m.log.filter((r) => r.path === PHOTOS)
  assert.equal(sent.length, 1)
  assert.equal(sent[0]!.auth, 'Bearer access-1')
  assert.match(sent[0]!.idem, /^[0-9a-f]{32}$/)
  assert.match(sent[0]!.ct, /^multipart\/form-data/)
  assert.ok(has(sent[0]!, 'gown.jpg') && sent[0]!.raw.includes('name="file"'))
  const last = seen.at(-1)!
  assert.deepEqual([last.done, last.total, last.waiting, last.photoId], [1, 1, false, id(1)])
  m.close(); f.done()
})

test('a lost answer is resent with the same key and the screen is told it waits', async () => {
  const m = await mock((r, n) => shared(r) ?? (n === 1 ? 'close' : stored()))
  const f = folder([['a.png', 10]])
  const { seen, emit } = collect()
  const out = await run(await signedIn(m.api), BATCH, f.paths('a.png'), live(), emit)
  assert.equal(out.stored.length, 1)
  const sent = m.log.filter((r) => r.path === PHOTOS)
  assert.equal(sent.length, 2)
  assert.equal(sent[0]!.idem, sent[1]!.idem)
  assert.ok(seen.some((p) => p.waiting))
  m.close(); f.done()
})

test('a held answer past the upload timeout is resent with the same key', async () => {
  const m = await mock(async (r, n) => {
    const s = shared(r)
    if (s) return s
    if (n === 1) await sleep(400)
    return stored()
  })
  const f = folder([['a.png', 10]])
  const out = await run(await signedIn(m.api, { uploadTimeoutMs: 150 }), BATCH, f.paths('a.png'), live(), () => {})
  assert.equal(out.stored.length, 1)
  const sent = m.log.filter((r) => r.path === PHOTOS)
  assert.equal(sent[0]!.idem, sent[1]!.idem)
  m.close(); f.done()
})

test('a busy server (503) is waited for', async () => {
  const m = await mock((r, n) => shared(r) ?? (n === 1 ? [503, {}] : stored()))
  const f = folder([['a.webp', 10]])
  const out = await run(await signedIn(m.api), BATCH, f.paths('a.webp'), live(), () => {})
  assert.equal(out.stored.length, 1)
  assert.equal(m.count(PHOTOS), 2)
  m.close(); f.done()
})

test('at most three files are in flight', async () => {
  let open = 0
  let peak = 0
  const m = await mock(async (r, n) => {
    const s = shared(r)
    if (s) return s
    peak = Math.max(peak, ++open)
    await sleep(150)
    open--
    return stored(n)
  })
  const names = ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg', '7.jpg']
  const f = folder(names.map((n) => [n, 5]))
  const out = await run(await signedIn(m.api), BATCH, f.paths(...names), live(), () => {})
  assert.equal(out.stored.length, 7)
  assert.equal(peak, 3)
  m.close(); f.done()
})

test('server refusals become reasons and the rest carry on; .txt is refused before sending', async () => {
  const m = await mock((r) => shared(r) ?? (has(r, 'fake.png') ? [415, { code: 'unsupported_type' }] : has(r, 'huge.png') ? [413, { code: 'too_large' }] : stored()))
  const f = folder([['ok.jpg', 5], ['fake.png', 5], ['huge.png', 5], ['note.txt', 5]])
  const out = await run(await signedIn(m.api), BATCH, f.paths('ok.jpg', 'fake.png', 'huge.png', 'note.txt'), live(), () => {})
  assert.equal(out.stored.length, 1)
  assert.deepEqual(out.rejected.map((r) => [r.name, r.reason]).sort(), [['fake.png', 'type'], ['huge.png', 'dimensions'], ['note.txt', 'type']])
  assert.equal(m.log.filter((r) => r.path === PHOTOS && has(r, 'note.txt')).length, 0)
  m.close(); f.done()
})

test('a 413 with a limit means the batch is full: that file and every later one are "full", and no more are sent', async () => {
  const m = await mock((r) => shared(r) ?? [413, { code: 'too_large', extensions: { limit: 5 } }])
  const names = Array.from({ length: 8 }, (_, i) => `${i}.jpg`)
  const f = folder(names.map((n) => [n, 5]))
  const out = await run(await signedIn(m.api), BATCH, f.paths(...names), live(), () => {})
  assert.equal(out.stored.length, 0)
  assert.deepEqual(out.rejected.map((r) => r.reason), Array(8).fill('full'))
  assert.ok(m.count(PHOTOS) <= 3, `sent ${m.count(PHOTOS)}`)
  m.close(); f.done()
})

test('a batch with 250 photos already stored still takes more', async () => {
  const held = Array.from({ length: 250 }, (_, i) => id(i))
  const m = await mock((r) => shared(r, held) ?? stored(500))
  const f = folder([['a.jpg', 5], ['b.jpg', 5]])
  const out = await run(await signedIn(m.api), BATCH, f.paths('a.jpg', 'b.jpg'), live(), () => {})
  assert.equal(out.stored.length, 2)
  assert.deepEqual(out.rejected, [])
  m.close(); f.done()
})

test('triage order is type, then size; stat errors and folders', async () => {
  const p = (path: string, len: number): Picked => ({ path, len, mtimeNs: 1n })
  const big = 25 * 1024 * 1024 + 1
  const { send, refused } = triage([p('/x/A.JPG', 1), p('/x/b.txt', big), p('/x/c.png', big), p('/x/d.png', 1), p('/x/e.jpeg', 1)])
  assert.deepEqual(send.map((s) => s.path), ['/x/A.JPG', '/x/d.png', '/x/e.jpeg'])
  assert.deepEqual(refused, [{ name: 'b.txt', reason: 'type' }, { name: 'c.png', reason: 'size' }])
  const f = folder([['a.jpg', 5]])
  const m = await mock((r) => shared(r) ?? stored())
  const out = await run(await signedIn(m.api), BATCH, [...f.paths('a.jpg'), join(tmpdir()), '/nope/gone.jpg'], live(), () => {})
  assert.deepEqual(out.rejected, [{ name: 'gone.jpg', reason: 'unreadable' }])
  assert.equal(out.stored.length, 1)
  m.close(); f.done()
})

test('the key is stable per batch, path, size and modified time', () => {
  const p: Picked = { path: '/x/a.jpg', len: 5, mtimeNs: 7n }
  const k = keyFor(BATCH, p)
  assert.match(k, /^[0-9a-f]{32}$/)
  assert.equal(keyFor(BATCH, { ...p }), k)
  for (const other of [keyFor('other', p), keyFor(BATCH, { ...p, len: 6 }), keyFor(BATCH, { ...p, mtimeNs: 8n }), keyFor(BATCH, { ...p, path: '/y/a.jpg' })]) assert.notEqual(other, k)
})

test('the key survives a restart: same file twice gives the same key on the wire', async () => {
  const m = await mock((r) => shared(r) ?? stored())
  const f = folder([['a.jpg', 5]])
  utimesSync(f.paths('a.jpg')[0]!, 1_700_000_000, 1_700_000_000)
  const s = await signedIn(m.api)
  await run(s, BATCH, f.paths('a.jpg'), live(), () => {})
  await run(await signedIn(m.api), BATCH, f.paths('a.jpg'), live(), () => {})
  const keys = m.log.filter((r) => r.path === PHOTOS).map((r) => r.idem)
  assert.equal(keys.length, 2)
  assert.equal(keys[0], keys[1])
  m.close(); f.done()
})

test('another batch is refused before any file is read or sent', async () => {
  const m = await mock((r) => shared(r) ?? stored())
  await assert.rejects(run(await signedIn(m.api), '0b1c2d3e-0000-4000-8000-0000000000ff', ['/nope/a.jpg'], live(), () => {}), { kind: 'bad_request', message: 'not the current batch' })
  assert.equal(m.count(PHOTOS), 0)
  m.close()
})

test('preflight answers: 403 is no_access, 500 or junk is "no upload batch"', async () => {
  for (const [reply, want] of [[[403, {}], { kind: 'no_access' }], [[500, {}], { kind: 'failed', message: 'no upload batch' }], [[200, 'junk'], { kind: 'failed', message: 'no upload batch' }]] as const) {
    const m = await mock((r) => (r.path === '/api/v1/uploads/current' ? (reply as unknown as Reply) : shared(r) ?? stored()))
    await assert.rejects(run(await signedIn(m.api), BATCH, ['/x/a.jpg'], live(), () => {}), want)
    assert.equal(m.count(PHOTOS), 0)
    m.close()
  }
})

test('403 on a file is fatal: no_access, queue dropped', async () => {
  const m = await mock((r) => shared(r) ?? [403, {}])
  const f = folder([['1.jpg', 5], ['2.jpg', 5], ['3.jpg', 5], ['4.jpg', 5], ['5.jpg', 5]])
  await assert.rejects(run(await signedIn(m.api), BATCH, f.paths('1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg'), live(), () => {}), { kind: 'no_access' })
  assert.ok(m.count(PHOTOS) <= 3)
  m.close(); f.done()
})

test('an unexpected status is fatal "upload failed"; a bad answer body is "bad upload answer"', async () => {
  const f = folder([['a.jpg', 5]])
  let m = await mock((r) => shared(r) ?? [500, {}])
  await assert.rejects(run(await signedIn(m.api), BATCH, f.paths('a.jpg'), live(), () => {}), { kind: 'failed', message: 'upload failed' })
  m.close()
  m = await mock((r) => shared(r) ?? [201, { nope: 1 }])
  await assert.rejects(run(await signedIn(m.api), BATCH, f.paths('a.jpg'), live(), () => {}), { kind: 'failed', message: 'bad upload answer' })
  m.close(); f.done()
})

test('cancel stops the queue and keeps what is stored, without waiting for held answers', async () => {
  const m = await mock(async (r, n) => {
    const s = shared(r)
    if (s) return s
    await sleep(1000)
    return stored(n)
  })
  const names = ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg']
  const f = folder(names.map((n) => [n, 5]))
  const u = new Uploader()
  const slot = u.begin()
  setTimeout(() => u.cancel(), 300)
  const began = Date.now()
  const out = await run(await signedIn(m.api, { uploadTimeoutMs: 5000 }), BATCH, f.paths(...names), slot.signal, () => {})
  slot.release()
  assert.equal(out.cancelled, true)
  assert.deepEqual(out.stored, [])
  assert.ok(Date.now() - began < 900)
  assert.ok(m.count(PHOTOS) <= 3)
  m.close(); f.done()
})

test('cancel interrupts the retry wait', async () => {
  const m = await mock((r) => shared(r) ?? [503, {}])
  const f = folder([['a.jpg', 5]])
  const u = new Uploader()
  const slot = u.begin()
  setTimeout(() => u.cancel(), 150)
  const began = Date.now()
  const out = await run(await signedIn(m.api, { retryDelayMs: 5000 }), BATCH, f.paths('a.jpg'), slot.signal, () => {})
  assert.equal(out.cancelled, true)
  assert.ok(Date.now() - began < 1500)
  m.close(); f.done()
})

test('a second run is refused while one runs; the slot frees on release; an outer abort cancels', () => {
  const u = new Uploader()
  const first = u.begin()
  assert.throws(() => u.begin(), { kind: 'bad_request', message: 'an upload is already running' })
  first.release()
  const outer = new AbortController()
  const second = u.begin(outer.signal)
  outer.abort()
  assert.equal(second.signal.aborted, true)
  second.release()
  assert.doesNotThrow(() => u.begin().release())
})

test('upload_files handler: photo uses the picker, a cancelled dialog is an empty summary, cancel/unwatch/dropped are empty, a second photo run is refused', async () => {
  const m = await mock(async (r) => {
    const s = shared(r)
    if (s) return s
    await sleep(200)
    return stored()
  })
  const f = folder([['a.jpg', 5]])
  let picked: string[] = f.paths('a.jpg')
  const h = createHandlers({ session: await signedIn(m.api), useMemory() {}, exit() {}, pick: async () => picked })
  const emitted: unknown[] = []
  const ctx = { signal: live(), emit: (x: unknown) => void emitted.push(x) }
  const empty = { stored: [], rejected: [], cancelled: false }
  for (const kind of ['cancel', 'unwatch', 'dropped'] as const) assert.deepEqual(await h.upload_files({ kind, targetId: BATCH }, ctx), empty)
  const first = h.upload_files({ kind: 'photo', targetId: BATCH }, ctx)
  await sleep(50)
  await assert.rejects(h.upload_files({ kind: 'photo', targetId: BATCH }, ctx), { kind: 'bad_request', message: 'an upload is already running' })
  const out = (await first) as { stored: string[] }
  assert.equal(out.stored.length, 1)
  assert.ok(emitted.some((e) => (e as { type?: string }).type === 'progress'))
  picked = []
  assert.deepEqual(await h.upload_files({ kind: 'photo', targetId: BATCH }, ctx), empty)
  m.close(); f.done()
})

test('the page aborting (reload, window closed) cancels the run', async () => {
  const m = await mock(async (r) => shared(r) ?? (await sleep(1000), stored()))
  const f = folder([['a.jpg', 5]])
  const h = createHandlers({ session: await signedIn(m.api, { uploadTimeoutMs: 5000 }), useMemory() {}, exit() {}, pick: async () => f.paths('a.jpg') })
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 150)
  const out = (await h.upload_files({ kind: 'photo', targetId: BATCH }, { signal: ac.signal, emit() {} })) as { cancelled: boolean }
  assert.equal(out.cancelled, true)
  m.close(); f.done()
})

const INQ = '0b1c2d3e-0000-4000-8000-0000000000aa'
const ATT = `/api/v1/inquiries/${INQ}/attachments`
const MB = 1024 * 1024

test('attachment: a bad inquiry id is bad_request before the dialog, any file read or request', async () => {
  const m = await mock((r) => shared(r) ?? stored())
  let opened = 0
  const h = createHandlers({ session: await signedIn(m.api), useMemory() {}, exit() {}, pick: async () => (opened++, ['/x/a.pdf']) })
  for (const bad of ['', 'short', `${INQ}z`, INQ.replace('a', 'g'), `${INQ}0`, '../'.repeat(12)]) {
    await assert.rejects(h.upload_files({ kind: 'attachment', targetId: bad }, { signal: live(), emit() {} }), { kind: 'bad_request', message: 'bad inquiry id' }, bad)
  }
  assert.equal(opened, 0)
  assert.equal(m.log.length, 0)
  m.close()
})

test('attachment: any type, sequential, each with a fresh 32-hex key; ids land in stored; the 20 MiB boundary', async () => {
  let open = 0
  let peak = 0
  const m = await mock(async (r, n) => {
    const s = shared(r)
    if (s) return s
    peak = Math.max(peak, ++open)
    await sleep(30)
    open--
    return stored(n)
  })
  const f = folder([['a.pdf', 10], ['b.docx', 10], ['at.bin', 20 * MB], ['over.bin', 20 * MB + 1]])
  const out = await attachFiles(await signedIn(m.api), INQ, [...f.paths('a.pdf', 'b.docx', 'at.bin', 'over.bin'), '/nope/gone.txt'])
  assert.equal(out.stored.length, 3)
  assert.deepEqual(out.rejected.map((r) => [r.name, r.reason]).sort(), [['gone.txt', 'unreadable'], ['over.bin', 'size']])
  assert.equal(peak, 1)
  const sent = m.log.filter((r) => r.path === ATT)
  assert.equal(sent.length, 3)
  assert.ok(sent.every((r) => /^[0-9a-f]{32}$/.test(r.idem) && r.auth === 'Bearer access-1' && r.raw.includes('name="file"')))
  assert.equal(new Set(sent.map((r) => r.idem)).size, 3)
  assert.equal(out.cancelled, false)
  m.close(); f.done()
})

test('attachment: 413 is size, 422 is unreadable, 403 fatal no_access, other fatal failed, a missing id is failed, no retry on a lost connection', async () => {
  const f = folder([['a.pdf', 5]])
  for (const [status, want] of [[413, 'size'], [422, 'unreadable']] as const) {
    const m = await mock((r) => shared(r) ?? [status, {}])
    const out = await attachFiles(await signedIn(m.api), INQ, f.paths('a.pdf'))
    assert.deepEqual(out.rejected, [{ name: 'a.pdf', reason: want }])
    m.close()
  }
  for (const [reply, want] of [[[403, {}], { kind: 'no_access' }], [[500, {}], { kind: 'failed', message: 'attachment upload failed' }], [[201, {}], { kind: 'failed', message: 'bad attachment answer' }]] as const) {
    const m = await mock((r) => shared(r) ?? (reply as unknown as Reply))
    await assert.rejects(attachFiles(await signedIn(m.api), INQ, f.paths('a.pdf')), want)
    m.close()
  }
  const m = await mock((r) => shared(r) ?? 'close')
  await assert.rejects(attachFiles(await signedIn(m.api), INQ, f.paths('a.pdf')), { kind: 'offline' })
  assert.equal(m.count(ATT), 1)
  m.close(); f.done()
})

test('avatar: PUT with no idempotency key, 2 MiB boundary, status mapping', async () => {
  const f = folder([['me.png', 10], ['at.png', 2 * MB], ['over.png', 2 * MB + 1], ['me.gif', 5]])
  let m = await mock((r) => shared(r) ?? [200, {}])
  const s = await signedIn(m.api)
  assert.deepEqual(await setAvatar(s, f.paths('me.png')[0]!), { stored: ['avatar'], rejected: [], cancelled: false })
  const put = m.log.find((r) => r.path === '/api/v1/me/avatar')!
  assert.deepEqual([put.method, put.idem, put.auth], ['PUT', '', 'Bearer access-1'])
  assert.ok(put.raw.includes('filename="me.png"') && put.raw.includes('name="file"'))
  assert.deepEqual((await setAvatar(s, f.paths('at.png')[0]!)).stored, ['avatar'])
  assert.deepEqual((await setAvatar(s, f.paths('over.png')[0]!)).rejected, [{ name: 'over.png', reason: 'size' }])
  assert.deepEqual((await setAvatar(s, f.paths('me.gif')[0]!)).rejected, [{ name: 'me.gif', reason: 'type' }])
  assert.deepEqual((await setAvatar(s, '/nope/x.png')).rejected, [{ name: 'x.png', reason: 'unreadable' }])
  assert.equal(m.count('/api/v1/me/avatar'), 2)
  m.close()
  for (const [status, want] of [[413, 'size'], [415, 'type']] as const) {
    m = await mock((r) => shared(r) ?? [status, {}])
    assert.deepEqual((await setAvatar(await signedIn(m.api), f.paths('me.png')[0]!)).rejected, [{ name: 'me.png', reason: want }])
    m.close()
  }
  m = await mock((r) => shared(r) ?? [403, {}])
  await assert.rejects(setAvatar(await signedIn(m.api), f.paths('me.png')[0]!), { kind: 'no_access' })
  m.close()
  m = await mock((r) => shared(r) ?? [500, {}])
  await assert.rejects(setAvatar(await signedIn(m.api), f.paths('me.png')[0]!), { kind: 'failed', message: 'avatar upload failed' })
  m.close(); f.done()
})

test('attachment and avatar handlers: a dismissed dialog is cancelled:true with no request; unknown kind is bad_request', async () => {
  const m = await mock((r) => shared(r) ?? stored())
  const h = createHandlers({ session: await signedIn(m.api), useMemory() {}, exit() {}, pick: async () => [] })
  const ctx = { signal: live(), emit() {} }
  const dismissed = { stored: [], rejected: [], cancelled: true }
  assert.deepEqual(await h.upload_files({ kind: 'avatar', targetId: '' }, ctx), dismissed)
  assert.deepEqual(await h.upload_files({ kind: 'attachment', targetId: INQ }, ctx), dismissed)
  await assert.rejects(h.upload_files({ kind: 'nope' as never, targetId: '' }, ctx), { kind: 'bad_request', message: 'unknown upload kind' })
  assert.equal(m.log.length, 0)
  m.close()
})

test('attachment and avatar handlers pick, send and return a summary only (no paths, no bytes)', async () => {
  const m = await mock((r) => shared(r) ?? stored(7))
  const f = folder([['a.pdf', 5], ['me.jpg', 5]])
  const asked: string[] = []
  const h = createHandlers({ session: await signedIn(m.api), useMemory() {}, exit() {}, pick: async (k) => (asked.push(k), k === 'avatar' ? f.paths('me.jpg') : f.paths('a.pdf')) })
  const ctx = { signal: live(), emit() {} }
  const a = await h.upload_files({ kind: 'attachment', targetId: INQ }, ctx)
  const v = await h.upload_files({ kind: 'avatar', targetId: '' }, ctx)
  assert.deepEqual(a, { stored: [id(7)], rejected: [], cancelled: false })
  assert.deepEqual(v, { stored: ['avatar'], rejected: [], cancelled: false })
  assert.deepEqual(asked, ['attachment', 'avatar'])
  assert.ok(!JSON.stringify([a, v]).includes(tmpdir()))
  m.close(); f.done()
})
