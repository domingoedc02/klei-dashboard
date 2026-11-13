import assert from 'node:assert/strict'
import { connect } from 'node:net'
import { test } from 'node:test'
import { loopbackRedirect } from '../src/main/auth.ts'
import { MemoryKeychain } from '../src/main/keychain.ts'
import { Session } from '../src/main/session.ts'
import { cfg, mock, pair } from './mock-api.ts'

const raw = (port: number, text: string) =>
  new Promise<string>((resolve) => {
    const s = connect(port, '127.0.0.1', () => s.write(text))
    let out = ''
    s.on('data', (d) => (out += d))
    s.on('close', () => resolve(out))
    s.on('error', () => resolve(out))
  })
const portOf = (uri: string) => Number(new URL(uri).port)
const dead = (port: number) => new Promise<boolean>((ok) => connect(port, '127.0.0.1').once('error', () => ok(true)).once('connect', function (this: import('node:net').Socket) { this.destroy(); ok(false) }))

test('binds 127.0.0.1 on a port of at least 1024; redirect is http://127.0.0.1:<port>/callback', async () => {
  const r = await loopbackRedirect(async () => {})
  const u = new URL(r.uri)
  assert.deepEqual([u.protocol, u.hostname, u.pathname], ['http:', '127.0.0.1', '/callback'])
  assert.ok(Number(u.port) >= 1024)
  r.stop()
})

test('speculative empty connections and stray paths do not count; one /callback answers and closes', async () => {
  const seen: URL[] = []
  const r = await loopbackRedirect(async (u) => void seen.push(u))
  const port = portOf(r.uri)
  const empty = connect(port, '127.0.0.1')
  await new Promise((ok) => empty.once('connect', ok))
  empty.destroy()
  const stray = await raw(port, 'GET /favicon.ico HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n')
  assert.match(stray, /^HTTP\/1\.1 404 /)
  assert.match(stray, /Not found/)
  const post = await raw(port, 'POST /callback HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
  assert.match(post, /^HTTP\/1\.1 404 /)
  assert.equal(seen.length, 0)
  const ok = await raw(port, 'GET /callback?code=abc&state=s HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n')
  assert.match(ok, /^HTTP\/1\.1 200 /)
  assert.match(ok, /You're signed in\. You can return to Klei Bridal\./)
  assert.match(ok, /content-type: text\/html; charset=utf-8/i)
  assert.match(ok, /cache-control: no-store/i)
  assert.match(ok, /content-security-policy: default-src 'none'/i)
  assert.equal(seen.length, 1)
  assert.equal(seen[0]!.searchParams.get('code'), 'abc')
  assert.ok(await dead(port), 'listener closes after the one callback')
})

test('a failed sign-in still answers once, with the failure page', async () => {
  const r = await loopbackRedirect(async () => { throw new Error('state mismatch') })
  const out = await raw(portOf(r.uri), 'GET /callback?code=x&state=bad HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n')
  assert.match(out, /^HTTP\/1\.1 200 /)
  assert.match(out, /Sign-in didn't finish\. Return to Klei Bridal and try again\./)
  assert.ok(!/state mismatch/.test(out))
})

test('stop closes the listener (timeout or cancel)', async () => {
  const r = await loopbackRedirect(async () => {})
  r.stop()
  assert.ok(await dead(portOf(r.uri)))
})

test('end to end: Session + loopback redirect + a browser hit complete the sign-in and close the listener', async () => {
  const m = await mock(() => [200, pair('access-1', 'refresh-1')])
  const kc = new MemoryKeychain()
  const seen: URL[] = []
  const s = new Session(cfg(m.api), kc, {
    redirect: loopbackRedirect,
    open: (u) => {
      const authorize = new URL(u)
      seen.push(authorize)
      const redirect = new URL(authorize.searchParams.get('redirect')!)
      redirect.searchParams.set('code', 'abc')
      redirect.searchParams.set('state', authorize.searchParams.get('state')!)
      void fetch(redirect)
    },
  })
  await s.signIn()
  assert.equal(await kc.load(), 'refresh-1')
  const uri = seen[0]!.searchParams.get('redirect')!
  assert.match(uri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/)
  assert.ok(await dead(portOf(uri)))
  m.close()
})

test('a sign-in timeout closes the listener', async () => {
  let redirectUri = ''
  const s = new Session(cfg('http://127.0.0.1:1', { signInTimeoutMs: 80 }), new MemoryKeychain(), { redirect: loopbackRedirect, open: (u) => void (redirectUri = new URL(u).searchParams.get('redirect')!) })
  await assert.rejects(s.signIn(), { kind: 'timeout' })
  assert.ok(await dead(portOf(redirectUri)))
})
