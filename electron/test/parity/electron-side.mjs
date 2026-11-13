// Electron side of the parity run (story 14.2). DISABLED until story 20.1: it needs the shell (15), the commands (16, 17) and a mock HTTP API.
// Shape only, so that harness.mjs and compare.mjs have a fixed counterpart. Calling run() before 20.1 throws.
export const ENABLED = false

/**
 * Plan for 20.1:
 *  - start a loopback HTTP server that answers the same routes() table as desktop/scripts/shots/fixtures.mjs (identical bodies, or the comparison means nothing),
 *  - launch the packaged or built app with Playwright `_electron.launch({ args, env: { KLEI_API_BASE: <that server> } })`,
 *  - for each SCREENS entry with a `desk` driver: apply `fx`, load `hash`, wait for `ready`, run `after`, park the pointer, settle, probe, screenshot
 *    to electron/parity-out/electron/<id>-<state>.png and probe.json (same names as the baseline side),
 *  - also capture the native default 1280x800 and minimum 1100x700 window sizes.
 */
export async function run() {
  if (!ENABLED) throw new Error('electron-side parity is switched on in story 20.1')
}
