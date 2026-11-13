import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { BridgeError } from '../shared/errors.ts'

const b64 = (b: Buffer) => b.toString('base64url')

export const challengeFor = (verifier: string) => b64(createHash('sha256').update(verifier).digest())

/** 32 random bytes give a 43-character verifier, the shortest RFC 7636 allows. */
export function generatePkce() {
  const verifier = b64(randomBytes(32))
  return { verifier, challenge: challengeFor(verifier) }
}

/** 24 bytes give 32 characters, inside the backend's `[A-Za-z0-9._~-]{16,128}`. */
export const generateState = () => b64(randomBytes(24))

/** Where the browser returns after sign-in. `stop` is called when the wait ends, whatever the outcome. */
export interface Redirect { uri: string; stop(): void }
export type StartRedirect = (complete: (url: URL) => Promise<void>) => Promise<Redirect>

const OK_PAGE = "You're signed in. You can return to Klei Bridal."
const FAILED_PAGE = "Sign-in didn't finish. Return to Klei Bridal and try again."
const MIN_PORT = 1024 // the backend accepts loopback redirects on ports 1024 to 65535 only

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
  })
}

/**
 * Redirect target for platforms where the `klei` scheme must stay unclaimed. Answers until the one GET /callback arrives,
 * then closes. Empty speculative browser connections never reach the handler; other paths get 404 and keep it open.
 */
export const loopbackRedirect: StartRedirect = async (complete) => {
  const server = createServer({ maxHeaderSize: 8192 }, (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const send = (status: number, text: string) => {
      res.writeHead(status, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'",
        connection: 'close',
      })
      res.end(`<!doctype html><meta charset=utf-8><title>Klei Bridal</title><p>${text}</p>`)
    }
    if (req.method !== 'GET' || url.pathname !== '/callback') return send(404, 'Not found')
    complete(url).then(() => true, () => false).then((ok) => {
      send(200, ok ? OK_PAGE : FAILED_PAGE)
      stop()
    })
  })
  server.headersTimeout = 5000
  const stop = () => {
    server.close()
    server.closeIdleConnections()
  }
  let port = 0
  for (let i = 0; i < 10 && port < MIN_PORT; i++) {
    try {
      port = await listen(server)
    } catch {
      throw new BridgeError('failed', 'no loopback port')
    }
    if (port < MIN_PORT) await new Promise((ok) => server.close(ok))
  }
  if (port < MIN_PORT) throw new BridgeError('failed', 'no loopback port')
  return { uri: `http://127.0.0.1:${port}/callback`, stop }
}
