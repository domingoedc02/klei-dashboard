// "No tokens in the build output" (19.2), ported from desktop.yml. Usage: node scripts/scan-secrets.mjs <dir>...
// Prints file names only, never the matching text. Exit 1 on a match or a missing folder.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const SECRET = [
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, 'JWT-shaped string'],
  [/dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk/, 'PKCE test vector'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
]

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))

export function scan(dir) {
  return walk(dir).flatMap((f) => {
    const text = readFileSync(f).toString('latin1')
    return SECRET.filter(([re]) => re.test(text)).map(([, why]) => `${f}: ${why}`)
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dirs = process.argv.slice(2)
  const missing = dirs.filter((d) => !existsSync(d))
  const hits = dirs.filter((d) => existsSync(d)).flatMap(scan)
  for (const m of missing) console.error(`not found: ${m}`)
  for (const h of hits) console.error(h)
  console.log(hits.length || missing.length || !dirs.length ? 'secret scan failed' : 'secret scan passed')
  process.exit(hits.length || missing.length || !dirs.length ? 1 : 0)
}
