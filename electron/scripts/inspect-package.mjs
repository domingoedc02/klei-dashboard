// Checks one unpacked package (19.3): what is inside the app, its identity, no URL scheme, no secret-shaped text. Usage: node scripts/inspect-package.mjs release/<mac-arm64|mac|win-unpacked|linux-unpacked>
// The installers (dmg, exe, deb) are compressed, so the unpacked folder electron-builder leaves next to them is what gets read.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { SECRET } from './scan-secrets.mjs'

const APP_ID = 'co.klei.bridal.electron.preview'
const DEPLOY_NAME = /ELECTRON_DEPLOY_|KLEI_DOWNLOAD_PATH_TOKEN/
const BAD_PATH = [[/\.map$/, 'source map'], [/(^|\/)src-tauri(\/|$)/, 'Tauri source'], [/(^|\/)\.env(\.|$)/, '.env file'], [/\.(pem|key|p12|minisign|keystore)$/, 'key file']]

/** Where the app resources are, and which platform this folder is. */
export function layout(dir) {
  const app = existsSync(dir) && readdirSync(dir).find((n) => n.endsWith('.app'))
  if (app) return { os: 'mac', resources: join(dir, app, 'Contents/Resources'), plist: join(dir, app, 'Contents/Info.plist') }
  return { os: existsSync(join(dir, 'resources/app.asar')) ? 'other' : 'unknown', resources: join(dir, 'resources') }
}

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))

export function inspect(dir) {
  const problems = []
  const { os, resources, plist } = layout(dir)
  const asar = join(resources, 'app.asar')
  if (os === 'unknown') return [`no app.asar under ${dir}`]
  const listed = createRequire(import.meta.url)('@electron/asar').listPackage(asar, { isPack: false }).map((p) => p.replaceAll('\\', '/'))
  for (const p of listed) for (const [re, why] of BAD_PATH) if (re.test(p)) problems.push(`${why} in the package: ${p}`)
  const unpacked = join(resources, 'app.asar.unpacked')
  const natives = existsSync(unpacked) ? walk(unpacked).filter((f) => /@napi-rs[\\/]keyring-[^\\/]+[\\/].*\.node$/.test(f)) : []
  if (natives.length === 0) problems.push('the native credential library is not unpacked')
  const text = readFileSync(asar).toString('latin1')
  for (const [re, why] of [...SECRET, [DEPLOY_NAME, 'deploy setting name']]) if (re.test(text)) problems.push(`${why} inside app.asar`)
  if (plist) {
    const xml = readFileSync(plist, 'utf8')
    if (!xml.includes(`<string>${APP_ID}</string>`)) problems.push(`app id is not ${APP_ID}`)
    if (xml.includes('CFBundleURLTypes')) problems.push('Info.plist declares a URL scheme')
  }
  return problems
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2]
  if (!dir || !statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    console.error('usage: node scripts/inspect-package.mjs <unpacked folder>')
    process.exit(1)
  }
  const problems = inspect(dir)
  for (const p of problems) console.error(p)
  console.log(problems.length ? 'package check failed' : 'package check passed')
  process.exit(problems.length ? 1 : 0)
}
