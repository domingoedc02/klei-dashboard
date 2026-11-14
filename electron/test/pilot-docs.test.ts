import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const guide = readFileSync(`${ROOT}electron/INSTALL-PREVIEW.md`, 'utf8')
const pilot = readFileSync(`${ROOT}docs/planning-artifacts/electron-migration/evidence/pilot.md`, 'utf8')

test('pilot guide: install, OS warning steps, switching back, reporting, data shared, removal', () => {
  for (const h of ['## Install', '## Switching back', '## Reporting a problem', '## Who sees what', '## Removing the preview']) assert.ok(guide.includes(h), h)
  for (const re of [/Open Anyway/, /More info/, /Run anyway/, /telemetry/i, /co\.klei\.bridal\.electron\.preview/, /lost or duplicated|shown twice/i]) assert.match(guide, re)
})

test('pilot guide: leaves the Tauri entry alone and carries no URL or token', () => {
  assert.match(guide, /Do not delete anything named `co\.klei\.bridal`/)
  assert.ok(!/https?:\/\//.test(guide))
  assert.ok(!/[A-Za-z0-9_-]{40,}/.test(guide))
})

test('pilot record: template is NOT RUN, with the stop condition and the owning-story column', () => {
  assert.match(pilot, /Status: NOT RUN/)
  assert.match(pilot, /Owning story/)
  assert.match(pilot, /lost or duplicated business data/)
  assert.ok(!/cutover.*(PASS|approved)/i.test(pilot.replace(/cutover record cannot be PASS/g, '')))
})
