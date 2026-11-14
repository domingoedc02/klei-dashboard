import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { skipped, unexpected } from '../scripts/check-skips.mjs'
import { scan } from '../scripts/scan-secrets.mjs'

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const node = (script: string, ...args: string[]) => spawnSync(process.execPath, [path(`../scripts/${script}`), ...args], { encoding: 'utf8' })

test('scan-secrets: a JWT-shaped string, the PKCE vector and a private key fail; the message names the file, never the text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scan-'))
  mkdirSync(join(dir, 'deep'))
  const jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'sig'].join('.')
  writeFileSync(join(dir, 'deep', 'a.js'), `const t="${jwt}"`)
  writeFileSync(join(dir, 'b.js'), 'x dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')
  writeFileSync(join(dir, 'c.pem'), '-----BEGIN PRIVATE KEY-----')
  writeFileSync(join(dir, 'ok.js'), 'const eyJ = 1; // header.payload')
  assert.equal(scan(dir).length, 3)
  const r = node('scan-secrets.mjs', dir)
  assert.equal(r.status, 1)
  assert.ok(!r.stderr.includes(jwt) && !r.stderr.includes('dBjft'))
})

test('scan-secrets: clean folder passes; a missing folder or no argument fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scan-'))
  writeFileSync(join(dir, 'ok.js'), 'console.log(1)')
  assert.equal(node('scan-secrets.mjs', dir).status, 0)
  assert.equal(node('scan-secrets.mjs', join(dir, 'nope')).status, 1)
  assert.equal(node('scan-secrets.mjs').status, 1)
})

test('check-skips: reads runner skip lines; only listed names pass; a log without a summary is refused', () => {
  const log = '✔ a (1ms)\n﹣ packed one (0.04ms) # SKIP\n﹣ other (2ms) # SKIP\nℹ tests 3\n'
  assert.deepEqual(skipped(log), ['packed one', 'other'])
  assert.deepEqual(unexpected(log, [{ name: 'packed one' }]), ['other'])
  assert.deepEqual(unexpected(log, [{ name: 'packed one' }, { name: 'other' }]), [])
  const f = join(mkdtempSync(join(tmpdir(), 'skips-')), 'log.txt')
  writeFileSync(f, 'garbage')
  assert.equal(node('check-skips.mjs', f).status, 1)
  writeFileSync(f, '✔ a (1ms)\nℹ tests 1\n')
  assert.equal(node('check-skips.mjs', f).status, 0)
  writeFileSync(f, '﹣ new skip (1ms) # SKIP\nℹ tests 1\n')
  assert.equal(node('check-skips.mjs', f).status, 1)
})

test('allowed-skips: every entry has a reason and names a test that exists', () => {
  const list = JSON.parse(readFileSync(path('./allowed-skips.json'), 'utf8')) as { name: string; reason: string }[]
  const all = ['packaged-lifecycle.test.ts', 'packaging.test.ts'].map((f) => readFileSync(path(`./${f}`), 'utf8')).join('\n')
  for (const e of list) assert.ok(e.reason && all.includes(e.name), e.name)
})

test('smoke: no argument fails with usage; a binary that exits 0 passes; non-zero fails', () => {
  assert.equal(node('smoke.mjs').status, 1)
  assert.equal(node('smoke.mjs', process.execPath, '-e', '0').status, 0)
  assert.equal(node('smoke.mjs', process.execPath, '-e', 'process.exit(3)').status, 1)
  assert.equal(node('smoke.mjs', join(tmpdir(), 'does-not-exist-binary')).status, 1)
})
