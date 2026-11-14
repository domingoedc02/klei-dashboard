// Cold start to the Sign-in screen (20.2, NFR-2: every run <= 3 s). Usage: node scripts/measure/cold-start.mjs <packaged binary> [--runs 5] [--purge]
// Time = from just before the process is spawned to a painted frame with the sign-in card on screen (the harness attaches over CDP, so this is an upper bound).
// Uses the packaged app's real profile and credential store, like a user's launch; if a token is stored the run shows the dashboard and is marked invalid.
// --purge runs `purge` (macOS, needs root) before each run; without it the OS file cache is warm and the report says so.
// Writes only under electron/parity-out/perf/.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { arch, cpus, platform, release, totalmem } from 'node:os'
import { fileURLToPath } from 'node:url'
import { LIMITS, median, verdict } from './lib.mjs'

const { _electron } = createRequire(import.meta.url)('@playwright/test')
const [bin, ...rest] = process.argv.slice(2)
if (!bin) {
  console.error('usage: node scripts/measure/cold-start.mjs <packaged binary> [--runs 5] [--purge]')
  process.exit(2)
}
const runs = Number(rest[rest.indexOf('--runs') + 1] || 5)
const purge = rest.includes('--purge')
const out = fileURLToPath(new URL('../../parity-out/perf/', import.meta.url))
mkdirSync(out, { recursive: true })

const results = []
for (let i = 1; i <= runs; i++) {
  if (purge) execFileSync('purge') // throws without root: a purged run that was not purged would be a lie
  const t0 = Date.now()
  const app = await _electron.launch({ executablePath: bin, timeout: 30000 })
  try {
    const page = await app.firstWindow()
    const card = await page.waitForSelector('.auth-card, .app', { state: 'visible', polling: 'raf', timeout: 30000 })
    const screen = (await card.getAttribute('class'))?.includes('auth-card') ? 'signin' : 'other'
    const painted = await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok(Date.now())))))
    results.push({ run: i, ms: painted - t0, screen })
  } finally {
    await app.close().catch(() => {})
  }
}
const valid = results.filter((r) => r.screen === 'signin').map((r) => r.ms)
const report = {
  what: 'cold start to sign-in', limitMs: LIMITS.coldStartMs, cache: purge ? 'purged' : 'warm', binary: bin,
  machine: { platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model, memGb: Math.round(totalmem() / 2 ** 30) },
  results, medianMs: valid.length ? median(valid) : null, worstMs: valid.length ? Math.max(...valid) : null,
  verdict: valid.length === results.length ? verdict(valid, LIMITS.coldStartMs) : 'INVALID (a run did not reach the sign-in screen)',
}
writeFileSync(`${out}cold-start-${platform()}-${arch()}.json`, JSON.stringify(report, null, 1))
console.log(results.map((r) => `run ${r.run}: ${r.ms} ms (${r.screen})`).join('\n'))
console.log(`cache ${report.cache}; median ${report.medianMs} ms; worst ${report.worstMs} ms; limit ${LIMITS.coldStartMs} ms; ${report.verdict}`)
process.exit(report.verdict === 'PASS' ? 0 : 1)
