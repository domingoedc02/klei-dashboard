// Pairs <a>/<name>.png with <b>/<name>.png (story 14.2). Reports size, pixel diff, probe geometry and copy findings, missing/extra states.
// Usage: node electron/test/parity/compare.mjs --a electron/parity-out/baseline --b electron/parity-out/electron [--report <file>]
// Exit 1 on any missing/extra state, size mismatch, pixel difference, or geometry/copy finding that exists on one side only.
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = fileURLToPath(new URL('../../../', import.meta.url))
const require = createRequire(join(REPO, 'electron/package.json'))
const { PNG } = require('pngjs')
const pixelmatch = (await import(pathToFileURL(require.resolve('pixelmatch')).href)).default

const pngs = async (d) => new Set((await readdir(d)).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)))
const json = (p) => readFile(p, 'utf8').then(JSON.parse, () => ({ geometry: {}, copy: {} }))
const key = (i) => `${i.kind}|${i.sel}|${i.text}`

export function comparePair(a, b) {
  if (a.width !== b.width || a.height !== b.height) return { size: `${a.width}x${a.height} vs ${b.width}x${b.height}`, diff: a.width * a.height }
  return { size: `${a.width}x${a.height}`, diff: pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1 }) }
}

export async function compare(dirA, dirB) {
  const [A, B] = [await pngs(dirA), await pngs(dirB)]
  const [pa, pb] = [await json(join(dirA, 'probe.json')), await json(join(dirB, 'probe.json'))]
  const report = { missing: [...A].filter((n) => !B.has(n)), extra: [...B].filter((n) => !A.has(n)), pairs: [] }
  for (const n of [...A].filter((n) => B.has(n)).sort()) {
    const [a, b] = await Promise.all([readFile(join(dirA, `${n}.png`)), readFile(join(dirB, `${n}.png`))])
    const { size, diff } = comparePair(PNG.sync.read(a), PNG.sync.read(b))
    const ga = new Set((pa.geometry[n] ?? []).map(key)), gb = new Set((pb.geometry[n] ?? []).map(key))
    const ca = (pa.copy[n] ?? []).join('\n'), cb = (pb.copy[n] ?? []).join('\n')
    report.pairs.push({
      name: n, size, diffPixels: diff,
      geometryOnlyA: [...ga].filter((k) => !gb.has(k)), geometryOnlyB: [...gb].filter((k) => !ga.has(k)),
      copyDiffers: ca !== cb,
    })
  }
  const bad = report.pairs.filter((p) => p.diffPixels || p.geometryOnlyA.length || p.geometryOnlyB.length || p.copyDiffers)
  report.failed = report.missing.length + report.extra.length + bad.length
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? undefined : process.argv[i + 1] }
  if (!arg('a') || !arg('b')) { console.error('usage: compare.mjs --a <dir> --b <dir> [--report <file>]'); process.exit(2) }
  const r = await compare(resolve(arg('a')), resolve(arg('b')))
  await writeFile(resolve(arg('report') ?? join(REPO, 'electron/parity-out/report.json')), JSON.stringify(r, null, 1))
  console.log(`${r.pairs.length} pairs | missing ${r.missing.length} | extra ${r.extra.length} | different ${r.failed - r.missing.length - r.extra.length}`)
  process.exit(r.failed ? 1 : 0)
}
