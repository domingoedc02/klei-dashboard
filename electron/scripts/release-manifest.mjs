// Release manifest (19.3, 19.4): reads the installers in one folder, checks their names, and writes release.json for the download site (18.5).
// Usage: node scripts/release-manifest.mjs list <dir> [--json out.json] [--five]
//        node scripts/release-manifest.mjs build --version <v> --out release.json entries.json...
//        node scripts/release-manifest.mjs tag <electron-vX.Y.Z>
// release.json has no URL and no notes; the site shows the SHA-256 beside each file and derives latest.json from it.
import { createHash } from 'node:crypto'
import { createReadStream, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compare } from '../src/main/update.ts'

const PREFIX = 'klei-bridal-preview-'
const TARGETS = {
  'mac-arm64.dmg': ['macos', 'arm64', 'dmg'],
  'mac-x64.dmg': ['macos', 'x64', 'dmg'],
  'win-x64.exe': ['windows', 'x64', 'exe'],
  'linux-x64.AppImage': ['linux', 'x64', 'AppImage'],
  'linux-x64.deb': ['linux', 'x64', 'deb'],
}
const NAME = new RegExp(`^${PREFIX}(.+)-(${Object.keys(TARGETS).map((t) => t.replace('.', '\\.')).join('|')})$`)

export const validVersion = (v) => {
  try {
    compare(v, '0.0.0')
    return true
  } catch {
    return false
  }
}

const sha256 = (file) =>
  new Promise((ok, fail) => {
    const h = createHash('sha256')
    createReadStream(file).on('data', (c) => h.update(c)).on('error', fail).on('end', () => ok(h.digest('hex')))
  })

/** Installers in `dir` (blockmaps and other builder files are ignored); a file with our prefix and a wrong name is an error. */
export async function entries(dir) {
  const out = []
  for (const name of readdirSync(dir).sort()) {
    if (!name.startsWith(PREFIX) || name.endsWith('.blockmap')) continue
    const m = NAME.exec(name)
    if (!m || !validVersion(m[1])) throw new Error(`unexpected installer name: ${name}`)
    const [os, arch, kind] = TARGETS[m[2]]
    out.push({ name, os, arch, kind, size: statSync(join(dir, name)).size, sha256: await sha256(join(dir, name)) })
  }
  return out
}

const versionOf = (name) => NAME.exec(name)?.[1]

/** Exactly the five installers of one version; the manifest carries nothing else. */
export function buildManifest(files, version, now = new Date()) {
  if (!validVersion(version)) throw new Error('version is not semver')
  if (files.length !== 5) throw new Error(`expected 5 installers, got ${files.length}`)
  if (new Set(files.map((f) => f.name)).size !== 5) throw new Error('duplicate installer')
  if (new Set(files.map((f) => `${f.os}/${f.arch}/${f.kind}`)).size !== 5) throw new Error('duplicate target')
  for (const f of files) if (versionOf(f.name) !== version) throw new Error(`installer version differs from ${version}: ${f.name}`)
  return { version, pubDate: now.toISOString(), channel: 'preview', files: [...files].sort((a, b) => a.name.localeCompare(b.name)) }
}

/** `electron-vX.Y.Z` must name the same version as package.json, or nothing is published. */
export function tagVersion(tag, pkgVersion) {
  const m = /^electron-v(.+)$/.exec(tag)
  if (!m || !validVersion(m[1])) throw new Error('tag is not electron-v<semver>')
  if (m[1] !== pkgVersion) throw new Error('tag version differs from package.json version')
  return m[1]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, ...args] = process.argv.slice(2)
  const opt = (k) => args[args.indexOf(k) + 1]
  try {
    if (cmd === 'list') {
      const files = await entries(args[0])
      if (args.includes('--five')) buildManifest(files, versionOf(files[0]?.name ?? ''))
      for (const f of files) console.log(`${f.name}  ${f.size} bytes  sha256 ${f.sha256}`)
      if (args.includes('--json')) writeFileSync(opt('--json'), JSON.stringify(files))
    } else if (cmd === 'build') {
      const files = args.filter((a, i) => a.endsWith('.json') && args[i - 1] !== '--out').flatMap((f) => JSON.parse(readFileSync(f, 'utf8')))
      writeFileSync(opt('--out'), JSON.stringify(buildManifest(files, opt('--version')), null, 2))
    } else if (cmd === 'tag') {
      const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
      console.log(tagVersion(args[0], pkg.version))
    } else throw new Error('usage: list <dir> | build --version v --out f entries.json... | tag <tag>')
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
