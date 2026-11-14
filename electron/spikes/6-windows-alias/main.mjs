// Throwaway spike 6: http://klei-img.localhost alias from the app:// renderer, CSP img-src single origin, fail-closed protocol.handle('http').
import { app, BrowserWindow, protocol, session } from 'electron'
import http from 'node:http'

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
const CSP = "default-src 'self'; img-src 'self' http://klei-img.localhost data:; connect-src 'none'; style-src 'self'; script-src 'self'; font-src 'self'"
const svg = (t) => `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><text>${t}</text></svg>`
const seen = [], realHits = []

const real = http.createServer((req, res) => { realHits.push(req.url); res.writeHead(200, { 'Content-Type': 'image/svg+xml' }).end(svg('REAL NETWORK')) })

app.whenReady().then(async () => {
  await new Promise((r) => real.listen(0, '127.0.0.1', r))
  const port = real.address().port
  const ses = session.fromPartition('spike6')
  ses.protocol.handle('http', (req) => {
    const u = new URL(req.url)
    seen.push(`${req.method} ${req.url}`)
    if (req.method === 'GET' && u.hostname === 'klei-img.localhost' && !u.port && /^\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+(\/full)?$/.test(u.pathname))
      return new Response(svg(u.pathname), { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' } })
    return new Response(null, { status: 403 })
  })
  ses.protocol.handle('https', () => new Response(null, { status: 403 }))
  ses.protocol.handle('app', (req) => {
    if (new URL(req.url).pathname === '/') return new Response(PAGE(), { headers: { 'content-type': 'text/html', 'content-security-policy': CSP } })
    if (new URL(req.url).pathname === '/probe.js') return new Response(SCRIPT(port), { headers: { 'content-type': 'text/javascript' } })
    return new Response(null, { status: 404 })
  })
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, session: ses } })
  win.webContents.on('page-title-updated', async (_e, t) => {
    if (!t.startsWith('{')) return
    const page = JSON.parse(t)
    const direct = await ses.fetch(`http://127.0.0.1:${port}/direct.svg`).then((r) => `status ${r.status}`, (e) => `rejected ${e.message}`)
    const alias = await ses.fetch('http://klei-img.localhost/b/p').then(async (r) => `status ${r.status} ${await r.text()}`, (e) => `rejected ${e.message}`)
    console.log(JSON.stringify({ page, mainProcessFetch: { directToRealServer: direct, alias }, handlerSaw: seen, realServerHits: realHits }, null, 1))
    real.close(); app.quit()
  })
  setTimeout(() => { console.error('timeout'); app.exit(3) }, 30000)
  win.loadURL('app://klei/')
})

const PAGE = () => '<!doctype html><meta charset=utf-8><body><script src="/probe.js"></script>'
const SCRIPT = (port) => `
const probe = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res('loaded'); i.onerror = () => res('blocked/failed'); i.src = src })
;(async () => {
  const out = {}
  out.alias = await probe('http://klei-img.localhost/b/p')
  out.aliasFull = await probe('http://klei-img.localhost/g/gown-1/full')
  out.badPath = await probe('http://klei-img.localhost/../etc/passwd')
  out.otherLocalhost = await probe('http://other.localhost/b/p')
  out.realServer = await probe('http://127.0.0.1:${port}/real.svg')
  out.aliasWithPort = await probe('http://klei-img.localhost:${port}/b/p')
  out.https = await probe('https://klei-img.localhost/b/p')
  out.fetchAlias = await fetch('http://klei-img.localhost/b/p').then(() => 'allowed', () => 'blocked')
  out.fetchReal = await fetch('http://127.0.0.1:${port}/x').then(() => 'allowed', () => 'blocked')
  document.title = JSON.stringify(out)
})()
`
