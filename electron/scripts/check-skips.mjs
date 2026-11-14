// A skipped test fails CI unless test/allowed-skips.json names it (19.2). Usage: node scripts/check-skips.mjs <test-output-file>
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Names of tests the runner reported as `# SKIP`, from spec-reporter output. */
export const skipped = (log) => [...log.matchAll(/^\s*﹣ (.+?) \(\d[\d.]*ms\) # SKIP/gm)].map((m) => m[1])

export const unexpected = (log, allowed) => skipped(log).filter((n) => !allowed.some((a) => a.name === n))

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const allowed = JSON.parse(readFileSync(fileURLToPath(new URL('../test/allowed-skips.json', import.meta.url)), 'utf8'))
  const log = readFileSync(process.argv[2], 'utf8')
  // An unrecognised reporter format would list no skips and pass; refuse it.
  if (!/^ℹ tests \d+/m.test(log)) {
    console.error('test summary not found in the log')
    process.exit(1)
  }
  const bad = unexpected(log, allowed)
  for (const n of bad) console.error(`unlisted skip: ${n}`)
  console.log(bad.length ? 'skip check failed' : 'skip check passed')
  process.exit(bad.length ? 1 : 0)
}
