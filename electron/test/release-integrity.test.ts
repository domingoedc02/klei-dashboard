import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

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
