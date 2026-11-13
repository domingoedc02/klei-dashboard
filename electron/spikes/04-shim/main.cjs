const { app, BrowserWindow, ipcMain, protocol, session } = require('electron')
const { readFileSync, existsSync } = require('node:fs')
const { join, extname, resolve } = require('node:path')
const ROOT = resolve(__dirname, '../../build/spike04')
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
const log = []
const reply = (name, args) => {
  if (name === 'api_request') return args[0].path === '/boom' ? Promise.reject({ kind: 'no_access', message: 'denied' }) : { status: 200, body: { echo: args[0] } }
  if (name === 'set_dirty') return null
  return { name, args }
}
app.whenReady().then(async () => {
  const ses = session.fromPartition('spike04')
  ses.protocol.handle('app', (req) => {
    const u = new URL(req.url)
    if (u.pathname === '/test.html') return new Response('<!doctype html><meta charset=utf-8><script src="/test.js"></script>', { headers: { 'content-type': 'text/html' } })
    const p = resolve(join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname))
    if (!p.startsWith(ROOT) || !existsSync(p)) return new Response(null, { status: 404 })
    return new Response(readFileSync(p), { headers: { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' } })
  })
  for (const n of ['api_request', 'sign_in', 'sign_out', 'session_only', 'set_dirty', 'check_update', 'install_update'])
    ipcMain.handle('klei:' + n, async (_e, ...a) => { log.push([n, a]); try { return { ok: await reply(n, a) } } catch (x) { return { err: { kind: x.kind ?? 'failed', message: x.message ?? String(x) } } } })
  for (const n of ['upload_files', 'export_gowns'])
    ipcMain.handle('klei:' + n, async (e, kind, x, id) => {
      log.push([n, [kind, x]])
      const count = kind === 'many' ? 500 : 3
      for (let i = 0; i < count; i++) e.sender.send('klei:ev:' + id, { index: i, message: { type: 'progress', done: i + 1, total: count } })
      e.sender.send('klei:ev:' + id, { end: true, index: count })
      return { ok: { stored: ['p1'], rejected: [], cancelled: false } }
    })
  const win = new BrowserWindow({ show: false, webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, session: ses } })
  win.webContents.on('page-title-updated', (_e, t) => { if (t.startsWith('{')) { console.log(t); console.log('main saw', JSON.stringify(log)); app.quit() } })
  setTimeout(() => { console.log('TIMEOUT'); app.exit(3) }, 30000)
  win.loadURL('app://klei/test.html')
})
