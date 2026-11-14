import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildManifest, entries, sums, tagVersion } from '../scripts/release-manifest.mjs'

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const guide = read('../../docs/install-guide-electron.md')
const site = read('../download-site/src/main/resources/templates/index.html')
const yml = read('../electron-builder.yml')

test('no signing or notarization is configured: ad hoc identity only, no certificate setting', () => {
  assert.match(yml, /^ {2}identity: "-"$/m)
  assert.ok(!/notarize|certificateFile|certificateSubjectName|certificatePassword|cscLink|cscKeyPassword|signtoolOptions|azureSignOptions|appleId/i.test(yml))
})

test('guide: the sanctioned warning steps are there, with the macOS 15 route first', () => {
  for (const s of ['Open Anyway', 'Privacy & Security', 'More info', 'Run anyway', 'chmod +x', 'Download update']) assert.ok(guide.includes(s), s)
  assert.ok(guide.indexOf('Open Anyway') < guide.indexOf('right-click'), 'macOS 15 route comes before the older one')
  assert.match(guide, /macOS 15 and later no longer offers/)
})

test('guide: no advice to switch protection off, strip quarantine, edit the registry or run unsigned scripts', () => {
  assert.ok(!/xattr|quarantine|spctl|--master-disable|regedit|reg add|registry|Set-ExecutionPolicy|Unblock-File|sudo (?!apt install \.\/)|disable (gatekeeper|smartscreen|defender)|SmartScreen (off|filter)/i.test(guide))
  assert.match(guide, /Do not turn off any protection/)
})

test('guide: a checksum is integrity relative to the page, never publisher identity, and an update never clears the warning', () => {
  assert.match(guide, /does not prove who made it/)
  assert.match(guide, /optional/i)
  assert.ok(!/proves? (the )?(publisher|who (signed|published))|authentic(ity)? of the publisher|verified publisher/i.test(guide))
  assert.match(guide, /first-launch warning can appear again\. Updating does not remove it/)
  for (const c of ['shasum -a 256', 'Get-FileHash', 'sha256sum']) assert.ok(guide.includes(c), c)
})

test('guide: the app opens a page only; nothing is downloaded, installed or restarted by it', () => {
  assert.match(guide, /does not download, check or install anything itself, and it does not restart/)
})

test('the download page shows the same macOS and Windows steps as the guide', () => {
  for (const s of ['Open Anyway', 'Privacy &amp; Security', 'More info', 'Run anyway']) assert.ok(site.includes(s), s)
  assert.ok(!/xattr|quarantine|spctl|registry|regedit/i.test(site))
})

// 19.4: the manifest and the publish script. deploy.sh talks to the site only through ssh, scp and rsync, so those are replaced by recorders.
const SHELL = process.platform !== 'win32'
const root = fileURLToPath(new URL('..', import.meta.url))

test('release.json: five files, only name/os/arch/kind/size/sha256, safe names, no URL and no notes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'klei-rel-'))
  const names = ['mac-arm64.dmg', 'mac-x64.dmg', 'win-x64.exe', 'linux-x64.AppImage', 'linux-x64.deb'].map((t) => `klei-bridal-preview-1.2.3-${t}`)
  for (const n of names) writeFileSync(join(dir, n), n)
  const m = buildManifest(await entries(dir), '1.2.3', new Date('2026-01-02T03:04:05Z'))
  assert.deepEqual(Object.keys(m), ['version', 'pubDate', 'channel', 'files'])
  assert.deepEqual([m.version, m.channel, m.pubDate], ['1.2.3', 'preview', '2026-01-02T03:04:05.000Z'])
  for (const f of m.files) {
    assert.match(f.name, /^[A-Za-z0-9._-]{1,128}$/)
    assert.match(f.sha256, /^[0-9a-f]{64}$/)
    assert.equal(f.size, f.name.length)
  }
  assert.ok(!/https?:|\/\//.test(JSON.stringify(m)))
  assert.equal(sums(m).length, 5)
  assert.throws(() => sums({ files: [{ name: '../x', sha256: m.files[0]!.sha256 }] }), /invalid file entry/)
  assert.throws(() => sums({ files: [{ name: names[0]!, sha256: 'abc' }] }), /invalid file entry/)
})

test('tag: electron-v<semver> equal to package.json passes; anything else stops the release', () => {
  const v = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version
  assert.equal(tagVersion(`electron-v${v}`, v), v)
  for (const t of ['v' + v, `electron-v${v}.1`, 'electron-v1', 'electron-v1.0.0+build', 'electron-latest', `electron-v${v}-`]) assert.throws(() => tagVersion(t, v), Error, t)
})

const FIVE = ['mac-arm64.dmg', 'mac-x64.dmg', 'win-x64.exe', 'linux-x64.AppImage', 'linux-x64.deb']
const KEY = 'TESTKEY-not-a-real-key-4d8f'

/** Runs deploy.sh with fake ssh/scp/rsync first on PATH. FAKE_EXISTS: exit code of `test -e` (0 exists, 1 absent, 255 unreachable). */
function deploy(args: string[], opt: { exists?: number; ls?: string; sums?: number; env?: Record<string, string> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'klei-deploy-'))
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  const log = join(dir, 'log.txt')
  const fake = `#!/bin/sh
echo "$(basename "$0") $*" >> "${log}"
case "$*" in
  *"test -e"*) exit \${FAKE_EXISTS:-1} ;;
  *"ls -A"*) printf '%s' "$FAKE_LS"; exit 0 ;;
  *"sha256sum -c"*) cat >> "${log}"; exit \${FAKE_SUMS:-0} ;;
esac
exit 0
`
  for (const n of ['ssh', 'scp', 'rsync']) writeFileSync(join(bin, n), fake, { mode: 0o755 })
  const r = spawnSync('bash', [join(root, 'scripts/deploy.sh'), ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      ELECTRON_DEPLOY_HOST: 'site.example.com', ELECTRON_DEPLOY_USER: 'deploy', ELECTRON_DEPLOY_KEY: KEY, ELECTRON_DEPLOY_KNOWN_HOSTS: 'site.example.com ssh-ed25519 AAAA', ELECTRON_DEPLOY_PATH: '/srv/klei-releases',
      FAKE_EXISTS: String(opt.exists ?? 1), FAKE_LS: opt.ls ?? '', FAKE_SUMS: String(opt.sums ?? 0), ...opt.env,
    },
  })
  const calls = existsSync(log) ? readFileSync(log, 'utf8') : ''
  assert.ok(!(r.stdout + r.stderr + calls).includes(KEY), 'the key text must never be printed or passed on a command line')
  return { status: r.status, out: r.stdout + r.stderr, calls, dir }
}

function manifestFile(version = '1.2.3') {
  const dir = mkdtempSync(join(tmpdir(), 'klei-man-'))
  const files = FIVE.map((t, i) => ({ name: `klei-bridal-preview-${version}-${t}`, os: 'x', arch: 'x64', kind: 'x', size: i + 1, sha256: String(i).repeat(64) }))
  writeFileSync(join(dir, 'release.json'), JSON.stringify({ version, pubDate: 'x', channel: 'preview', files }))
  return { path: join(dir, 'release.json'), names: files.map((f) => f.name) }
}

if (SHELL) {
  test('deploy check: an existing version is refused, an unreachable site is not mistaken for a free version, a free one passes', () => {
    const taken = deploy(['check', '1.2.3'], { exists: 0 })
    assert.equal(taken.status, 1)
    assert.match(taken.out, /already exists/)
    const down = deploy(['check', '1.2.3'], { exists: 255 })
    assert.equal(down.status, 1)
    assert.match(down.out, /could not reach/)
    assert.equal(deploy(['check', '1.2.3'], { exists: 1 }).status, 0)
  })

  test('deploy: host key is always checked against the pinned file; no relaxed host key option, no delete', () => {
    const r = deploy(['check', '1.2.3'])
    assert.match(r.calls, /StrictHostKeyChecking=yes/)
    assert.match(r.calls, /UserKnownHostsFile=/)
    assert.ok(!/StrictHostKeyChecking=(no|accept-new)|--delete|-A\b/.test(r.calls))
    const text = readFileSync(join(root, 'scripts/deploy.sh'), 'utf8')
    assert.ok(!/StrictHostKeyChecking=(no|accept-new)|--delete|set -x/.test(text))
  })

  test('deploy: missing setting, odd characters in host, user, path or version stop it before any connection', () => {
    const bad: Record<string, string>[] = [{ ELECTRON_DEPLOY_PATH: '' }, { ELECTRON_DEPLOY_KEY: '' }, { ELECTRON_DEPLOY_HOST: 'a b' }, { ELECTRON_DEPLOY_HOST: '-oProxyCommand=x' }, { ELECTRON_DEPLOY_USER: 'a;b' }, { ELECTRON_DEPLOY_PATH: 'relative' }, { ELECTRON_DEPLOY_PATH: "/srv/a'b" }]
    for (const env of bad) {
      const r = deploy(['check', '1.2.3'], { env })
      assert.equal(r.status, 1, JSON.stringify(env))
      assert.equal(r.calls, '')
    }
    for (const v of ['1.2', '../1.2.3', "1.2.3'; rm -rf /", '']) assert.equal(deploy(['check', v]).status, 1, v)
    assert.equal(deploy(['nope', '1.2.3']).status, 1)
  })

  test('deploy upload: refuses a taken version, needs installers, sends only the five known kinds into the hidden .part folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'klei-up-'))
    assert.equal(deploy(['upload', '1.2.3', dir]).status, 1)
    for (const t of [...FIVE, 'mac-arm64.dmg.blockmap']) writeFileSync(join(dir, `klei-bridal-preview-1.2.3-${t}`), 'x')
    writeFileSync(join(dir, 'klei-bridal-preview-9.9.9-win-x64.exe'), 'x')
    writeFileSync(join(dir, 'other.txt'), 'x')
    assert.equal(deploy(['upload', '1.2.3', dir], { exists: 0 }).status, 1)
    const r = deploy(['upload', '1.2.3', dir])
    assert.equal(r.status, 0)
    assert.match(r.calls, /mkdir -p '\/srv\/klei-releases\/\.1\.2\.3\.part'/)
    assert.match(r.calls, /\.1\.2\.3\.part\/?$/m)
    assert.ok(!/blockmap|9\.9\.9|other\.txt|release\.json/.test(r.calls.replaceAll(dir, '')))
    assert.ok(r.calls.indexOf('mkdir') < r.calls.search(/^(rsync|scp)/m))
  })

  test('deploy finish: wrong file list or checksum stops it before release.json goes up; a good one sends it last, then renames', () => {
    const m = manifestFile()
    const ls = `${m.names.join('\n')}\n`
    const extra = deploy(['finish', '1.2.3', m.path], { ls: ls + 'stray.bin\n' })
    assert.equal(extra.status, 1)
    assert.match(extra.out, /exactly the installers/)
    assert.ok(!/release\.json/.test(extra.calls.replace(/.*ls -A.*\n/, '')))
    assert.equal(deploy(['finish', '1.2.3', m.path], { ls: m.names.slice(1).join('\n') + '\n' }).status, 1)
    const bad = deploy(['finish', '1.2.3', m.path], { ls, sums: 1 })
    assert.equal(bad.status, 1)
    assert.match(bad.out, /differs from its recorded SHA-256/)
    assert.ok(!/^(rsync|scp) /m.test(bad.calls) && !/ mv /.test(bad.calls))
    assert.equal(deploy(['finish', '1.2.3', m.path], { ls, exists: 0 }).status, 1)
    const ok = deploy(['finish', '1.2.3', m.path], { ls })
    assert.equal(ok.status, 0, ok.out)
    const at = (re: RegExp) => ok.calls.search(re)
    assert.ok(at(/sha256sum -c/) > 0 && at(/sha256sum -c/) < at(/^(rsync|scp) /m) && at(/^(rsync|scp) /m) < at(/ mv '\/srv\/klei-releases\/\.1\.2\.3\.part' '\/srv\/klei-releases\/1\.2\.3'/))
    assert.match(ok.calls, new RegExp(`${'0'.repeat(64)}  ${m.names[0]}`))
  })

  test('deploy finish: a file named release.json is required; any other file name is refused', () => {
    const m = manifestFile()
    const other = join(dirname(m.path), 'x.json')
    writeFileSync(other, readFileSync(m.path))
    assert.equal(deploy(['finish', '1.2.3', other]).status, 1)
    assert.equal(deploy(['finish', '1.2.3', join(dirname(m.path), 'missing.json')]).status, 1)
  })
}
