import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHandlers } from '../src/main/commands.ts'
import { DROP_TTL_MS, dropListener, parseDrop, Uploader } from '../src/main/uploads.ts'
import { attachDrop } from '../src/preload/drop.ts'
import { Session } from '../src/main/session.ts'
import { MemoryKeychain } from '../src/main/keychain.ts'
import { cfg } from './mock-api.ts'
import { loopback } from './loopback.ts'

const clock = () => {
  let t = 1000
  return { now: () => t, tick: (ms: number) => void (t += ms) }
}
const watched = (u: Uploader) => {
  const seen: unknown[] = []
  const ac = new AbortController()
  const ended = u.watch((m) => seen.push(m), ac.signal)
  return { seen, ac, ended }
}

test('a drop with no watcher is forgotten and sends nothing', () => {
  const u = new Uploader()
  u.message({ paths: ['/x/a.jpg'] })
  assert.deepEqual(u.takeDrop(), [])
})

test('watching: drag state and the drop count reach the page; paths and names never do', () => {
  const u = new Uploader()
  const w = watched(u)
  u.message({ over: true })
  u.message({ over: false })
  u.message({ paths: ['/secret/dir/a.jpg', '/secret/dir/b.png'] })
  assert.deepEqual(w.seen, [{ type: 'drag', over: true }, { type: 'drag', over: false }, { type: 'drag', over: false }, { type: 'dropped', count: 2 }])
  assert.ok(!JSON.stringify(w.seen).includes('secret'))
})

test('a drop is claimed once, and only inside the 10 second TTL', () => {
  const c = clock()
  const u = new Uploader(c.now)
  watched(u)
  u.message({ paths: ['/x/a.jpg'] })
  assert.deepEqual(u.takeDrop(), ['/x/a.jpg'])
  assert.deepEqual(u.takeDrop(), [])
  u.message({ paths: ['/x/b.jpg'] })
  c.tick(DROP_TTL_MS - 1)
  assert.deepEqual(u.takeDrop(), ['/x/b.jpg'])
  u.message({ paths: ['/x/c.jpg'] })
  c.tick(DROP_TTL_MS)
  assert.deepEqual(u.takeDrop(), [])
})

test('unwatch ends the watch, clears the pending drop, and later drops are ignored until a new watch', async () => {
  const u = new Uploader()
  const w = watched(u)
  u.message({ paths: ['/x/a.jpg'] })
  u.unwatch()
  await w.ended
  assert.deepEqual(u.takeDrop(), [])
  u.message({ over: true })
  u.message({ paths: ['/x/b.jpg'] })
  assert.equal(w.seen.length, 2) // the first drag(false) and dropped event only
  assert.deepEqual(u.takeDrop(), [])
  const again = watched(u)
  u.message({ paths: ['/x/c.jpg'] })
  assert.deepEqual(again.seen.at(-1), { type: 'dropped', count: 1 })
})

test('a newer watch replaces the older; the page going away ends and clears the watch', async () => {
  const u = new Uploader()
  const a = watched(u)
  const b = watched(u)
  await a.ended
  u.message({ over: true })
  assert.deepEqual([a.seen.length, b.seen.length], [0, 1])
  u.message({ paths: ['/x/a.jpg'] })
  b.ac.abort()
  await b.ended
  assert.deepEqual(u.takeDrop(), [])
  u.message({ over: true })
  assert.equal(b.seen.length, 3)
})

test('only the exact message shapes count: junk, extra keys, wrong types, empty and oversize lists are ignored', () => {
  const u = new Uploader()
  const w = watched(u)
  for (const m of [null, 1, 'x', [], { over: 'yes' }, { over: true, paths: [] }, { paths: [1] }, { paths: [''] }, { paths: 'a' }, { paths: [] }, { nope: 1 }, { paths: ['a'.repeat(5000)] }, { paths: new Array(50_001).fill('/a') }, Object.create({ over: true })]) {
    assert.equal(parseDrop(m), null, JSON.stringify(m)?.slice(0, 40))
    u.message(m)
  }
  assert.deepEqual(w.seen, [])
  assert.deepEqual(u.takeDrop(), [])
})

test('the private channel ignores messages from an untrusted sender', () => {
  const u = new Uploader()
  const w = watched(u)
  let trusted = false
  const listen = dropListener<object>(() => trusted, u)
  listen({}, { over: true })
  listen({}, { paths: ['/x/a.jpg'] })
  assert.deepEqual(w.seen, [])
  assert.deepEqual(u.takeDrop(), [])
  trusted = true
  listen({}, { over: true })
  assert.deepEqual(w.seen, [{ type: 'drag', over: true }])
})

test('upload_files: watch events ride its channel until unwatch; "dropped" sends only the claimed drop', async () => {
  const u = new Uploader()
  const h = createHandlers({ session: new Session(cfg('http://127.0.0.1:1'), new MemoryKeychain()), useMemory() {}, exit() {}, uploader: u })
  const { bridge, invoker } = loopback(h)
  const seen: unknown[] = []
  const watch = bridge.upload_files('watch', '', (e: unknown) => void seen.push(e))
  await new Promise((r) => setTimeout(r, 20))
  u.message({ over: true })
  u.message({ paths: ['/x/a.jpg'] })
  assert.deepEqual(seen, [{ type: 'drag', over: true }, { type: 'drag', over: false }, { type: 'dropped', count: 1 }])
  assert.equal(invoker.liveCalls(), 1)
  const empty = { stored: [], rejected: [], cancelled: false }
  assert.deepEqual(await bridge.upload_files('unwatch', '', () => {}), empty)
  assert.deepEqual(await watch, empty)
  assert.equal(invoker.liveCalls(), 0)
  assert.deepEqual(await bridge.upload_files('dropped', 'b', () => {}), empty) // unwatch cleared the pending paths: nothing to send
})

// preload side: fake DOM, no Electron
class Target extends EventTarget {}
const drag = (t: Target, type: string, init: { types?: string[]; files?: { name: string; path: string }[] }) => {
  const e = Object.assign(new Event(type, { cancelable: true }), { dataTransfer: { types: init.types ?? ['Files'], files: init.files ?? [] } })
  let page = 0
  t.addEventListener(type, () => page++) // a page listener added after the capture one
  t.dispatchEvent(e)
  return { prevented: e.defaultPrevented, page }
}

test('preload: file drags are stopped before the page, over toggles once, drop sends only resolvable paths', () => {
  const t = new Target()
  const sent: unknown[] = []
  attachDrop(t, { send: (m) => void sent.push(m), pathOf: (f) => (f as unknown as { path: string }).path })
  assert.deepEqual(drag(t, 'dragenter', {}), { prevented: true, page: 0 })
  drag(t, 'dragenter', {}) // child element enter
  drag(t, 'dragleave', {})
  assert.deepEqual(sent, [{ over: true }]) // still inside: one leave per enter
  drag(t, 'dragleave', {})
  assert.deepEqual(sent, [{ over: true }, { over: false }])
  drag(t, 'dragenter', {})
  const r = drag(t, 'drop', { files: [{ name: 'a.jpg', path: '/x/a.jpg' }, { name: 'ghost', path: '' }, { name: 'b.png', path: '/y/b.png' }] })
  assert.deepEqual(r, { prevented: true, page: 0 })
  assert.deepEqual(sent.slice(2), [{ over: true }, { over: false }, { paths: ['/x/a.jpg', '/y/b.png'] }])
})

test('preload: non-file drags are left alone; a throwing path lookup drops that file only', () => {
  const t = new Target()
  const sent: unknown[] = []
  attachDrop(t, { send: (m) => void sent.push(m), pathOf: (f) => { if ((f as unknown as { name: string }).name === 'bad') throw new Error('x'); return '/ok' } })
  assert.deepEqual(drag(t, 'dragenter', { types: ['text/plain'] }), { prevented: false, page: 1 })
  assert.deepEqual(drag(t, 'drop', { types: ['text/uri-list'], files: [{ name: 'a', path: '/a' }] }), { prevented: false, page: 1 })
  assert.deepEqual(sent, [])
  drag(t, 'drop', { files: [{ name: 'bad', path: '' }, { name: 'good', path: '' }] })
  assert.deepEqual(sent, [{ paths: ['/ok'] }])
})
