// Port of desktop/src-tauri/tests/contract.rs for the Electron target.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createBridge } from '../src/preload/bridge.ts'
import { handlers } from '../src/main/commands.ts'
import { CSP } from '../src/main/csp.ts'
import { MAIN_WINDOW } from '../src/main/identity.ts'
import { CHANNEL_COMMANDS, COMMANDS } from '../src/shared/commands.ts'

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const read = (p: string) => readFileSync(path(p), 'utf8')
const abs = (f: string) => readFileSync(f, 'utf8')
const tauri = JSON.parse(read('../../desktop/src-tauri/tauri.conf.json'))
const WANT = ['api_request', 'sign_in', 'sign_out', 'upload_files', 'export_gowns', 'check_update', 'install_update', 'set_dirty', 'session_only'].sort()

const walk = (dir: string, out: string[] = []): string[] => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.ts$/.test(n)) out.push(p)
  }
  return out
}
const mainFiles = walk(path('../src/main'))
const rel = (f: string) => f.slice(path('../src/').length)

test('the nine commands and no others: Tauri, shared list, preload allow list and main handler map agree', () => {
  const rust = [...(/pub const NAMES: \[&str; 9\] = \[([^\]]+)\]/.exec(read('../../desktop/src-tauri/src/commands.rs'))?.[1] ?? '').matchAll(/"(\w+)"/g)].map((m) => m[1]!).sort()
  assert.deepEqual(rust, WANT)
  assert.deepEqual([...COMMANDS].sort(), WANT)
  assert.deepEqual(Object.keys(handlers).sort(), WANT)
  const noIpc = { invoke: async () => ({ ok: null }), on() {}, removeListener() {} }
  assert.deepEqual(Object.keys(createBridge(noIpc)).sort(), WANT)
  assert.deepEqual([...CHANNEL_COMMANDS].sort(), ['export_gowns', 'upload_files'])
  assert.equal(Object.keys(JSON.parse(read('../../desktop/src-tauri/capabilities/default.json')).permissions).length, 9)
})

test('exactly one ipcMain.handle (klei:invoke), no ipcMain.on, no handler name taken from the renderer', () => {
  const src = mainFiles.map((f) => ({ f, t: abs(f) }))
  const handles = src.flatMap(({ f, t }) => [...t.matchAll(/ipcMain\.(\w+)\(([^,)]*)/g)].map((m) => ({ f: rel(f), fn: m[1], arg: m[2]!.trim() })))
  assert.deepEqual(handles, [{ f: 'main/ipc.ts', fn: 'handle', arg: 'INVOKE_CHANNEL' }])
  assert.match(read('../src/shared/commands.ts'), /INVOKE_CHANNEL = 'klei:invoke'/)
  for (const { f, t } of src) assert.ok(!/ipcMain\.(on|once|addListener)\b|\.handleOnce\(|ipcMain\.removeHandler/.test(t), rel(f))
})

test('preload exposes one object named klei, with no ipcRenderer in it', () => {
  const t = read('../src/preload/index.ts')
  assert.equal(t.match(/exposeInMainWorld/g)?.length, 1)
  assert.ok(!/exposeInMainWorld\('klei', ipcRenderer/.test(t))
})

test('CSP equals the Tauri CSP; connect-src stays none; no unsafe or remote source', () => {
  assert.equal(CSP, tauri.app.security.csp)
  assert.match(CSP, /connect-src 'none'/)
  assert.ok(!/unsafe|https?:|\*/.test(CSP))
})

test('identity: window minimum 1100x700, no global tauri equivalent, Tauri deep link scheme stays unclaimed by the preview', () => {
  assert.equal(MAIN_WINDOW.minWidth, 1100)
  assert.equal(MAIN_WINDOW.minHeight, 700)
  assert.equal(tauri.app.withGlobalTauri, false)
  assert.ok(!mainFiles.some((f) => /setAsDefaultProtocolClient/.test(abs(f))), '16.5 owns the deep link; not before')
})

test('no remote URL in main, shared or preload sources (the config and 18.3 constants live in their own modules)', () => {
  const files = [...mainFiles, ...walk(path('../src/shared')), ...walk(path('../src/preload'))]
  const allowed = new Set<string>()
  for (const f of files) {
    const hits = abs(f).match(/(?:https?|wss?):\/\/[^\s'"`)]+/g) ?? []
    for (const h of hits) assert.ok(allowed.has(h), `${rel(f)}: ${h}`)
  }
})

test('writes: only the modules the plan names may touch the file system, and none yet', () => {
  // 16.3 keychain.ts, 17.1 uploads.ts (read), 17.4 export.ts (the one chosen file); app-files.ts only reads the renderer bundle.
  const allow: Record<string, RegExp> = { 'main/app-files.ts': /^(readFile|realpath|stat)$/ }
  const WRITE = /\b(writeFile|appendFile|createWriteStream|mkdir|rm|rmdir|unlink|rename|copyFile|cp|truncate|open|symlink|link|writeSync|openSync)\b/
  for (const f of mainFiles) {
    const t = abs(f)
    const imports = [...t.matchAll(/import\s*\{([^}]+)\}\s*from\s*'node:fs(?:\/promises)?'/g)].flatMap((m) => m[1]!.split(',').map((s) => s.trim().replace(/ as .*/, '')))
    const star = /import\s+(\*\s+as\s+\w+|\w+)\s+from\s+'node:fs/.test(t) || /require\('(node:)?fs/.test(t)
    assert.ok(!star, `${rel(f)}: whole fs import`)
    for (const i of imports) {
      assert.ok(allow[rel(f)]?.test(i), `${rel(f)} imports ${i}`)
      assert.ok(!WRITE.test(i), `${rel(f)} imports ${i}`)
    }
    assert.ok(!/\bset_?[sS]ecret\b|localStorage|sessionStorage|indexedDB|document\.cookie/.test(t), rel(f))
  }
  for (const f of walk(path('../src/renderer-compat'))) {
    const t = abs(f)
    for (const b of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie']) assert.ok(!t.includes(b), `${f} uses ${b}`)
  }
})
