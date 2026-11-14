import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { descendants, LIMITS, median, verdict } from '../scripts/measure/lib.mjs'

test('measure: limits are the NFR-2 figures', () => {
  assert.deepEqual(LIMITS, { coldStartMs: 3000, idleMb: 300 })
})

test('measure: verdict fails on one run above the limit; the median does not rescue it', () => {
  assert.equal(median([1, 2, 100]), 2)
  assert.equal(verdict([1, 2, 3001], 3000), 'FAIL')
  assert.equal(verdict([3000, 10], 3000), 'PASS')
  assert.equal(verdict([], 3000), 'FAIL')
})

test('measure: process tree takes every descendant and nothing else', () => {
  const rows = [[2, 1], [3, 2], [4, 3], [5, 9], [6, 1]]
  assert.deepEqual(descendants(rows, 2).sort(), [2, 3, 4])
})

test('measure: scripts write only under parity-out/perf and never touch desktop/', () => {
  for (const f of ['cold-start.mjs', 'idle-memory.mjs']) {
    const t = readFileSync(new URL(`../scripts/measure/${f}`, import.meta.url), 'utf8')
    assert.match(t, /parity-out\/perf\//)
    assert.ok(!/desktop\//.test(t.replace(/\/\/.*$/gm, '')), f)
    assert.ok(!/writeFileSync\([^)]*(desktop|docs)/.test(t), f)
  }
})
