// Parity harness, baseline side (story 14.2). Reuses desktop/scripts/shots/* read-only; writes only under electron/parity-out/<side>/.
// Usage: node electron/test/parity/harness.mjs --side baseline [--renderer baseline|electron] [--only <id-state substring>] [--renderer-url <url>] [--out <dir>]
// Not used on purpose: the shared writers and output path of the original capture (they write into docs/planning-artifacts/ui-parity) and its Vite launcher (starts inside desktop/).
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { serveRenderer } from './serve-renderer.mjs'

const REPO = fileURLToPath(new URL('../../../', import.meta.url))
const SHOTS = join(REPO, 'desktop/scripts/shots')
const desktopRequire = createRequire(join(REPO, 'electron/package.json'))
const { chromium } = desktopRequire('@playwright/test')
const load = (f) => import(pathToFileURL(join(SHOTS, f)).href)

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i < 0 ? dflt : process.argv[i + 1]
}

// Same fixtures, but through the Electron alias: window.klei.<command> forwards to the fixture handler, as the preload will in Electron.
async function installKleiShim(page, handler, log) {
  await page.exposeFunction('__fx', async (cmd, args) => {
    try { return { ok: await handler(cmd, args) } } catch (e) { log(`handler threw for ${cmd}: ${e}`); return { err: { kind: 'failed', message: String(e) } } }
  })
  await page.addInitScript(() => {
    const run = async (cmd, args, onEvent) => {
      const r = await window.__fx(cmd, JSON.parse(JSON.stringify(args)))
      if (r.err) throw r.err
      const v = r.ok
      if (v && v.__reject) throw v.__reject
      if (v && v.__events) { v.__events.forEach((m) => onEvent && onEvent(m)); return v.value }
      return v
    }
    window.klei = {
      api_request: (request) => run('api_request', { request }),
      sign_in: () => run('sign_in', {}), sign_out: () => run('sign_out', {}), session_only: () => run('session_only', {}),
      set_dirty: (dirty) => run('set_dirty', { dirty }), check_update: () => run('check_update', {}), install_update: () => run('install_update', {}),
      upload_files: (kind, targetId, onEvent) => run('upload_files', { kind, targetId, onEvent: '__CHANNEL__:0' }, onEvent),
      export_gowns: (kind, ids, onEvent) => run('export_gowns', { kind, ids, onEvent: '__CHANNEL__:0' }, onEvent),
    }
  })
}

export async function captureBaseline({ wanted = '', rendererUrl, outDir, renderer = 'baseline' }) {
  const { SCREENS, name } = await load('screens.mjs')
  const { NOW, makeHandler, routes, imgSvg } = await load('fixtures.mjs')
  const { installShim } = await load('tauri-shim.mjs')
  const { probe } = await load('probe.mjs')
  const { settle, VIEWPORT } = await load('common.mjs')

  const dir = join(outDir, renderer)
  await mkdir(dir, { recursive: true })
  const served = rendererUrl ? { url: rendererUrl, close() {} } : await serveRenderer(join(REPO, renderer === 'electron' ? 'electron/build/renderer' : 'electron/build/baseline-renderer'))
  const record = { geometry: {}, copy: {} }
  const failures = []
  const browser = await chromium.launch({ args: ['--disable-gpu', '--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb', '--num-raster-threads=1', '--disable-partial-raster'] })
  try {
    for (const s of SCREENS.filter((x) => x.desk && name(x).includes(wanted))) {
      const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion: 'reduce' })
      const page = await ctx.newPage()
      const notes = []
      page.on('pageerror', (e) => notes.push(`pageerror ${e}`))
      page.on('console', (m) => m.type() === 'error' && notes.push(`console ${m.text()}`))
      await page.route('klei-img://**', (r) => r.fulfill({ contentType: 'image/svg+xml', body: imgSvg(r.request().url()) }))
      try {
        const table = routes()
        s.desk.fx?.(table)
        await (renderer === 'electron' ? installKleiShim : installShim)(page, makeHandler(table, (m) => notes.push(m)), (m) => notes.push(m))
        await page.clock.setFixedTime(NOW)
        await page.goto(`${served.url}/${s.desk.hash}`, { waitUntil: 'domcontentloaded' })
        await page.waitForSelector(s.desk.ready ?? '.app', { timeout: 15000 })
        await s.desk.after?.(page)
        await page.mouse.move(VIEWPORT.width - 1, VIEWPORT.height - 1)
        await settle(page)
        const res = await probe(page)
        record.geometry[name(s)] = res.issues
        record.copy[name(s)] = res.text
        await page.screenshot({ path: join(dir, `${name(s)}.png`) })
        const bad = notes.filter((n) => !n.startsWith('console Failed to load resource'))
        if (bad.length) failures.push(`${name(s)}: ${bad.join(' | ')}`)
      } catch (e) {
        failures.push(`${name(s)}: ${String(e.message).split('\n')[0]}`)
      }
      await ctx.close()
    }
  } finally {
    await browser.close()
    served.close()
  }
  await writeFile(join(dir, 'probe.json'), JSON.stringify(record, null, 1))
  return { failures, count: Object.keys(record.geometry).length }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (arg('side', 'baseline') !== 'baseline') {
    console.error('Only --side baseline runs now. The Electron side is wired in electron-side.mjs and switched on in story 20.1.')
    process.exit(2)
  }
  const outDir = arg('out', join(REPO, 'electron/parity-out'))
  const renderer = arg('renderer', 'baseline')
  const { failures, count } = await captureBaseline({ wanted: arg('only', ''), rendererUrl: arg('renderer-url'), outDir, renderer })
  console.log(`${count} states captured in ${join(outDir, renderer)}`)
  if (failures.length) {
    console.error(`${failures.length} state(s) with errors:\n${failures.join('\n')}`)
    process.exit(1)
  }
}
