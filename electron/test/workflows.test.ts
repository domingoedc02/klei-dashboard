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

const MATRIX = [
  { id: 'mac-arm64', os: 'macos-15' },
  { id: 'mac-x64', os: 'macos-15-intel' },
  { id: 'win-x64', os: 'windows-latest' },
  { id: 'linux-x64', os: 'ubuntu-24.04' },
]

test('electron-package.yml: path-filtered plus manual trigger; one native runner per target; no secrets, signing or Tauri names', () => {
  const w = load('electron-package.yml')
  const text = read('electron-package.yml')
  assert.deepEqual(Object.keys(w.on).sort(), ['pull_request', 'push', 'workflow_dispatch'])
  for (const k of ['pull_request', 'push']) assert.deepEqual(trigger(w, k).paths, PATHS, k)
  const job = w.jobs.package!
  assert.equal(job.strategy?.['fail-fast'], false)
  const inc = job.strategy!.matrix!.include as { id: string; os: string; args: string }[]
  assert.deepEqual(inc.map(({ id, os }) => ({ id, os })), MATRIX)
  assert.deepEqual(inc.map((m) => m.args), ['--mac --arm64', '--mac --x64', '--win --x64', '--linux --x64'])
  assert.ok(!/\$\{\{\s*secrets\./.test(text) && !/CSC_|APPLE_|signtool|notariz|identity/i.test(text) && !job.environment && !job.permissions)
  assert.ok(!/KLEI_RELEASE/.test(text))
})

test('electron-package.yml: placeholder download URL passes the release parser', () => {
  const env = load('electron-package.yml').jobs.package!.env!
  assert.match(env.KLEI_DOWNLOAD_BASE_URL!, /^https:\/\/download\.invalid\//)
  assert.ok(parseBase(env.KLEI_DOWNLOAD_BASE_URL, true).startsWith('https://download.invalid/'))
  assert.deepEqual([env.KLEI_API_URL, env.KLEI_AUTH_URL], ['http://127.0.0.1:8080', 'http://127.0.0.1:8081'])
})

test('electron-package.yml: pack, inspect, hash, a smoke launch per OS, 7-day uploads that fail when empty, and a five-file check', () => {
  const w = load('electron-package.yml')
  const text = read('electron-package.yml')
  const list = w.jobs.package!.steps!
  const run = (re: RegExp) => list.filter((s) => re.test(s.run ?? ''))
  assert.equal(run(/npm run pack -- \$\{\{ matrix\.args \}\}/).length, 1)
  assert.equal(run(/inspect-package\.mjs release\/\$\{\{ matrix\.unpacked \}\}/).length, 1)
  assert.equal(run(/release-manifest\.mjs list release/).length, 1)
  assert.equal(list.filter((s) => /smoke-installer\.sh/.test(s.run ?? '')).length, 1)
  const script = readFileSync(join(ROOT, 'electron/scripts/smoke-installer.sh'), 'utf8')
  for (const re of [/hdiutil attach/, /\/S\b/, /reg query 'HKCU\\Software\\Classes\\klei'/, /dpkg -i/, /--appimage-extract-and-run/, /xvfb-run -a node scripts\/smoke\.mjs/, /x-scheme-handler/]) assert.match(script, re)
  const up = list.filter((s) => s.uses?.startsWith('actions/upload-artifact'))
  assert.equal(up.length, 2)
  for (const u of up) assert.deepEqual([u.with?.['retention-days'], u.with?.['if-no-files-found']], [7, 'error'])
  const five = w.jobs.five!
  assert.equal(five.needs, 'package')
  assert.ok(five.steps!.some((s) => /release-manifest\.mjs list installers --five/.test(s.run ?? '')))
  assert.ok(five.steps!.some((s) => s.uses?.startsWith('actions/download-artifact')))
  assert.ok(!/continue-on-error/.test(text))
})

const REL = 'electron-release.yml'
const SECRET_NAMES = ['ELECTRON_DEPLOY_HOST', 'ELECTRON_DEPLOY_USER', 'ELECTRON_DEPLOY_KEY', 'ELECTRON_DEPLOY_KNOWN_HOSTS', 'ELECTRON_DOWNLOAD_BASE_URL']
const refs = (text: string, kind: 'secrets' | 'vars') => [...text.matchAll(new RegExp(`\\$\\{\\{\\s*${kind}\\.([A-Za-z_]+)`, 'g'))].map((m) => m[1]!)

test('electron-release: only electron-v* tags start it; Tauri release.yml (v*) does not match them', () => {
  const w = load(REL)
  assert.deepEqual(w.on, { push: { tags: ['electron-v*'] } })
  const tauri = (yaml.load(read('release.yml')) as Workflow).on as { push: { tags: string[] } }
  assert.deepEqual(tauri.push.tags, ['v*'])
  assert.ok(!/^v/.test('electron-v1.0.0'))
})

test('electron-release: tag shape and package.json version are checked first; every later job needs that', () => {
  const w = load(REL)
  const v = w.jobs.verify!
  assert.match(v.if!, /startsWith\(github\.ref, 'refs\/tags\/electron-v'\)/)
  const run = v.steps!.map((s) => s.run ?? '').join('\n')
  assert.ok(run.includes('^electron-v[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.]+)?$'))
  assert.match(run, /release-manifest\.mjs tag "\$GITHUB_REF_NAME"/)
  assert.deepEqual(w.jobs.test!.needs, 'verify')
  assert.deepEqual(w.jobs.build!.needs, ['verify', 'test'])
  assert.deepEqual(w.jobs.publish!.needs, ['verify', 'build'])
})

test('electron-release: secrets and the approval environment are confined to build and publish; names are the agreed ones', () => {
  const w = load(REL)
  const text = read(REL)
  for (const j of ['verify', 'test']) assert.ok(!w.jobs[j]!.environment && !/secrets\.|vars\./.test(JSON.stringify(w.jobs[j])), j)
  for (const j of ['build', 'publish']) assert.equal(w.jobs[j]!.environment, 'electron-release', j)
  assert.ok(!/secrets\.|vars\./.test(JSON.stringify({ env: w.env })))
  assert.deepEqual([...new Set(refs(text, 'secrets'))].sort(), [...SECRET_NAMES].sort())
  assert.deepEqual([...new Set(refs(text, 'vars'))].sort(), ['ELECTRON_DEPLOY_PATH', 'KLEI_API_URL', 'KLEI_AUTH_URL'])
  assert.ok(!/GITHUB_TOKEN/.test(text) && !/permissions:\s*\n\s+contents:\s*write/.test(text))
  for (const j of Object.values(w.jobs)) assert.equal(j.permissions, undefined)
})

test('electron-release: release build only in the package step, real URL only from the secret, no secret while dependencies install', () => {
  const build = load(REL).jobs.build!
  const pack = build.steps!.filter((s) => /npm run pack/.test(s.run ?? ''))
  assert.equal(pack.length, 1)
  assert.deepEqual(pack[0]!.env, { KLEI_RELEASE: '1', KLEI_API_URL: '${{ vars.KLEI_API_URL }}', KLEI_AUTH_URL: '${{ vars.KLEI_AUTH_URL }}', KLEI_DOWNLOAD_BASE_URL: '${{ secrets.ELECTRON_DOWNLOAD_BASE_URL }}' })
  assert.ok(build.steps!.filter((s) => /npm ci/.test(s.run ?? '')).every((s) => !s.env))
  assert.ok(!('KLEI_RELEASE' in (load(REL).env ?? {})))
  assert.ok(!build.env || !/secrets\./.test(JSON.stringify(build.env)))
})

test('electron-release: nothing built with the real URL is uploaded to GitHub; the secret scan and inspection run; no GitHub release', () => {
  const w = load(REL)
  const text = read(REL)
  const ups = steps(w).filter((s) => s.uses?.startsWith('actions/upload-artifact'))
  assert.equal(ups.length, 1)
  assert.match(String(ups[0]!.with!.path), /entries-\$\{\{ matrix\.id \}\}\.json$/)
  assert.deepEqual([ups[0]!.with!['retention-days'], ups[0]!.with!['if-no-files-found']], [1, 'error'])
  const b = w.jobs.build!.steps!.map((s) => s.run ?? '').join('\n')
  assert.match(b, /inspect-package\.mjs release\/\$\{\{ matrix\.unpacked \}\}/)
  assert.match(b, /scan-secrets\.mjs build/)
  assert.match(b, /smoke-installer\.sh/)
  assert.match(w.jobs.publish!.steps!.map((s) => s.run ?? '').join('\n'), /scan-secrets\.mjs out/)
  assert.ok(!/gh release|create-release|softprops|action-gh-release|\bgh api\b/.test(text))
  assert.ok(!/continue-on-error|\|\| true|set -x|bash -x|ssh-keyscan|StrictHostKeyChecking=no/.test(text))
})

test('electron-release: four native runners as in 19.3, the same tests as 19.2 on three OS families, a publish after all of them', () => {
  const w = load(REL)
  const inc = w.jobs.build!.strategy!.matrix!.include as { id: string; os: string; args: string }[]
  assert.deepEqual(inc.map(({ id, os }) => ({ id, os })), MATRIX)
  assert.deepEqual(inc.map((m) => m.args), ['--mac --arm64', '--mac --x64', '--win --x64', '--linux --x64'])
  assert.equal(w.jobs.build!.strategy!['fail-fast'], false)
  const os = (w.jobs.test!.strategy!.matrix!.include as { os: string }[]).map((m) => m.os).sort()
  assert.deepEqual(os, ['macos-latest', 'ubuntu-latest', 'windows-latest'])
  const t = w.jobs.test!.steps!.map((s) => s.run ?? '').join('\n')
  for (const re of [/npm run typecheck/, /npm test 2>&1 \| tee test\.log/, /check-skips\.mjs test\.log/]) assert.match(t, re)
  assert.match(w.jobs.publish!.steps!.map((s) => s.run ?? '').join('\n'), /release-manifest\.mjs build --version "\$VERSION" --out out\/release\.json entries\/\*\.json/)
  assert.match(w.jobs.publish!.steps!.map((s) => s.run ?? '').join('\n'), /deploy\.sh finish "\$VERSION" out\/release\.json/)
  assert.match(w.jobs.build!.steps!.map((s) => s.run ?? '').join('\n'), /deploy\.sh upload "\$VERSION" release/)
  assert.match(w.jobs.build!.steps!.map((s) => s.run ?? '').join('\n'), /deploy\.sh check "\$VERSION"/)
})
