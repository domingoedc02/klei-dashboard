import assert from 'node:assert/strict'
import test from 'node:test'
import { imageHandler, MAX_ENTRIES, mime, parse, Thumbs, TTL_MS, windowsAlias } from '../src/main/image-protocol.ts'
import { MemoryKeychain } from '../src/main/keychain.ts'
import { Session } from '../src/main/session.ts'
import { cfg, mock, pair, type Reply, type Req } from './mock-api.ts'

const B = '0b1c2d3e-0000-4000-8000-00000000000a'
const P = '0b1c2d3e-0000-4000-8000-000000000011'
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 0, 0, 0]), Buffer.from('WEBPVP8 ')])

async function signedIn(api: string) {
  const kc = new MemoryKeychain()
  await kc.store('refresh-0')
  return new Session(cfg(api), kc)
}
const backend = (body: (r: Req) => Reply | null = () => [200, JPEG]) =>
  mock((r) => (r.path === '/api/v1/auth/refresh' ? [200, pair('access-1', 'refresh-1')] : (body(r) ?? [404])))
const images = (b: Awaited<ReturnType<typeof backend>>) => b.log.filter((r) => r.path.includes('/photos/') || r.path.endsWith('/avatar'))

test('parse: the three layouts, encoded slashes, and nothing else', () => {
  assert.deepEqual(parse(`/${B}/${P}`), { owner: B, photo: P, full: false, gown: false })
  assert.deepEqual(parse(`/${B}/${P}/full`), { owner: B, photo: P, full: true, gown: false })
  assert.deepEqual(parse(`/g/${B}/${P}`), { owner: B, photo: P, full: false, gown: true })
  assert.deepEqual(parse(`/g/${B}/${P}/full`), { owner: B, photo: P, full: true, gown: true })
  assert.deepEqual(parse(`/${B}%2F${P}%2ffull`), { owner: B, photo: P, full: true, gown: false })
  assert.deepEqual(parse('/me/1730000000000'), { owner: 'me', photo: '1730000000000', full: false, gown: false })
  assert.ok(parse(`/me/${'9'.repeat(18)}`))
  const bad = ['', '/', `/${B}`, `/${B}/${P}/thumb`, `/${B}/${P}/full/x`, `/g/${B}`, `/g/g/${B}/${P}`, `/${B}/${P}/`, '/me/', '/me/abc', '/me/12a', `/me/${'9'.repeat(19)}`, '/me/1/2', '/me/-1',
    `/../${B}/${P}`, `/${B}/../${P}`, `/${B}/${P}?x=1`, '/x/y', `/${B.slice(1)}/${P}`, `/${B}/${P.replace('1', 'z')}`, `/${B}%2f..%2f${P}`, `/${B}%252F${P}`, `/%2e%2e/${B}/${P}`]
  for (const p of bad) assert.equal(parse(p), null, p)
})

test('mime follows the first bytes', () => {
  assert.equal(mime(PNG), 'image/png')
  assert.equal(mime(WEBP), 'image/webp')
  assert.equal(mime(Buffer.from('RIFF....WEBP')), 'image/jpeg')
  assert.equal(mime(JPEG), 'image/jpeg')
  assert.equal(mime(Buffer.alloc(0)), 'image/jpeg')
})

test('cache: thumbnails kept for the TTL and no longer, full images and avatars never', async () => {
  const b = await backend()
  try {
    let now = 1_000
    const thumbs = new Thumbs(() => now)
    const s = await signedIn(b.api)
    const thumb = { owner: B, photo: P, full: false, gown: false }
    assert.deepEqual(await thumbs.get(s, thumb), JPEG)
    assert.deepEqual(await thumbs.get(s, thumb), JPEG)
    assert.equal(images(b).length, 1)
    assert.equal(images(b)[0]!.path, `/api/v1/uploads/${B}/photos/${P}?size=thumb`)
    now += TTL_MS - 1
    await thumbs.get(s, thumb)
    assert.equal(images(b).length, 1, 'still fresh one tick before the TTL')
    now += 1
    await thumbs.get(s, thumb)
    assert.equal(images(b).length, 2, 'expired exactly at the TTL')

    const before = thumbs.size
    const full = { ...thumb, full: true }
    await thumbs.get(s, full)
    await thumbs.get(s, full)
    const me = { owner: 'me', photo: '1', full: false, gown: false }
    await thumbs.get(s, me)
    await thumbs.get(s, me)
    assert.equal(thumbs.size, before)
    assert.deepEqual(images(b).slice(2).map((r) => r.path), [`/api/v1/uploads/${B}/photos/${P}?size=full`, `/api/v1/uploads/${B}/photos/${P}?size=full`, '/api/v1/me/avatar', '/api/v1/me/avatar'])

    const g = { ...thumb, gown: true }
    await thumbs.get(s, g)
    assert.equal(images(b).at(-1)!.path, `/api/v1/gowns/${B}/photos/${P}?size=thumb`)
    assert.equal(thumbs.size, before + 1, 'a gown photo with the same ids is a different entry')
  } finally {
    b.close()
  }
})

test('cache: at most 400 entries, expired ones purged before inserting', async () => {
  const b = await backend()
  try {
    let now = 0
    const thumbs = new Thumbs(() => now)
    const s = await signedIn(b.api)
    const key = (i: number) => ({ owner: B, photo: `0b1c2d3e-0000-4000-8000-${String(i).padStart(12, '0')}`, full: false, gown: false })
    for (let i = 0; i < MAX_ENTRIES + 5; i++) await thumbs.get(s, key(i))
    assert.equal(thumbs.size, MAX_ENTRIES)
    const n = images(b).length
    await thumbs.get(s, key(MAX_ENTRIES + 1))
    assert.equal(images(b).length, n + 1, 'a photo past the ceiling is fetched again, not kept')
    now += TTL_MS
    await thumbs.get(s, key(MAX_ENTRIES + 2))
    assert.equal(thumbs.size, 1, 'everything expired went out before the new one went in')
  } finally {
    b.close()
  }
})

test('handler: 200 with a sniffed type; every branch is no-store and nosniff', async () => {
  const b = await backend((r) => (r.path.includes('/gowns/') ? null : r.path.includes('/me/') ? [200, PNG] : [200, JPEG]))
  try {
    const serve = imageHandler(await signedIn(b.api))
    const get = (path: string, method = 'GET') => serve({ url: `klei-img://localhost${path}`, method })
    const check = (r: Response, status: number) => {
      assert.equal(r.status, status)
      assert.equal(r.headers.get('cache-control'), 'no-store')
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff')
      return r
    }
    const ok = check(await get(`/${B}/${P}`), 200)
    assert.equal(ok.headers.get('content-type'), 'image/jpeg')
    assert.deepEqual(Buffer.from(await ok.arrayBuffer()), JPEG)
    const me = check(await get('/me/5'), 200)
    assert.equal(me.headers.get('content-type'), 'image/png')
    for (const method of ['POST', 'PUT', 'DELETE', 'HEAD']) assert.equal(check(await get(`/${B}/${P}`, method), 400).headers.get('content-type'), null, method)
    for (const p of ['/', '/x', `/${B}/${P}/nope`, '/me/x']) {
      const r = check(await get(p), 400)
      assert.equal((await r.arrayBuffer()).byteLength, 0)
    }
    check(await serve({ url: 'not a url', method: 'GET' }), 400)
    check(await get(`/g/${B}/${P}`), 404)
    const reqs = images(b).length
    assert.equal(reqs, 3, 'only the photo, the avatar and the gown reached the backend; refused paths never did')
  } finally {
    b.close()
  }
})

test('handler: upstream 404 is 404, every other non-200 is 502, a failed call is 503', async () => {
  for (const [upstream, answer] of [[404, 404], [403, 502], [500, 502], [204, 502], [302, 502]] as const) {
    const b = await backend(() => [upstream])
    try {
      const r = await imageHandler(await signedIn(b.api))({ url: `klei-img://localhost/${B}/${P}`, method: 'GET' })
      assert.equal(r.status, answer, `upstream ${upstream}`)
      assert.equal(r.headers.get('cache-control'), 'no-store')
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff')
      assert.equal((await r.arrayBuffer()).byteLength, 0)
    } finally {
      b.close()
    }
  }
  const offline = await imageHandler(await signedIn('http://127.0.0.1:1'))({ url: `klei-img://localhost/${B}/${P}`, method: 'GET' })
  assert.equal(offline.status, 503)
  assert.equal(offline.headers.get('cache-control'), 'no-store')
  const signedOut = await imageHandler(new Session(cfg('http://127.0.0.1:1'), new MemoryKeychain()))({ url: `klei-img://localhost/${B}/${P}`, method: 'GET' })
  assert.equal(signedOut.status, 503)
})

test('windows alias: only http://klei-img.localhost reaches the handler; any other http fails closed', async () => {
  const b = await backend()
  try {
    const serve = windowsAlias(imageHandler(await signedIn(b.api)))
    const ok = await serve({ url: `http://klei-img.localhost/${B}/${P}`, method: 'GET' })
    assert.equal(ok.status, 200)
    const avatar = await serve({ url: 'http://klei-img.localhost/me/7', method: 'GET' })
    assert.equal(avatar.status, 200)
    const seen = b.log.length
    for (const url of [`http://example.com/${B}/${P}`, `http://klei-img.localhost:8080/${B}/${P}`, `https://klei-img.localhost/${B}/${P}`, `http://user@klei-img.localhost/${B}/${P}`, `http://other.localhost/${B}/${P}`,
      `http://klei-img.localhost.evil.com/${B}/${P}`, `http://127.0.0.1:${b.api.split(':').pop()}/api/v1/me`, 'http://klei-img.localhost@evil.com/x', 'garbage']) {
      const r = await serve({ url, method: 'GET' })
      assert.equal(r.status, 403, url)
      assert.equal(r.headers.get('cache-control'), 'no-store')
      assert.equal((await r.arrayBuffer()).byteLength, 0)
    }
    assert.equal(b.log.length, seen, 'refused requests never reached the network')
    assert.equal((await serve({ url: `http://klei-img.localhost/${B}/${P}`, method: 'POST' })).status, 400)
    assert.equal((await serve({ url: 'http://klei-img.localhost/x', method: 'GET' })).status, 400)
  } finally {
    b.close()
  }
})
