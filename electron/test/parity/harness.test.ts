import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { compare } from './compare.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const code = (f) => readFileSync(join(HERE, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')

test('harness code never uses the original output path, its flush, or a Vite launch inside desktop/', () => {
  for (const f of readdirSync(HERE).filter((x) => x.endsWith('.mjs'))) {
    const c = code(f)
    assert.ok(!/\bflush\s*\(/.test(c), `${f}: flush()`)
    assert.ok(!/\bOUT\b/.test(c), `${f}: OUT`)
    assert.ok(!/spawn\(\s*['"]npx['"]\s*,\s*\[\s*['"]vite['"]/.test(c), `${f}: spawn npx vite`)
    assert.ok(!/docs\/planning-artifacts\/ui-parity/.test(c), `${f}: writes into ui-parity`)
  }
})

test('harness writes only under the electron output directory', () => {
  const c = code('harness.mjs')
  assert.ok(/electron\/parity-out/.test(c))
  assert.ok(!/writeFile\([^)]*desktop/.test(c))
})

test('a11y checklist names the five kinds of check the story requires', () => {
  const md = readFileSync(join(HERE, 'a11y-checks.md'), 'utf8').toLowerCase()
  for (const w of ['visible focus', 'escape', 'live region', 'reduced motion', 'tab order']) assert.ok(md.includes(w), w)
})

// compare() on two tiny PNGs
const require = createRequire(join(HERE, '../../package.json'))
const { PNG } = require('pngjs')
const solid = (r, g, b) => { const p = new PNG({ width: 4, height: 4 }); for (let i = 0; i < 16; i++) p.data.set([r, g, b, 255], i * 4); return PNG.sync.write(p) }
const dirs = (fa, fb, pa = {}, pb = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'parity-'))
  for (const [d, files, probe] of [['a', fa, pa], ['b', fb, pb]]) {
    mkdirSync(join(root, d))
    for (const [n, buf] of Object.entries(files)) writeFileSync(join(root, d, n), buf)
    writeFileSync(join(root, d, 'probe.json'), JSON.stringify({ geometry: probe.geometry ?? {}, copy: probe.copy ?? {} }))
  }
  return [join(root, 'a'), join(root, 'b')]
}

test('compare: identical pairs pass', async () => {
  const [a, b] = dirs({ 'x-default.png': solid(1, 2, 3) }, { 'x-default.png': solid(1, 2, 3) })
  const r = await compare(a, b)
  assert.equal(r.failed, 0)
  assert.equal(r.pairs[0].diffPixels, 0)
})

test('compare: pixel difference, missing and extra states each fail', async () => {
  const [a, b] = dirs({ 'x-default.png': solid(0, 0, 0), 'only-a.png': solid(0, 0, 0) }, { 'x-default.png': solid(255, 255, 255), 'only-b.png': solid(0, 0, 0) })
  const r = await compare(a, b)
  assert.deepEqual(r.missing, ['only-a'])
  assert.deepEqual(r.extra, ['only-b'])
  assert.equal(r.pairs[0].diffPixels, 16)
  assert.equal(r.failed, 3)
})

test('compare: a geometry finding or copy change on one side only fails the pair', async () => {
  const f = { 'x-default.png': solid(9, 9, 9) }
  const issue = { kind: 'overlap', sel: 'p.a', text: 'hi' }
  let [a, b] = dirs(f, f, { geometry: { 'x-default': [issue] } }, { geometry: { 'x-default': [] } })
  assert.equal((await compare(a, b)).pairs[0].geometryOnlyA.length, 1)
  ;[a, b] = dirs(f, f, { copy: { 'x-default': ['Hello'] } }, { copy: { 'x-default': ['Hullo'] } })
  assert.equal((await compare(a, b)).pairs[0].copyDiffers, true)
})

test('compare: different image sizes count as a full difference', async () => {
  const big = new PNG({ width: 8, height: 4 })
  const [a, b] = dirs({ 'x-default.png': solid(0, 0, 0) }, { 'x-default.png': PNG.sync.write(big) })
  const r = await compare(a, b)
  assert.equal(r.pairs[0].diffPixels, 16)
  assert.match(r.pairs[0].size, /4x4 vs 8x4/)
})
