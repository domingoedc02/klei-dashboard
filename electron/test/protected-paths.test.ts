import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { BASELINE, evaluate } from '../scripts/protected-paths.mjs'

const wf = '.github/workflows/electron-ci.yml'

test('clean', () => assert.deepEqual(evaluate('', ''), { code: 0, report: [] }))

test('modified, deleted and renamed files are named with their status letter', () => {
  const r = evaluate('M\tdesktop/src/bridge.ts\nD\tbackend/x.kt\nR100\tinfra/a\tinfra/b\n', '')
  assert.equal(r.code, 1)
  assert.deepEqual(r.report, ['M desktop/src/bridge.ts', 'D backend/x.kt', 'R infra/a -> infra/b'])
})

test('added electron workflow is allowed, committed or untracked', () => {
  assert.equal(evaluate(`A\t${wf}\n`, '').code, 0)
  assert.equal(evaluate('', `?? ${wf}\n`).code, 0)
  assert.equal(evaluate('', `A  ${wf}\n`).code, 0)
})

test('added files elsewhere under a protected path are forbidden', () => {
  for (const p of ['.github/workflows/ci2.yml', '.github/workflows/sub/electron-x.yml', 'desktop/new.ts', 'prototype/v1/a.html']) {
    assert.equal(evaluate(`A\t${p}\n`, '').code, 1, p)
  }
  for (const p of ['backend/x.kt', 'docs/api/openapi.yml', 'infra/new.sh']) {
    assert.deepEqual(evaluate('', `?? ${p}\n`), { code: 1, report: [`?? ${p}`] })
  }
})

test('an edit to an allowed electron workflow after it was added is still allowed only while added', () => {
  assert.equal(evaluate('', ` M ${wf}\n`).code, 1)
})

test('same path in diff and status is reported once', () => {
  assert.equal(evaluate('M\tdesktop/a\n', ' M desktop/a\n').report.length, 1)
})

test('BASELINE is a full SHA and BASELINE.md names the same one', () => {
  assert.match(BASELINE, /^[0-9a-f]{40}$/)
  assert.ok(readFileSync(new URL('../BASELINE.md', import.meta.url), 'utf8').includes(`Migration baseline: \`${BASELINE}\``))
})
