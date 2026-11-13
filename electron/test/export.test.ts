import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { test } from 'node:test'
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader, type FileEntry } from '@zip.js/zip.js'
import { createHandlers } from '../src/main/commands.ts'
import { build, clean, Exporter, fetchManifest, unique, type Item } from '../src/main/export.ts'
import { MemoryKeychain } from '../src/main/keychain.ts'
import { Session } from '../src/main/session.ts'
import { cfg, mock, pair, type Reply, type Req } from './mock-api.ts'

const A = '0b1c2d3e-0000-4000-8000-00000000000a'
const B = '0b1c2d3e-0000-4000-8000-00000000000b'
const P1 = '0b1c2d3e-0000-4000-8000-000000000011'
const P2 = '0b1c2d3e-0000-4000-8000-000000000012'
const P3 = '0b1c2d3e-0000-4000-8000-000000000013'
const EXPORT = '/api/v1/gowns/export'
const photoPath = (g: string, p: string) => `/api/v1/gowns/${g}/photos/${p}?size=full`
const bytesFor = (path: string) => Buffer.from(`bytes of ${path}`)

const item = (gownId: string, name: string, photos: [string, string][]): Item => ({ gownId, name, photos: photos.map(([id, type]) => ({ id, type })), details: `Name: ${name}\n` })

async function signedIn(api: string, over: Parameters<typeof cfg>[1] = {}) {
  const kc = new MemoryKeychain()
  await kc.store('refresh-0')
  return new Session(cfg(api, over), kc)
}

const photos = (r: Req): Reply | null =>
  r.path === '/api/v1/auth/refresh' ? [200, pair('access-1', 'refresh-1')] : r.path.includes('/photos/') ? [200, bytesFor(r.path)] : null

const dir = mkdtempSync(join(tmpdir(), 'klei-export-'))
let n = 0
const dest = () => join(dir, `out-${n++}.zip`)
test.after(() => rmSync(dir, { recursive: true, force: true }))

async function entries(path: string) {
  const r = new ZipReader(new Uint8ArrayReader(new Uint8Array(readFileSync(path))))
  const out = await Promise.all(((await r.getEntries()) as FileEntry[]).map(async (e) => ({ name: e.filename, method: e.compressionMethod, bytes: Buffer.from(await e.getData(new Uint8ArrayWriter())) })))
  await r.close()
  return out
}

const live = () => new AbortController().signal

test('a name never leaves the folder it is written in', () => {
  for (const hostile of ['../../etc/passwd', '..', 'a/../b', 'C:\\Windows\\x', '/abs/olute', 'x\u0000y\ncontrol', 'con', 'NUL', 'a:b*c?d', '   ', '. .']) {
    const c = clean(hostile)
    assert.ok(c.length > 0, hostile)
    assert.ok(!/[/\\:*?"<>|]/.test(c) && !c.includes('..') && !/\p{Cc}/u.test(c), `${hostile} -> ${c}`)
    assert.ok(!/^[\s.]|[\s.]$/.test(c), c)
  }
  assert.equal(clean('con'), '_con')
  assert.equal(clean('Nul'), '_Nul')
  assert.equal(clean('Willow Rose'), 'Willow Rose')
  assert.equal(clean(''), 'gown')
  assert.equal(clean('a/b'), 'a_b')
})

test('long and emoji names are cut on a character, never inside one', () => {
  const c = clean('x'.repeat(300))
  assert.equal(c.length, 80)
  const e = clean('👰'.repeat(100))
  assert.ok([...e].length <= 80 && Buffer.byteLength(e) <= 200, `${[...e].length}/${Buffer.byteLength(e)}`)
  assert.ok([...e].every((ch) => ch === '👰'))
  assert.ok(Buffer.byteLength(clean('é'.repeat(100))) <= 200)
})

test('equal names get a number whatever the case', () => {
  const taken = new Set<string>()
  assert.deepEqual(['Oak', 'oak', 'OAK', '../Oak'].map((x) => unique(x, taken)), ['Oak', 'oak (2)', 'OAK (3)', '_Oak'])
  assert.equal(unique('con', new Set()), '_con')
})

test('the manifest maps 413 to too_large, 403 to no_access, 422 to bad_request, the rest to failed', async () => {
  let status = 200
  const m = await mock((r) => photos(r) ?? (r.path === EXPORT ? [status, { items: [{ gownId: A, name: 'Oak', photos: [{ id: P1, type: 'jpeg' }], details: 'Name: Oak\n' }], missing: [] }] : [404]))
  const s = await signedIn(m.api)
  const items = await fetchManifest(s, [A])
  assert.deepEqual(items, [{ gownId: A, name: 'Oak', photos: [{ id: P1, type: 'jpeg' }], details: 'Name: Oak\n' }])
  assert.deepEqual((m.log.find((r) => r.path === EXPORT)!.body), { ids: [A] })
  for (const [code, kind] of [[413, 'too_large'], [403, 'no_access'], [422, 'bad_request'], [500, 'failed'], [404, 'failed']] as const) {
    status = code
    await assert.rejects(fetchManifest(s, [A]), { kind }, String(code))
  }
  m.close()
})

test('a manifest that is not what the server promises, or with ids that would change a path, fails', async () => {
  for (const body of [{}, { items: 'x' }, { items: [{ gownId: '../x', name: 'a', photos: [], details: '' }] }, { items: [{ gownId: A, name: 'a', photos: [{ id: 'a/b', type: 'jpeg' }], details: '' }] }, { items: [{ gownId: A, name: 1, photos: [], details: '' }] }]) {
    const m = await mock((r) => photos(r) ?? [200, body])
    await assert.rejects(fetchManifest(await signedIn(m.api), [A]), { kind: 'failed', message: 'unreadable manifest' }, JSON.stringify(body))
    m.close()
  }
})

test('one gown is flat: photos in order stored as they are, details deflated, progress counts gowns', async () => {
  const m = await mock((r) => photos(r) ?? [404])
  const to = dest()
  const seen: unknown[] = []
  const out = await build(await signedIn(m.api), [item(A, 'Willow', [[P1, 'jpeg'], [P2, 'png']])], to, live(), (p) => seen.push(p))
  assert.deepEqual(out, { gowns: 1, photos: 2, cancelled: false })
  const got = await entries(to)
  assert.deepEqual(got.map((e) => e.name), ['photo-1.jpg', 'photo-2.png', 'details.txt'])
  assert.deepEqual(got.map((e) => e.method), [0, 0, 8])
  assert.deepEqual(got[0]!.bytes, bytesFor(photoPath(A, P1)))
  assert.deepEqual(got[1]!.bytes, bytesFor(photoPath(A, P2)))
  assert.equal(got[2]!.bytes.toString(), 'Name: Willow\n')
  assert.deepEqual(seen, [{ done: 0, total: 1 }, { done: 1, total: 1 }])
  m.close()
})

test('several gowns get a folder each, equal names stay apart, a bad name cannot climb out', async () => {
  const m = await mock((r) => photos(r) ?? [404])
  const to = dest()
  const seen: { done: number; total: number }[] = []
  const out = await build(await signedIn(m.api), [item(A, '../Oak', [[P1, 'webp']]), item(B, 'oak', [[P2, 'jpeg'], [P3, 'jpeg']])], to, live(), (p) => seen.push(p))
  assert.deepEqual([out.gowns, out.photos], [2, 3])
  assert.deepEqual((await entries(to)).map((e) => e.name), ['_Oak/photo-1.webp', '_Oak/details.txt', 'oak/photo-1.jpg', 'oak/photo-2.jpg', 'oak/details.txt'])
  assert.deepEqual(seen.at(-1), { done: 2, total: 2 })
  m.close()
})

test('photos are fetched one at a time', async () => {
  let live_ = 0
  let peak = 0
  const m = await mock(async (r) => {
    if (!r.path.includes('/photos/')) return photos(r) ?? [404]
    peak = Math.max(peak, ++live_)
    await sleep(40)
    live_--
    return [200, bytesFor(r.path)]
  })
  await build(await signedIn(m.api), [item(A, 'Oak', [[P1, 'jpeg'], [P2, 'jpeg'], [P3, 'jpeg']])], dest(), live(), () => {})
  assert.equal(peak, 1)
  assert.equal(m.log.filter((r) => r.path === photoPath(A, P2)).length, 1)
  m.close()
})

test('a photo that fails, or an unknown type, stops the run and removes the file', async () => {
  const m = await mock((r) => (r.path.includes(P2) ? [500] : photos(r) ?? [404]))
  const s = await signedIn(m.api)
  const to = dest()
  await assert.rejects(build(s, [item(A, 'Oak', [[P1, 'jpeg'], [P2, 'jpeg'], [P3, 'jpeg']])], to, live(), () => {}), { kind: 'failed', message: 'a photo could not be read' })
  assert.ok(!existsSync(to), 'partial file left behind')
  assert.equal(m.log.filter((r) => r.path === photoPath(A, P3)).length, 0, 'went on after a failure')
  const bad = dest()
  await assert.rejects(build(s, [item(A, 'Oak', [[P1, 'gif']])], bad, live(), () => {}), { kind: 'failed', message: 'unknown photo type' })
  assert.ok(!existsSync(bad))
  m.close()
})

test('a destination that cannot be written fails as "could not write the file"', async () => {
  const m = await mock((r) => photos(r) ?? [404])
  await assert.rejects(build(await signedIn(m.api), [item(A, 'Oak', [[P1, 'jpeg']])], join(dir, 'no', 'such', 'dir.zip'), live(), () => {}), { kind: 'failed', message: 'could not write the file' })
  m.close()
})

test('a cancel does not wait for the slow photo and leaves no file', async () => {
  const m = await mock(async (r) => (r.path.includes(P2) ? (await sleep(1000), [200, bytesFor(r.path)]) : photos(r) ?? [404]))
  const to = dest()
  const ctl = new AbortController()
  setTimeout(() => ctl.abort(), 200)
  const t0 = Date.now()
  const out = await build(await signedIn(m.api), [item(A, 'Oak', [[P1, 'jpeg'], [P2, 'jpeg']])], to, ctl.signal, () => {})
  assert.equal(out.cancelled, true)
  assert.ok(Date.now() - t0 < 900, 'waited for the slow photo')
  assert.ok(!existsSync(to), 'partial file left behind')
  m.close()
})

test('one download at a time; the slot frees when the run ends', () => {
  const x = new Exporter()
  const first = x.begin()
  assert.throws(() => x.begin(), { kind: 'bad_request', message: 'a download is already running' })
  first.release()
  x.begin().release()
  const outer = new AbortController()
  const slot = x.begin(outer.signal)
  outer.abort()
  assert.equal(slot.signal.aborted, true)
  slot.release()
})

test('export_gowns: empty list, unknown kind, empty manifest (no dialog), dismissed dialog, suggested names', async () => {
  let manifest: Item[] = []
  const m = await mock((r) => photos(r) ?? (r.path === EXPORT ? [200, { items: manifest, missing: [] }] : [404]))
  const asked: string[] = []
  let answer: string | null = null
  const h = createHandlers({ session: await signedIn(m.api), useMemory() {}, exit() {}, save: async (s) => (asked.push(s), answer) })
  const ctx = { signal: live(), emit() {} }
  await assert.rejects(h.export_gowns({ kind: 'start', ids: [] }, ctx), { kind: 'bad_request', message: 'nothing to download' })
  await assert.rejects(h.export_gowns({ kind: 'nope' as 'start', ids: [A] }, ctx), { kind: 'bad_request', message: 'unknown download kind' })
  assert.equal(m.log.filter((r) => r.path === EXPORT).length, 0)
  await assert.rejects(h.export_gowns({ kind: 'start', ids: [A] }, ctx), { kind: 'failed', message: 'those gowns no longer exist' })
  assert.deepEqual(asked, [])
  manifest = [item(A, 'Willow/Rose', [[P1, 'jpeg']])]
  assert.deepEqual(await h.export_gowns({ kind: 'start', ids: [A] }, ctx), { gowns: 0, photos: 0, cancelled: true })
  manifest = [item(A, 'Oak', [[P1, 'jpeg']]), item(B, 'Elm', [])]
  assert.deepEqual(await h.export_gowns({ kind: 'start', ids: [A, B] }, ctx), { gowns: 0, photos: 0, cancelled: true })
  assert.deepEqual(asked, ['Willow_Rose.zip', 'klei-gowns.zip'])
  assert.equal(m.log.filter((r) => r.path.includes('/photos/')).length, 0, 'a dismissed dialog fetches nothing')
  assert.deepEqual(await h.export_gowns({ kind: 'cancel', ids: [] }, ctx), { gowns: 0, photos: 0, cancelled: false })
  m.close()
})

test('export_gowns: a second start is refused, cancel interrupts, the file is gone, the slot frees', async () => {
  const m = await mock(async (r) => {
    if (r.path === EXPORT) return [200, { items: [item(A, 'Oak', [[P1, 'jpeg']])], missing: [] }]
    if (r.path.includes('/photos/')) return (await sleep(1000), [200, bytesFor(r.path)])
    return photos(r) ?? [404]
  })
  const to = dest()
  const emitted: unknown[] = []
  const h = createHandlers({ session: await signedIn(m.api, { uploadTimeoutMs: 5000 }), useMemory() {}, exit() {}, save: async () => to })
  const ctx = { signal: live(), emit: (p: unknown) => void emitted.push(p) }
  const first = h.export_gowns({ kind: 'start', ids: [A] }, ctx)
  await sleep(150)
  await assert.rejects(h.export_gowns({ kind: 'start', ids: [A] }, ctx), { kind: 'bad_request', message: 'a download is already running' })
  const t0 = Date.now()
  await h.export_gowns({ kind: 'cancel', ids: [] }, ctx)
  assert.deepEqual(await first, { gowns: 0, photos: 0, cancelled: true })
  assert.ok(Date.now() - t0 < 900)
  assert.ok(!existsSync(to))
  assert.deepEqual(emitted[0], { done: 0, total: 1 })
  const again = h.export_gowns({ kind: 'start', ids: [A] }, { signal: live(), emit() {} })
  await sleep(150)
  await h.export_gowns({ kind: 'cancel', ids: [] }, ctx)
  assert.equal(((await again) as { cancelled: boolean }).cancelled, true)
  m.close()
})

test('export_gowns: a finished download is one real zip and the page only sees counts', async () => {
  const m = await mock((r) => photos(r) ?? (r.path === EXPORT ? [200, { items: [item(A, 'Willow', [[P1, 'jpeg']])], missing: [] }] : [404]))
  const to = dest()
  const emitted: unknown[] = []
  const h = createHandlers({ session: await signedIn(m.api), useMemory() {}, exit() {}, save: async () => to })
  const out = await h.export_gowns({ kind: 'start', ids: [A] }, { signal: live(), emit: (p) => void emitted.push(p) })
  assert.deepEqual(out, { gowns: 1, photos: 1, cancelled: false })
  assert.deepEqual(emitted, [{ done: 0, total: 1 }, { done: 1, total: 1 }])
  assert.ok(!JSON.stringify([out, emitted]).includes(dir))
  assert.deepEqual((await entries(to)).map((e) => e.name), ['photo-1.jpg', 'details.txt'])
  m.close()
})
