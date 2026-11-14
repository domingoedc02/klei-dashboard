import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { parseBase } from '../src/main/download-url.ts'

// Static checks of the Electron workflow files (Epic 19). Nothing here runs a workflow; the first real run on GitHub is the evidence.
const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const DIR = join(ROOT, '.github/workflows')
const ORIGINAL = ['backend.yml', 'desktop.yml', 'release.yml']

export interface Step { uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, string>; if?: string; name?: string; shell?: string }
export interface Job { 'runs-on'?: unknown; needs?: unknown; if?: string; environment?: unknown; permissions?: Record<string, string>; steps?: Step[]; strategy?: { matrix?: Record<string, unknown>; 'fail-fast'?: boolean }; env?: Record<string, string> }
export interface Workflow { name?: string; on: Record<string, unknown>; permissions?: Record<string, string>; jobs: Record<string, Job>; env?: Record<string, string> }

export const read = (name: string) => readFileSync(join(DIR, name), 'utf8')
export const load = (name: string) => yaml.load(read(name)) as Workflow
export const steps = (w: Workflow) => Object.values(w.jobs).flatMap((j) => j.steps ?? [])
export const electronWorkflows = () => readdirSync(DIR).filter((n) => /^electron.*\.yml$/.test(n))
const FILTERS = ['paths', 'paths-ignore', 'branches-ignore', 'tags-ignore']
/** A key in `on:` with no value (`pull_request:`) loads as null. */
export const trigger = (w: Workflow, k: string) => (w.on[k] ?? {}) as Record<string, unknown>

const FULL_SHA = /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/
const ALLOWED_ACTIONS = ['actions/checkout', 'actions/setup-node', 'actions/upload-artifact', 'actions/download-artifact']
// Names that belong to the Tauri release flow or to secrets this app must not reach.
const FORBIDDEN = [/TAURI_/, /includeUpdaterJson/, /tauri-action/, /RELEASES_(TOKEN|OWNER|REPO)/, /pull_request_target/, /secrets\.GITHUB_TOKEN/]

test('every Electron workflow: SHA-pinned allowed actions, read-only token, no forbidden names, no desktop working directory', () => {
  assert.ok(electronWorkflows().includes('electron-protect.yml'))
  for (const f of electronWorkflows()) {
    const text = read(f)
    const w = load(f)
    assert.equal(w.permissions?.contents, 'read', `${f}: top-level permissions: contents: read`)
    for (const re of FORBIDDEN) assert.ok(!re.test(text), `${f}: ${re}`)
    for (const s of steps(w)) {
      if (!s.uses) continue
      assert.match(s.uses, FULL_SHA, `${f}: ${s.uses} must be pinned to a full commit SHA`)
      assert.ok(ALLOWED_ACTIONS.includes(s.uses.split('@')[0]!), `${f}: ${s.uses} is not an allowed action`)
    }
    for (const s of steps(w)) assert.ok(!/(^|\s)cd desktop|working-directory:\s*desktop/.test(`${s.run ?? ''}`), `${f}: runs inside desktop/`)
    assert.ok(!/working-directory:\s*desktop/.test(text), `${f}: working-directory desktop`)
  }
})

test('workflow files: only electron*.yml were added; the three original workflows are present', () => {
  for (const f of ORIGINAL) assert.ok(existsSync(join(DIR, f)), f)
  const baseline = execFileSync('git', ['ls-tree', '--name-only', '51949da2a0f8347c5f1f56fc5d87d8ada6e60643', '.github/workflows/'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean).map((p) => p.split('/').pop())
  const added = readdirSync(DIR).filter((n) => !baseline.includes(n))
  assert.ok(added.length > 0 && added.every((n) => /^electron[^/]*\.yml$/.test(n)), `unexpected added workflow: ${added.join(', ')}`)
})

test('electron-protect: unfiltered pull_request and push, one job, full history, runs the gate script', () => {
  const w = load('electron-protect.yml')
  assert.deepEqual(Object.keys(w.on).sort(), ['pull_request', 'push'])
  for (const k of ['pull_request', 'push']) for (const f of FILTERS) assert.ok(!(f in trigger(w, k)), `${k}.${f}`)
  assert.equal(Object.keys(w.jobs).length, 1)
  const job = Object.values(w.jobs)[0]!
  assert.ok(!job.environment && !job.permissions)
  const [co, node, gate, ...rest] = job.steps!
  assert.equal(co!.with?.['fetch-depth'], 0)
  assert.match(co!.uses!, /^actions\/checkout@/)
  assert.match(node!.uses!, /^actions\/setup-node@/)
  assert.equal(node!.with?.['node-version'], '24')
  assert.equal(gate!.run, 'node electron/scripts/protected-paths.mjs')
  assert.equal(rest.length, 0)
  assert.ok(!/\$\{\{\s*secrets\./.test(read('electron-protect.yml')))
})

const PATHS = ['electron/**', '.github/workflows/electron*.yml']
const ORDER = ['actions/checkout', 'actions/setup-node']

test('electron.yml: path-filtered triggers, three-OS matrix, working directory electron, bash', () => {
  const w = load('electron.yml')
  assert.deepEqual(Object.keys(w.on).sort(), ['pull_request', 'push'])
  for (const k of ['pull_request', 'push']) assert.deepEqual(trigger(w, k).paths, PATHS, k)
  const job = Object.values(w.jobs)[0]!
  assert.equal(Object.keys(w.jobs).length, 1)
  assert.equal(job.strategy?.['fail-fast'], false)
  const os = (job.strategy?.matrix?.include as { os: string }[]).map((m) => m.os).sort()
  assert.deepEqual(os, ['macos-latest', 'ubuntu-latest', 'windows-latest'])
  const d = (job as { defaults?: { run?: { 'working-directory'?: string; shell?: string } } }).defaults?.run
  assert.deepEqual([d?.['working-directory'], d?.shell], ['electron', 'bash'])
  assert.ok(!job.environment && !job.permissions && !/\$\{\{\s*secrets\./.test(read('electron.yml')))
})

test('electron.yml: steps in the story order, Node 24 with an npm cache keyed on the Electron lockfile', () => {
  const list = Object.values(load('electron.yml').jobs)[0]!.steps!
  const at = (re: RegExp) => list.findIndex((s) => re.test(`${s.uses ?? ''} ${s.run ?? ''}`))
  const order = [/actions\/checkout/, /actions\/setup-node/, /npm ci/, /npm run typecheck/, /npm test/, /check-skips\.mjs/, /npm run build\b/, /smoke\.mjs/, /scan-secrets\.mjs build/].map(at)
  assert.ok(order.every((n) => n >= 0), `missing step: ${order}`)
  assert.deepEqual(order, [...order].sort((a, b) => a - b))
  const node = list[at(/actions\/setup-node/)]!.with!
  assert.deepEqual([node['node-version'], node.cache, node['cache-dependency-path']], ['24', 'npm', 'electron/package-lock.json'])
  assert.ok(list.some((s) => /npm run build:renderer/.test(s.run ?? '')))
  assert.ok(ORDER.every((a) => list.some((s) => s.uses?.startsWith(a))))
})

test('electron.yml: Linux runs under xvfb with its packages; smoke and tests fail the job on a bad exit', () => {
  const text = read('electron.yml')
  const job = Object.values(load('electron.yml').jobs)[0]!
  const include = job.strategy!.matrix!.include as { os: string; headless: string }[]
  assert.equal(include.find((m) => m.os === 'ubuntu-latest')!.headless, 'xvfb-run -a')
  assert.ok(include.filter((m) => m.os !== 'ubuntu-latest').every((m) => m.headless === ''))
  assert.match(text, /apt-get install[^\n]*xvfb/)
  assert.match(text, /matrix\.headless \}\} npm test 2>&1 \| tee test\.log/)
  assert.match(text, /matrix\.headless \}\} node scripts\/smoke\.mjs/)
  assert.ok(!/continue-on-error|\|\| true/.test(text))
  assert.equal(job.steps!.find((s) => s.name?.startsWith('Smoke'))?.shell, undefined)
})

test('electron.yml: dummy env passes the same parser the release build uses; no real URL, no release flag', () => {
  const env = Object.values(load('electron.yml').jobs)[0]!.env!
  assert.equal(env.KLEI_API_URL, 'http://127.0.0.1:8080')
  assert.equal(env.KLEI_AUTH_URL, 'http://127.0.0.1:8081')
  assert.match(env.KLEI_DOWNLOAD_BASE_URL!, /^https:\/\/download\.invalid\//)
  assert.ok(parseBase(env.KLEI_DOWNLOAD_BASE_URL, true).startsWith('https://download.invalid/'))
  assert.ok(!('KLEI_RELEASE' in env))
})
