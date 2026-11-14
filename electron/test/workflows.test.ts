import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

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
  assert.ok(!/secrets\./.test(read('electron-protect.yml')))
})
