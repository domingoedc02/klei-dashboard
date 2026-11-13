// Port of desktop/src-tauri/src/session.rs (token state, request path). Sign-in and sign-out arrive with 16.3/16.4.
import { BridgeError } from '../shared/errors.ts'
import type { ApiCall } from '../shared/commands.ts'
import type { ApiResponse } from '../shared/events.ts'
import type { Config } from './config.ts'
import { generatePkce, generateState, type StartRedirect } from './auth.ts'
import type { Keychain } from './keychain.ts'

const HEALTH = '/health/ready'

// Test connection makes up to three provider calls of 60 s each on the backend, and loading models one call plus a retry; every other call keeps the short limit.
// shortcut: slow paths by name, upgrade to a per-call option when a third slow call exists.
const SLOW_PATHS = ['/api/v1/admin/ai/test', '/api/v1/admin/ai/models']
const SLOW_TIMEOUT_MS = 200_000

export const timeoutFor = (path: string, defaultMs: number) => (SLOW_PATHS.includes(path) ? Math.max(SLOW_TIMEOUT_MS, defaultMs) : defaultMs)

const failed = (msg: string) => new BridgeError('failed', msg)
const badPath = () => new BridgeError('bad_request', 'path must stay under /api/v1/')
const guard = async <T>(f: () => Promise<T>): Promise<T> => {
  try {
    return await f()
  } catch {
    throw new BridgeError('keychain_unavailable', 'keychain unavailable')
  }
}

export function checkPath(p: string): void {
  if (!(p.startsWith('/api/v1/') && !p.includes('..') && !p.includes('//') && /^[\x21-\x7e]+$/.test(p) && !p.includes('\\'))) throw badPath()
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
export function parseMethod(m: string): string {
  const up = m.toUpperCase()
  if (!METHODS.includes(up)) throw new BridgeError('bad_request', 'method not allowed')
  return up
}

/** What a call sends besides the headers: nothing, JSON, or one multipart `file` part; each with its Idempotency-Key (empty: none). */
export type Payload = { json: unknown; key: string } | { file: { name: string; bytes: Buffer<ArrayBuffer> }; key: string } | null

export interface Raw { status: number; bytes: Buffer }

const parseJson = (bytes: Buffer): unknown => {
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch {
    return null
  }
}

interface TokenPair { accessToken: string; refreshToken: string }
const parsePair = (body: unknown): TokenPair => {
  const b = body as Partial<TokenPair> | null
  if (typeof b === 'object' && b !== null && typeof b.accessToken === 'string' && b.accessToken !== '' && typeof b.refreshToken === 'string' && b.refreshToken !== '') {
    return { accessToken: b.accessToken, refreshToken: b.refreshToken }
  }
  throw failed('bad token response')
}

const DEEP_LINK: StartRedirect = async () => ({ uri: 'klei://auth/callback', stop() {} })

export interface SessionOptions {
  /** Hands the authorize URL to the system browser; main builds that URL, never the page. */
  open?: (url: string) => void
  redirect?: StartRedirect
}

interface Pending { verifier: string; state: string; resolve(): void; reject(e: BridgeError): void }

const isTimeout = (e: unknown) => (e as { name?: unknown } | null)?.name === 'TimeoutError'

/** Token state of the signed-in User. The access token lives in memory only; the refresh token only in the keychain. */
export class Session {
  readonly cfg: Config
  readonly keychain: Keychain
  #access: string | null = null
  #gate: Promise<unknown> = Promise.resolve()
  #dirty = false
  #pending: Pending | null = null
  readonly #open: (url: string) => void
  readonly #redirect: StartRedirect
  readonly #origin: string
  readonly #prefix: string

  constructor(cfg: Config, keychain: Keychain, { open = () => {}, redirect = DEEP_LINK }: SessionOptions = {}) {
    this.cfg = cfg
    this.keychain = keychain
    this.#open = open
    this.#redirect = redirect
    const base = new URL(cfg.api)
    this.#origin = base.origin
    this.#prefix = `${base.pathname.replace(/\/+$/, '')}/api/v1/`
  }

  /** Opens the system browser and waits for the callback. A second call supersedes the wait in progress, which ends as `cancelled`; `signOut` cancels it too. */
  async signIn(): Promise<void> {
    await guard(() => this.keychain.load())
    const { verifier, challenge } = generatePkce()
    const state = generateState()
    const redirect = await this.#redirect((url) => this.complete(url))
    let timer: NodeJS.Timeout | undefined
    const wait = new Promise<void>((resolve, reject) => {
      this.#cancelPending()
      this.#pending = { verifier, state, resolve, reject }
      timer = setTimeout(() => {
        if (this.#pending?.state === state) this.#pending = null
        reject(new BridgeError('timeout', 'sign-in timed out'))
      }, this.cfg.signInTimeoutMs)
    })
    const url = new URL(`${this.cfg.auth}/authorize`)
    for (const [k, v] of [['client', 'desktop'], ['challenge', challenge], ['state', state], ['redirect', redirect.uri]] as const) url.searchParams.append(k, v)
    try {
      this.#open(url.href)
      await wait
    } finally {
      clearTimeout(timer)
      if (this.#pending?.state === state) this.#pending = null
      redirect.stop()
    }
  }

  #cancelPending() {
    this.#pending?.reject(new BridgeError('cancelled', 'sign-in cancelled'))
    this.#pending = null
  }

  /** The callback URL carried `code` and `state`; one attempt only, whatever the outcome. */
  async complete(url: URL): Promise<void> {
    const p = this.#pending
    if (p === null) throw failed('no sign-in in progress')
    this.#pending = null
    try {
      await this.#finish(p, url)
    } catch (e) {
      p.reject(e as BridgeError)
      throw e
    }
    p.resolve()
  }

  async #finish(p: Pending, url: URL): Promise<void> {
    if (url.searchParams.get('state') !== p.state) throw failed('state mismatch')
    const code = url.searchParams.get('code')
    if (!code) throw failed('no code')
    const { status, body } = await this.#post('/api/v1/auth/token', { code, verifier: p.verifier })
    if (status !== 200) throw failed('code rejected')
    await this.#accept(parsePair(body))
  }

  /** Drops the access token first, then revokes on the server (best effort: offline works), then clears the credential. */
  // shortcut: logout is best effort, so offline leaves the server session to expire; upgrade when sessions need a hard revoke.
  async signOut(): Promise<void> {
    this.#cancelPending()
    this.#access = null
    const rt = await this.keychain.load().catch(() => null)
    if (rt !== null) await this.#post('/api/v1/auth/logout', { refreshToken: rt }).catch(() => {})
    await guard(() => this.keychain.clear())
  }

  setDirty(dirty: boolean) { this.#dirty = dirty }
  isDirty() { return this.#dirty }

  /** `ifMatch` is the row version the screen last read (AD-18); an integer, so no other header can ride along. `idempotencyKey` is the key of a call the server may see twice (Reply). */
  async requestIf({ method, path, body, ifMatch, idempotencyKey }: ApiCall): Promise<ApiResponse> {
    const m = parseMethod(method)
    const idem = idempotencyKey ?? ''
    if (idem.length > 128 || !/^[\x21-\x7e]*$/.test(idem)) throw new BridgeError('bad_request', 'bad idempotency key')
    if (path === HEALTH) {
      // The connection monitor pings this while offline; it needs no sign-in and must not carry a token.
      if (m !== 'GET') throw new BridgeError('bad_request', 'health is read-only')
      return this.#send(m, path, null, null)
    }
    checkPath(path)
    this.#url(path)
    const payload: Payload = body === null || body === undefined ? null : { json: body, key: idem }
    const { raw, refreshed } = await this.#authed(m, path, payload, ifMatch, timeoutFor(path, this.cfg.requestTimeoutMs))
    return { status: raw.status, body: parseJson(raw.bytes), refreshed }
  }

  /** Signed-in call that hands back the raw answer (uploads). Same path rules, token refresh and 401 handling as `requestIf`; `signal` abandons the request as `cancelled`. */
  async call(method: string, path: string, payload: Payload, timeoutMs: number, signal?: AbortSignal): Promise<Raw> {
    const m = parseMethod(method)
    checkPath(path)
    this.#url(path)
    return (await this.#authed(m, path, payload, null, timeoutMs, signal)).raw
  }

  async #authed(method: string, path: string, payload: Payload, ifMatch: number | null, timeoutMs: number, signal?: AbortSignal): Promise<{ raw: Raw; refreshed: boolean }> {
    let token = this.#access ?? (await this.#refresh(null))
    const first = await this.#sendRaw(method, path, payload, token, ifMatch, timeoutMs, signal)
    if (first.status !== 401) return { raw: first, refreshed: false }
    token = await this.#refresh(token)
    const second = await this.#sendRaw(method, path, payload, token, ifMatch, timeoutMs, signal)
    if (second.status === 401) throw await this.#expire()
    return { raw: second, refreshed: true }
  }

  /** Single flight: callers that saw the same rejected token queue behind one refresh and reuse its result. */
  #refresh(rejected: string | null): Promise<string> {
    const run = this.#gate.then(() => this.#refreshLocked(rejected))
    this.#gate = run.catch(() => {})
    return run
  }

  async #refreshLocked(rejected: string | null): Promise<string> {
    if (this.#access !== null && this.#access !== rejected) return this.#access
    const rt = await guard(() => this.keychain.load())
    if (rt === null) throw new BridgeError('signed_out', 'signed out')
    const { status, body } = await this.#post('/api/v1/auth/refresh', { refreshToken: rt })
    switch (status) {
      case 200: return await this.#accept(parsePair(body))
      case 401: throw await this.#expire()
      case 403: await this.#expire(); throw new BridgeError('no_access', 'no access')
      default: throw failed('refresh failed')
    }
  }

  /** Refresh token first: if the keychain refuses it, no access token is kept (fail closed). */
  async #accept(pair: TokenPair): Promise<string> {
    await guard(() => this.keychain.store(pair.refreshToken))
    this.#access = pair.accessToken
    return pair.accessToken
  }

  async #expire(): Promise<BridgeError> {
    this.#access = null
    try { await this.keychain.clear() } catch { /* the session is over either way */ }
    return new BridgeError('session_expired', 'session expired')
  }

  /** The URL parser folds encoded dot segments (%2e%2e), so the string checks alone do not keep a path under the prefix. */
  #url(path: string): URL {
    const url = new URL(`${this.cfg.api}${path}`)
    if (url.origin !== this.#origin || (path !== HEALTH && !url.pathname.startsWith(this.#prefix))) throw badPath()
    return url
  }

  async #post(path: string, body: unknown) {
    return this.#send('POST', path, { json: body, key: '' }, null)
  }

  async #send(method: string, path: string, payload: Payload, bearer: string | null): Promise<ApiResponse> {
    const raw = await this.#sendRaw(method, path, payload, bearer, null, timeoutFor(path, this.cfg.requestTimeoutMs))
    return { status: raw.status, body: parseJson(raw.bytes), refreshed: false }
  }

  async #sendRaw(method: string, path: string, payload: Payload, bearer: string | null, ifMatch: number | null, timeoutMs: number, caller?: AbortSignal): Promise<Raw> {
    const url = new URL(`${this.cfg.api}${path}`)
    if (url.origin !== this.#origin || (path !== HEALTH && !url.pathname.startsWith(this.#prefix))) throw badPath()
    const headers: Record<string, string> = {}
    if (bearer !== null) headers.authorization = `Bearer ${bearer}`
    if (ifMatch !== null) headers['if-match'] = String(ifMatch)
    let body: string | FormData | undefined
    if (payload !== null) {
      if (payload.key !== '') headers['idempotency-key'] = payload.key
      if ('file' in payload) {
        body = new FormData()
        body.append('file', new Blob([payload.file.bytes]), payload.file.name)
      } else {
        headers['content-type'] = 'application/json'
        body = JSON.stringify(payload.json)
      }
    }
    const timer = AbortSignal.timeout(timeoutMs)
    const signal = caller ? AbortSignal.any([timer, caller]) : timer
    const cancelled = () => new BridgeError('cancelled', 'cancelled')
    let res: Response
    try {
      res = await fetch(url, { method, headers, body, redirect: 'manual', signal })
    } catch (e) {
      if (caller?.aborted) throw cancelled()
      throw isTimeout(e) ? new BridgeError('timeout', 'request timed out') : new BridgeError('offline', 'server unreachable')
    }
    try {
      return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()) }
    } catch (e) {
      if (caller?.aborted) throw cancelled()
      throw isTimeout(e) ? new BridgeError('timeout', 'request timed out') : failed('request failed')
    }
  }
}
