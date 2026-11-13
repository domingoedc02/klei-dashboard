import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { attachDeepLink, parseCallback } from '../src/main/deeplink.ts'

test('only klei://auth/callback is accepted', () => {
  for (const ok of ['klei://auth/callback?code=a&state=b', 'klei://auth/callback', 'KLEI://auth/callback?code=a']) assert.ok(parseCallback(ok), ok)
  for (const bad of ['', 'klei://auth/other', 'klei://other/callback', 'klei://auth/callback/x', 'http://auth/callback', 'https://127.0.0.1/callback', 'klei:auth/callback', 'not a url', '--flag', 'klei://user@auth/callback/..', 'klei://AUTH/callback']) {
    assert.equal(parseCallback(bad), null, bad)
  }
})

test('open-url, second-instance argv and launch argv are all handled; junk is ignored', async () => {
  const got: string[] = []
  const app = new EventEmitter()
  attachDeepLink(app as never, ['/app', '--x', 'klei://auth/callback?code=launch&state=s'], async (u) => void got.push(u.searchParams.get('code')!))
  let prevented = false
  app.emit('open-url', { preventDefault: () => void (prevented = true) }, 'klei://auth/callback?code=mac&state=s')
  app.emit('open-url', { preventDefault() {} }, 'klei://evil/callback?code=no')
  app.emit('second-instance', {}, ['/app', 'klei://auth/callback?code=win&state=s', 'junk'])
  assert.deepEqual(got, ['launch', 'mac', 'win'])
  assert.ok(prevented)
})

test('a rejecting completion does not crash the handler', async () => {
  const app = new EventEmitter()
  attachDeepLink(app as never, [], async () => { throw new Error('no sign-in in progress') })
  app.emit('second-instance', {}, ['klei://auth/callback?code=a&state=b'])
  await new Promise((ok) => setImmediate(ok))
})
