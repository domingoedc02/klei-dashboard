// Throwaway spike 4b: does main-process networking leave the sentinel on disk? SPIKE_MODE=net|node
import { app, net, session } from 'electron'
import http from 'node:http'
app.setPath('userData', process.env.SPIKE_USERDATA)
app.setPath('sessionData', process.env.SPIKE_USERDATA)
const S = process.env.SPIKE_SENTINEL
const api = http.createServer((_q, res) => res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600', ETag: '"v1"' }).end(JSON.stringify({ customer: S })))
app.whenReady().then(async () => {
  await new Promise((r) => api.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${api.address().port}/api.json`
  const f = { net: net.fetch, node: fetch, netmem: (u) => session.fromPartition('mem').fetch(u), netnostore: (u) => net.fetch(u, { cache: 'no-store' }) }[process.env.SPIKE_MODE]
  for (let i = 0; i < 2; i++) await (await f(url)).text()
  await new Promise((r) => setTimeout(r, 2500))
  api.close(); app.quit()
})
