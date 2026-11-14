import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const DIR = fileURLToPath(new URL('../../docs/planning-artifacts/electron-migration/', import.meta.url))
const read = (f: string) => readFileSync(`${DIR}${f}`, 'utf8')
const tableCells = (t: string) => t.split('\n').filter((l) => l.startsWith('|') && !/^\|[-| ]+\|$/.test(l))

test('decision records: the owner records are blank-ready (empty value column, unsigned)', () => {
  for (const f of ['decisions/cutover-decision.md', 'decisions/retirement-decision.md']) {
    const rows = tableCells(read(f)).slice(1)
    assert.ok(rows.length >= 8, f)
    for (const r of rows) {
      const [, , value] = r.split('|')
      if (!/What stays untouched/.test(r)) assert.equal(value!.trim(), '', `${f}: ${r}`)
    }
    assert.match(read(f), /Owner signature: _+\s+Date: _+/)
  }
})

test('decision records: cutover lists the rollback triggers; retirement never deletes the Tauri app', () => {
  assert.match(read('decisions/cutover-decision.md'), /lost or duplicated business data[^|]*sign-in failure[^|]*start-up failure/)
  assert.match(read('decisions/retirement-decision.md'), /never deletes or edits the Tauri app/)
})

test('readiness record: no cell says PASS for an OS without evidence, and the verdict is not ready', () => {
  const t = read('decisions/cutover-readiness.md')
  assert.match(t, /Not ready for a cutover decision/)
  const rows = tableCells(t).filter((r) => /^\| (macOS x64|Windows 11 x64|Ubuntu 24\.04 x64) /.test(r))
  assert.equal(rows.length, 3)
  for (const r of rows) assert.ok(!/PASS/.test(r) && /NOT READY/.test(r), r)
})

test('evidence templates: rollback and pilot are NOT RUN until a human runs them', () => {
  assert.match(read('evidence/rollback.md'), /Status: NOT RUN/)
  assert.match(read('evidence/pilot.md'), /Status: NOT RUN/)
  assert.deepEqual(readdirSync(`${DIR}decisions`).sort(), ['cutover-decision.md', 'cutover-readiness.md', 'retirement-decision.md'])
})
