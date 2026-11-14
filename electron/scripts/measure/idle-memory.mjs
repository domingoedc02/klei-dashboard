// Idle memory (20.2, NFR-2: every run <= 300 MB over the whole process tree). Usage: node scripts/measure/idle-memory.mjs [--runs 3] [--idle 60]
// The built app (same Electron runtime and code as the package, started from a folder, not asar) is signed in on the dashboard fixtures, then left alone
// for --idle seconds; the sum is taken over the app process and every descendant (renderer, GPU, utility, helpers).
// Figure: macOS `footprint` (phys_footprint), Linux Pss from /proc/<pid>/smaps_rollup, Windows private bytes. The Linux and Windows readers have not been run.
// No Chromium switches are added (the harness's --disable-gpu would drop the GPU process from the sum).
// Writes only under electron/parity-out/perf/.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { arch, cpus, platform, release, tmpdir, totalmem } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDashboard, startApp } from '../../test/parity/electron-side.mjs'
import { LIMITS, descendants, median, verdict } from './lib.mjs'

const opt = (k, d) => Number(process.argv[process.argv.indexOf(k) + 1] || d)
const runs = opt('--runs', 3)
const idleS = opt('--idle', 60)
const out = fileURLToPath(new URL('../../parity-out/perf/', import.meta.url))
mkdirSync(out, { recursive: true })

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20 })

function tree(root) {
  if (platform() === 'win32') {
    const rows = JSON.parse(sh('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress']))
    return descendants(rows.map((r) => [r.ProcessId, r.ParentProcessId]), root)
  }
  const rows = sh('ps', ['-A', '-o', 'pid=,ppid=']).trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number))
  return descendants(rows, root)
}

/** [{ pid, name, mb }] for each process of the tree. */
function readMemory(pids) {
  if (platform() === 'darwin') {
    const f = join(tmpdir(), `klei-fp-${process.pid}.json`)
    sh('footprint', ['-j', f, ...pids.flatMap((p) => ['-p', String(p)])])
    return JSON.parse(readFileSync(f, 'utf8')).processes.map((p) => ({ pid: p.pid, name: p.name, mb: p.footprint / 2 ** 20 }))
  }
  if (platform() === 'linux') {
    return pids.map((pid) => {
      const kb = Number(/Pss:\s+(\d+) kB/.exec(readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'))?.[1] ?? 0)
      return { pid, name: readFileSync(`/proc/${pid}/comm`, 'utf8').trim(), mb: kb / 1024 }
    })
  }
  const rows = JSON.parse(sh('powershell', ['-NoProfile', '-Command', `Get-Process -Id ${pids.join(',')} | Select-Object Id,ProcessName,PrivateMemorySize64 | ConvertTo-Json -Compress`]))
  return [rows].flat().map((r) => ({ pid: r.Id, name: r.ProcessName, mb: r.PrivateMemorySize64 / 2 ** 20 }))
}

const results = []
for (let i = 1; i <= runs; i++) {
  const { app, state, close } = await startApp({ size: '1280x800', flags: [] })
  try {
    await openDashboard({ app, state })
    await new Promise((ok) => setTimeout(ok, idleS * 1000))
    const procs = readMemory(tree(app.process().pid))
    results.push({ run: i, totalMb: Math.round(procs.reduce((s, p) => s + p.mb, 0)), processes: procs.map((p) => ({ name: p.name, mb: Math.round(p.mb) })) })
  } finally {
    await close()
  }
}
const totals = results.map((r) => r.totalMb)
const report = {
  what: 'idle memory, signed in on the dashboard', limitMb: LIMITS.idleMb, idleSeconds: idleS,
  machine: { platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model, memGb: Math.round(totalmem() / 2 ** 30) },
  figure: { darwin: 'footprint (phys_footprint)', linux: 'Pss', win32: 'private bytes' }[platform()],
  results, medianMb: median(totals), worstMb: Math.max(...totals), verdict: verdict(totals, LIMITS.idleMb),
}
writeFileSync(`${out}idle-memory-${platform()}-${arch()}.json`, JSON.stringify(report, null, 1))
for (const r of results) console.log(`run ${r.run}: ${r.totalMb} MB  [${r.processes.map((p) => `${p.name} ${p.mb}`).join(', ')}]`)
console.log(`${report.figure}; median ${report.medianMb} MB; worst ${report.worstMb} MB; limit ${LIMITS.idleMb} MB; ${report.verdict}`)
process.exit(report.verdict === 'PASS' ? 0 : 1)
