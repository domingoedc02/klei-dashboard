// Electron side of the parity run (story 20.1): the built app on a throwaway profile, against a loopback mock API that answers the same fixture table as the baseline side.
// Writes only under electron/parity-out/app[-WxH]/ (same <id>-<state>.png names and probe.json as the baseline side), plus skipped.json with the reason for every state not captured.
// The app is copied to a temp folder so build-config.json can point at the mock; the original build/ is never touched. Sign-in goes through the real sign_in command; only shell.openExternal is stubbed (it plays the browser's part).
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = fileURLToPath(new URL('../../../', import.meta.url))
const SHOTS = join(REPO, 'desktop/scripts/shots')
const req = createRequire(join(REPO, 'electron/package.json'))
const { _electron } = req('@playwright/test')
const electronBin = req('electron')
const load = (f) => import(pathToFileURL(join(SHOTS, f)).href)
const TOKEN = 'x'.repeat(43)

// Same switches as the baseline browser, plus fixed scale and no scrollbars (Playwright adds both to headless Chromium on its own).
const FLAGS = ['--disable-gpu', '--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb', '--num-raster-threads=1', '--disable-partial-raster', '--force-device-scale-factor=1', '--hide-scrollbars']

/** What the fixture table asks for, as something the real app can be made to do over HTTP; or why it cannot. */
export function plan(table) {
  const p = { out: false, me: 'ok', auth: 'ok', signin: 'ok', latest: '0.0.0' }
  if (table['cmd upload_files']) return { skip: 'native file dialog (17.1, uploads.test.ts)' }
  if (table['cmd install_update']) return { skip: 'Tauri signed-update install replaced by the manual download page (18.3, update.test.ts)' }
  if (table['cmd check_update']?.status === 'available') p.latest = table['cmd check_update'].version
  const rej = table['cmd api_request']?.__reject?.kind
  if (rej === 'signed_out') p.out = true
  else if (rej === 'unreachable') p.me = 'down'
  else if (rej === 'session_expired') p.auth = 'expired'
  else if (rej === 'no_access') p.auth = 'noaccess'
  else if (rej) return { skip: `${rej} needs a broken OS credential store (keychain.test.ts, session-signin.test.ts)` }
  const si = table['cmd sign_in']
  if (si) { p.out = true; p.signin = typeof si === 'function' ? 'hang' : 'bad' }
  return p
}

async function startMock(state) {
  const srv = createServer(async (rq, res) => {
    const chunks = []
    for await (const c of rq) chunks.push(c)
    const raw = Buffer.concat(chunks).toString('utf8')
    const send = (status, body, type = 'application/json') => {
      const empty = status === 204 || body === null || body === undefined
      res.writeHead(status, { 'content-type': type }).end(empty ? '' : type === 'application/json' ? JSON.stringify(body) : body)
    }
    try {
      const path = rq.url.split('?')[0]
      if (path === '/__signin') return send(200, state.signin, 'text/plain')
      if (path === '/__img') return send(200, state.imgSvg(new URL(rq.url, 'http://x').searchParams.get('u')), 'image/svg+xml')
      if (path === `/${TOKEN}/latest.json`) return send(200, { version: state.latest })
      if (path === '/api/v1/auth/token') return send(200, { accessToken: `fx-access-${++state.n}`, refreshToken: 'fx-refresh', expiresIn: 900 })
      if (path === '/api/v1/auth/refresh') return state.auth === 'expired' ? send(401, null) : state.auth === 'noaccess' ? send(403, null) : send(200, { accessToken: `fx-access-${++state.n}`, refreshToken: 'fx-refresh', expiresIn: 900 })
      if (path === '/api/v1/auth/logout') return send(200, {})
      if (path === '/api/v1/me' && state.me === 'down') return rq.socket.destroy()
      if (path === '/api/v1/me' && state.auth !== 'ok') return send(401, null)
      const request = { method: rq.method, path: rq.url, body: raw ? JSON.parse(raw) : null, ifMatch: rq.headers['if-match'] ?? null, idempotencyKey: rq.headers['idempotency-key'] ?? null }
      const r = await state.handler('api_request', { request })
      send(r.status, r.body)
    } catch (e) {
      state.notes.push(`mock ${String(e).split('\n')[0]}`)
      send(500, null)
    }
  })
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok))
  return { origin: `http://127.0.0.1:${srv.address().port}`, close: () => { srv.closeAllConnections(); srv.close() } }
}

/** `size` is the page's inner size, `WxH`. Output goes to <outDir>/app (or app-<size> when it is not the default). */
export async function captureApp({ wanted = '', outDir, size = '1440x900' }) {
  const { SCREENS, name } = await load('screens.mjs')
  const { NOW, makeHandler, routes, imgSvg } = await load('fixtures.mjs')
  const { probe } = await load('probe.mjs')
  const { FREEZE_CSS } = await load('common.mjs')
  const [W, H] = size.split('x').map(Number)
  const dir = join(outDir, size === '1440x900' ? 'app' : `app-${size}`)
  await mkdir(dir, { recursive: true })

  const tmp = mkdtempSync(join(tmpdir(), 'klei-parity-'))
  const state = { handler: null, imgSvg, signin: 'ok', auth: 'ok', me: 'ok', latest: '0.0.0', n: 0, notes: [] }
  const mock = await startMock(state)
  for (const d of ['main', 'shared', 'preload', 'renderer']) cpSync(join(REPO, 'electron/build', d), join(tmp, 'build', d), { recursive: true })
  // The app is started by folder, so app.getVersion() is this 0.0.0 (a file argument would report Electron's own version, and 1.2.0 would not look newer).
  writeFileSync(join(tmp, 'build/package.json'), '{"type":"commonjs"}')
  writeFileSync(join(tmp, 'package.json'), '{"name":"klei-parity","version":"0.0.0","main":"build/main/index.js"}')
  writeFileSync(join(tmp, 'build/main/build-config.json'), JSON.stringify({ api: mock.origin, auth: `${mock.origin}/auth`, download: `${mock.origin}/${TOKEN}` }))
  symlinkSync(join(REPO, 'electron/node_modules'), join(tmp, 'node_modules'))

  const record = { geometry: {}, copy: {} }
  const skipped = {}
  const meta = { size, electron: process.versions.electron ?? null, platform: process.platform, arch: process.arch, emulated: false }
  const failures = []
  const app = await _electron.launch({ executablePath: electronBin, args: [...FLAGS, tmp], cwd: tmp, env: { ...process.env, KLEI_USER_DATA: join(tmp, 'profile'), KLEI_SMOKE: '' } })
  try {
    // The browser's part of sign-in, and fixture pictures for klei-img://: neither changes what the app does with them.
    await app.evaluate(({ shell, session, BrowserWindow }, [origin, w, h]) => {
      shell.openExternal = async (url) => {
        if (!url.startsWith(`${origin}/auth/authorize`)) return
        const mode = await (await fetch(`${origin}/__signin`)).text()
        if (mode === 'hang') return
        const u = new URL(url)
        const cb = new URL(u.searchParams.get('redirect'))
        cb.searchParams.set('code', 'fixture-code')
        cb.searchParams.set('state', mode === 'bad' ? 'wrong' : u.searchParams.get('state'))
        setTimeout(() => fetch(cb).catch(() => {}), 20)
      }
      const p = session.fromPartition('klei').protocol
      p.unhandle('klei-img')
      p.handle('klei-img', async (rq) => new Response(await (await fetch(`${origin}/__img?u=${encodeURIComponent(rq.url)}`)).arrayBuffer(), { headers: { 'content-type': 'image/svg+xml' } }))
      BrowserWindow.getAllWindows()[0].setContentSize(w, h)
    }, [mock.origin, W, H])
    meta.version = await app.evaluate(({ app }) => app.getVersion())
    const page = await app.firstWindow()
    await page.context().clock.setFixedTime(NOW)
    const notes = []
    page.on('pageerror', (e) => notes.push(`pageerror ${e}`))
    page.on('console', (m) => m.type() === 'error' && notes.push(`console ${m.text()}`))
    await page.waitForSelector('.app, .screen, .auth-card', { timeout: 15000 })
    // A window cannot be taller than the display: then the page is sized by emulation, like the baseline side, and meta.json says so.
    const real = await page.evaluate(() => `${innerWidth}x${innerHeight}`)
    meta.emulated = real !== size
    if (meta.emulated) await (await page.context().newCDPSession(page)).send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false })
    let signedIn = false
    for (const s of SCREENS.filter((x) => x.desk && name(x).includes(wanted))) {
      notes.length = 0
      state.notes.length = 0
      try {
        const table = routes()
        s.desk.fx?.(table)
        const p = plan(table)
        if (p.skip) { skipped[name(s)] = p.skip; continue }
        state.handler = makeHandler(routes(), () => {})
        state.auth = 'ok'; state.me = 'ok'; state.signin = 'ok'
        if (p.out && signedIn) { await page.evaluate(() => window.klei.sign_out()); signedIn = false }
        if (!p.out && !signedIn) { await page.evaluate(() => window.klei.sign_in()); signedIn = true }
        Object.assign(state, { signin: p.signin, latest: p.latest })
        // Moving the old page to the new route fires requests of its own (a hash change keeps the old page's state); the quiet handler takes those, then a reload gives the state a clean page like the baseline's fresh context.
        await page.reload({ waitUntil: 'load' })
        await page.evaluate((h) => { location.hash = h }, s.desk.hash)
        await page.waitForTimeout(400)
        state.notes.length = 0
        state.handler = makeHandler(table, (m) => state.notes.push(m))
        // The failure is switched on only now: the quiet reload above would otherwise use it up (a refused refresh signs the app out, and the next boot shows no reason).
        Object.assign(state, { auth: p.auth, me: p.me })
        if (p.auth !== 'ok') signedIn = false
        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.waitForSelector(s.desk.ready ?? '.app', { timeout: 15000 })
        await s.desk.after?.(page)
        await page.mouse.move(W - 1, H - 1)
        // addStyleTag would be refused by the app's CSP (as it should); insertCSS from main is not subject to it.
        await app.evaluate(({ BrowserWindow }, css) => BrowserWindow.getAllWindows()[0].webContents.insertCSS(css), FREEZE_CSS)
        await page.evaluate(async () => {
          document.activeElement?.blur?.()
          const t = document.getElementById('toasts')
          if (t) t.innerHTML = ''
          await document.fonts.ready
        })
        await page.waitForTimeout(80)
        const inner = await page.evaluate(() => `${innerWidth}x${innerHeight}`)
        if (inner !== size) throw new Error(`window is ${inner}, wanted ${size}`)
        const res = await probe(page)
        record.geometry[name(s)] = res.issues
        record.copy[name(s)] = res.text
        await page.screenshot({ path: join(dir, `${name(s)}.png`), scale: 'css' })
        const bad = [...notes, ...state.notes].filter((n) => !n.startsWith('console Failed to load resource'))
        if (bad.length) failures.push(`${name(s)}: ${bad.join(' | ')}`)
      } catch (e) {
        failures.push(`${name(s)}: ${String(e.message).split('\n')[0]}`)
      }
    }
  } finally {
    await app.close().catch(() => {})
    mock.close()
    rmSync(tmp, { recursive: true, force: true })
  }
  await writeFile(join(dir, 'probe.json'), JSON.stringify(record, null, 1))
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 1))
  await writeFile(join(dir, 'skipped.json'), JSON.stringify(skipped, null, 1))
  return { failures, count: Object.keys(record.geometry).length, skipped: Object.keys(skipped).length, dir }
}
