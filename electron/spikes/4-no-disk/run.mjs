import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, statSync, existsSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'

const electron = createRequire(import.meta.url)('electron')
const S = 'KLEI-SENTINEL-' + randomBytes(6).toString('hex')
const walk = (d) => !existsSync(d) ? [] : readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)])
for (const mode of process.argv.slice(2)) {
  const ud = mkdtempSync(join(tmpdir(), `spike4-${mode}-`))
  const r = spawnSync(electron, [process.env.ENTRY ?? 'main.mjs'], { cwd: import.meta.dirname, env: { ...process.env, SPIKE_MODE: mode, SPIKE_USERDATA: ud, SPIKE_SENTINEL: S }, encoding: 'utf8', timeout: 60000 })
  const roots = [ud, join(homedir(), 'Library/Logs', `klei-spike4-${mode}`), join(homedir(), 'Library/Caches', `klei-spike4-${mode}`), join(homedir(), 'Library/Application Support', `klei-spike4-${mode}`)]
  const files = roots.flatMap(walk)
  const hits = files.filter((f) => { const b = readFileSync(f); return b.includes(S) || b.includes(Buffer.from(S, 'utf16le')) })
  const topDirs = [...new Set(files.map((f) => relative(ud, f).split('/')[0]))].sort()
  console.log(`\n== ${mode}: exit ${r.status}  files ${files.length}  sentinel hits ${hits.length}`)
  console.log('top-level entries:', topDirs.join(', '))
  for (const h of hits) console.log('  HIT', relative(ud, h), statSync(h).size + ' B')
  if (r.status) console.log(r.stderr.split('\n').slice(0, 5).join('\n'))
  if (process.env.LIST) for (const f of files) console.log('   ', relative(ud, f), statSync(f).size)
  for (const root of roots) if (existsSync(root)) rmSync(root, { recursive: true, force: true })
}
