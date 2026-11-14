// Smoke launch (19.2, 19.3): starts an app with KLEI_SMOKE=1 and passes only if it exits 0 (the page got its first "signed out" answer, so the IPC round trip works under the CSP).
// Usage: node scripts/smoke.mjs <binary> [args...]. Linux callers wrap this in xvfb-run.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [bin, ...args] = process.argv.slice(2)
if (!bin) {
  console.error('usage: node scripts/smoke.mjs <binary> [args...]')
  process.exit(1)
}
const profile = mkdtempSync(join(tmpdir(), 'klei-smoke-'))
// KLEI_USER_DATA is read only by an unpackaged app; a packaged one keeps its own profile and is not asked to.
const child = spawn(bin, args, { stdio: 'inherit', env: { ...process.env, KLEI_SMOKE: '1', KLEI_USER_DATA: profile } })
const timer = setTimeout(() => {
  console.error('smoke launch timed out')
  child.kill('SIGKILL')
}, 60_000)
child.on('exit', (code, signal) => {
  clearTimeout(timer)
  rmSync(profile, { recursive: true, force: true })
  console.log(code === 0 ? 'smoke launch passed' : `smoke launch failed (code ${code}, signal ${signal})`)
  process.exit(code === 0 ? 0 : 1)
})
child.on('error', (e) => {
  console.error(`smoke launch failed: ${e.message}`)
  process.exit(1)
})
