import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const NINE = ['api_request', 'sign_in', 'sign_out', 'session_only', 'set_dirty', 'check_update', 'install_update', 'upload_files', 'export_gowns']

test('alias module: one case per command, nothing dispatches on a page-supplied name', () => {
  const src = read('../src/renderer-compat/core.ts')
  for (const n of NINE) assert.match(src, new RegExp(`case '${n}'`), n)
  assert.equal((src.match(/case '/g) ?? []).length, 9)
  assert.ok(!/native\(\)\s*\[|\bn\[/.test(src), 'computed property call on the preload object')
  assert.ok(!/ipcRenderer|require\(/.test(src))
})

test('spike preload exposes exactly the nine names and has no invoke-by-string path', () => {
  const src = read('../spikes/04-shim/preload.cjs')
  const block = src.slice(src.indexOf('exposeInMainWorld'))
  for (const n of NINE) assert.match(block, new RegExp(`\\b${n}:`), n)
  assert.equal((block.match(/\b[a-z_]+: (call|withEvents)\(/g) ?? []).length, 9)
  assert.ok(!/exposeInMainWorld\([^)]*\{\s*invoke/.test(src))
})

test('electron renderer build has no dev-server address and no Tauri global', () => {
  const dir = fileURLToPath(new URL('../build/renderer/assets/', import.meta.url))
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const s = readFileSync(dir + f, 'utf8')
    assert.ok(!s.includes('localhost:1420'), f)
    assert.ok(!s.includes('__TAURI_INTERNALS__'), f)
  }
})
