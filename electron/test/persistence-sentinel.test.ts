import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]))
const files = walk(src).filter((f) => f.endsWith('.ts'))
const text = (f: string) => readFileSync(f, 'utf8')

test('the keyring library is imported by keychain.ts and nothing else', () => {
  const users = files.filter((f) => text(f).includes('@napi-rs/keyring')).map((f) => relative(src, f))
  assert.deepEqual(users, ['main/keychain.ts'])
})

test('no token store other than the credential store: no web storage, cookies or safeStorage in any source', () => {
  for (const f of files) {
    for (const bad of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'safeStorage']) {
      assert.ok(!text(f).includes(bad), `${relative(src, f)} uses ${bad}`)
    }
  }
})

test('the refresh token is read and written only through the Keychain interface', () => {
  const users = files.filter((f) => /refreshToken|refresh-token/.test(text(f))).map((f) => relative(src, f)).sort()
  assert.deepEqual(users, ['main/keychain.ts', 'main/session.ts'])
})
