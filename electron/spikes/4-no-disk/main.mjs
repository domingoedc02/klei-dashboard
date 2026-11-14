// Throwaway spike 4: does the planned webPreferences leave business content on disk? MODE=default|hardened
import { app, BrowserWindow, protocol, session } from 'electron'
import http from 'node:http'

const MODE = process.env.SPIKE_MODE, S = process.env.SPIKE_SENTINEL
app.setName(`klei-spike4-${MODE}`)
app.setPath('userData', process.env.SPIKE_USERDATA)
app.setPath('sessionData', process.env.SPIKE_USERDATA)
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

const api = http.createServer((req, res) => {
  const h = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600', ETag: '"v1"' }
  if (req.url === '/api.json') res.writeHead(200, { ...h, 'Content-Type': 'application/json' }).end(JSON.stringify({ customer: S, note: 'api body' }))
  else if (req.url === '/img.svg') res.writeHead(200, { ...h, 'Content-Type': 'image/svg+xml' }).end(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><text y="20">${S}</text></svg>`)
  else res.writeHead(404).end()
})

const PAGE = (port) => `<!doctype html><meta charset=utf-8><body><img id=i><script>
(async () => {
  const j = await (await fetch('http://127.0.0.1:${port}/api.json')).json()
  document.getElementById('i').src = 'http://127.0.0.1:${port}/img.svg'
  await new Promise((r) => (document.getElementById('i').onload = document.getElementById('i').onerror = r))
  localStorage.setItem('k', j.customer)
  await new Promise((r) => { const q = indexedDB.open('s'); q.onupgradeneeded = () => q.result.createObjectStore('o'); q.onsuccess = () => { const t = q.result.transaction('o', 'readwrite'); t.objectStore('o').put(j.customer, 'k'); t.oncomplete = r } })
  document.title = 'done'
})()
</script>`

app.whenReady().then(async () => {
await new Promise((r) => api.listen(0, '127.0.0.1', r))
const port = api.address().port
const ses = MODE === 'hardened' ? session.fromPartition('klei-mem') : session.defaultSession
ses.protocol.handle('app', () => new Response(PAGE(port), { headers: { 'content-type': 'text/html' } }))
const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, session: ses } })
win.webContents.on('page-title-updated', async (_e, t) => {
  if (t !== 'done') return
  await new Promise((r) => setTimeout(r, 2500))
  api.close()
  app.quit()
})
setTimeout(() => { console.error('timeout'); app.exit(3) }, 30000)
win.loadURL('app://klei/')
})
