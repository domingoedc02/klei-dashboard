import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Config } from '../src/main/config.ts'

export interface Req { method: string; path: string; auth: string; ifMatch: string; idem: string; body: unknown; ct: string; raw: string }
export type Reply = [status: number, body?: unknown] | 'close'

/** Scripted backend on a random loopback port; `handler` sees each request and the 1-based count of that path. */
export async function mock(handler: (r: Req, n: number) => Reply | Promise<Reply>) {
  const log: Req[] = []
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const raw = Buffer.concat(chunks).toString('utf8')
    const h = req.headers
    const r: Req = {
      method: req.method!, path: req.url!, auth: String(h.authorization ?? ''), ifMatch: String(h['if-match'] ?? ''), idem: String(h['idempotency-key'] ?? ''),
      body: raw && String(h['content-type'] ?? '').includes('json') ? JSON.parse(raw) : null, ct: String(h['content-type'] ?? ''), raw,
    }
    log.push(r)
    const out = await handler(r, log.filter((x) => x.path === r.path).length)
    if (out === 'close') return void req.socket.destroy()
    const [status, body] = out
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(body === undefined ? '' : JSON.stringify(body))
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  return {
    api: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    log,
    count: (path: string) => log.filter((r) => r.path === path).length,
    close: () => server.closeAllConnections() ?? server.close(),
  }
}

export const pair = (access: string, refresh: string) => ({ accessToken: access, refreshToken: refresh, expiresIn: 900 })

export const cfg = (api: string, over: Partial<Config> = {}): Config => ({
  api, auth: 'http://127.0.0.1:1', signInTimeoutMs: 5000, requestTimeoutMs: 5000, uploadTimeoutMs: 5000, retryDelayMs: 50, smoke: false, ...over,
})
