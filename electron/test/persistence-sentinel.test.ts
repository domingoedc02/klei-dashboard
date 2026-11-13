import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build, launch, path } from './launch.ts'

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

/** Paths under `root` holding `needle` as UTF-8 or UTF-16, however deep; unreadable entries are skipped. Names count too. */
function scan(root: string, needle: string, since = 0): string[] {
  const hits: string[] = []
  const want = [Buffer.from(needle), Buffer.from(needle, 'utf16le')]
  const visit = (p: string, depth: number) => {
    try {
      const st = statSync(p)
      if (st.mtimeMs < since && depth > 0) return
      if (p.includes(needle)) hits.push(p)
      if (st.isDirectory()) { if (depth < 8) for (const n of readdirSync(p)) visit(join(p, n), depth + 1) }
      else if (st.size < 200 * 1024 * 1024) { const b = readFileSync(p); if (want.some((w) => b.includes(w))) hits.push(p) }
    } catch { /* socket, permission, vanished */ }
  }
  visit(root, 0)
  return hits
}

test('the scan finds a sentinel in a file, a nested file and a file name (so an empty result means something)', () => {
  const d = mkdtempSync(join(tmpdir(), 'klei-scan-'))
  try {
    const needle = `SENTINEL-${randomUUID()}`
    writeFileSync(join(d, 'a.bin'), Buffer.concat([Buffer.from('xx'), Buffer.from(needle, 'utf16le')]))
    writeFileSync(join(d, `${needle}.txt`), '')
    assert.equal(scan(d, needle).length, 2)
    assert.equal(scan(d, `SENTINEL-${randomUUID()}`).length, 0)
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test('real profile: a sentinel typed, pasted, copied, rendered and offered to every web store is in no file of the profile or the temp directory afterwards', { timeout: 90_000 }, async () => {
  build()
  const profile = mkdtempSync(join(tmpdir(), 'klei-sentinel-'))
  const started = Date.now() - 1000
  const sentinel = `SENTINEL-${randomUUID()}`
  const app = await launch(profile, path('./fixtures/behavior'))
  try {
    const page = await app.firstWindow()
    await page.waitForFunction(() => typeof (window as unknown as { storeEverywhere?: unknown }).storeEverywhere === 'function')
    await page.evaluate((s: string) => {
      const box = document.getElementById('box')!
      box.focus()
      document.execCommand('insertText', false, s)
      const dt = new DataTransfer()
      dt.setData('text/plain', s)
      box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
      ;(window as unknown as { toCopy: string }).toCopy = s
    }, sentinel)
    await page.click('#copy')
    await page.waitForFunction(() => document.getElementById('status')!.textContent === 'Copied')
    const stores = await page.evaluate((s: string) => (window as unknown as { storeEverywhere(s: string): Promise<string[]> }).storeEverywhere(s), sentinel)
    assert.deepEqual(stores, ['local', 'session', 'cookie', 'cache', 'idb'], 'every store accepted the sentinel, so an empty scan is not just a refused write')
    assert.ok((await page.evaluate(() => document.body.innerText)).includes(sentinel), 'the sentinel was rendered')
  } finally {
    await app.close()
  }
  try {
    assert.deepEqual(scan(profile, sentinel), [], 'profile')
    assert.deepEqual(scan(tmpdir(), sentinel, started).filter((p) => !p.startsWith(profile)), [], 'temp directory')
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})
