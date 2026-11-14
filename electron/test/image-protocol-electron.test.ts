import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const ROOT = path('..')
const { _electron } = createRequire(path('../package.json'))('@playwright/test')
const electronBin: string = createRequire(path('../package.json'))('electron')
const profile = mkdtempSync(join(tmpdir(), 'klei-img-'))
const U = '0b1c2d3e-0000-4000-8000-00000000000a'

before(() => { execFileSync(process.execPath, [join(ROOT, 'scripts/build-main.mjs')], { stdio: 'inherit' }) })
after(() => rmSync(profile, { recursive: true, force: true }))

test('real session: klei-img is answered by the handler (signed out gives 503), and http images stay blocked by the CSP', { timeout: 60_000 }, async () => {
  const app = await _electron.launch({ executablePath: electronBin, args: [join(ROOT, 'build/main/index.js')], cwd: ROOT, env: { ...process.env, KLEI_USER_DATA: profile } })
  try {
    const page = await app.firstWindow()
    await page.waitForFunction(() => typeof (window as unknown as { klei?: unknown }).klei === 'object')

    const viaSession = await app.evaluate(async ({ session }: { session: typeof import('electron').session }, u: string) => {
      const ses = session.fromPartition('klei')
      const get = async (url: string, method = 'GET') => {
        const r = await ses.fetch(url, { method })
        return { status: r.status, cache: r.headers.get('cache-control'), sniff: r.headers.get('x-content-type-options'), len: (await r.arrayBuffer()).byteLength }
      }
      return {
        valid: await get(`klei-img://localhost/${u}/${u}`),
        bad: await get('klei-img://localhost/nope'),
        post: await get(`klei-img://localhost/${u}/${u}`, 'POST'),
      }
    }, U)
    for (const [k, status] of [['valid', 503], ['bad', 400], ['post', 400]] as const) {
      assert.deepEqual(viaSession[k], { status, cache: 'no-store', sniff: 'nosniff', len: 0 }, k)
    }

    const seen = await page.evaluate(async (u: string) => {
      const blocked: string[] = []
      document.addEventListener('securitypolicyviolation', (e) => blocked.push(`${e.effectiveDirective} ${e.blockedURI}`))
      const load = (src: string) => new Promise<string>((r) => { const i = new Image(); i.onload = () => r('loaded'); i.onerror = () => r('error'); i.src = src; setTimeout(() => r('timeout'), 3000) })
      const own = await load(`klei-img://localhost/${u}/${u}`)
      const ownViolations = blocked.splice(0)
      const remote = await load('http://example.com/x.png')
      const alias = await load(`http://klei-img.localhost/${u}/${u}`)
      return { own, ownViolations, remote, alias, blocked }
    }, U)
    assert.equal(seen.own, 'error', 'a signed-out request is answered 503, which an image shows as an error')
    assert.deepEqual(seen.ownViolations, [], 'klei-img is allowed by img-src')
    assert.equal(seen.remote, 'error')
    assert.ok(seen.blocked.some((b: string) => b.startsWith('img-src http://example.com')), `example.com must be blocked by img-src: ${seen.blocked}`)
    if (process.platform !== 'win32') assert.ok(seen.blocked.some((b: string) => b.startsWith('img-src http://klei-img.localhost')), `the alias origin is not allowed off Windows: ${seen.blocked}`)
  } finally {
    await app.close()
  }
})
