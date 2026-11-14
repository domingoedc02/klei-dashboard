// Port of desktop/src-tauri/src/thumbs.rs and the klei-img handler in lib.rs. Thumbnails are held in memory only (NFR-1); nothing is written to disk.
import { BridgeError } from '../shared/errors.ts'
import type { Session } from './session.ts'

export const TTL_MS = 300_000
export const MAX_ENTRIES = 400
export const WINDOWS_HOST = 'klei-img.localhost'

export interface Key { owner: string; photo: string; full: boolean; gown: boolean }
export type Serve = (req: { url: string; method: string }) => Promise<Response>

const UUID = /^[0-9a-fA-F-]{36}$/

/**
 * `/{batch}/{photo}[/full]`, `/g/{gown}/{photo}[/full]` or `/me/{revision}`, with slashes that may arrive percent-encoded.
 * Anything else is refused, so a path can never steer the API call. The avatar revision only busts the page's image cache.
 */
export function parse(path: string): Key | null {
  const decoded = path.replace(/^\/+/, '').replaceAll('%2F', '/').replaceAll('%2f', '/')
  if (decoded.startsWith('me/')) {
    const rev = decoded.slice(3)
    return /^\d{1,18}$/.test(rev) ? { owner: 'me', photo: rev, full: false, gown: false } : null
  }
  const parts = decoded.split('/')
  const gown = parts[0] === 'g'
  if (gown) parts.shift()
  const [owner, photo, tail, extra] = parts
  if (owner === undefined || photo === undefined || extra !== undefined || (tail !== undefined && tail !== 'full')) return null
  return UUID.test(owner) && UUID.test(photo) ? { owner, photo, full: tail === 'full', gown } : null
}

/** Thumbnails are JPEG unless the first bytes say PNG or WebP. */
export function mime(b: Uint8Array): string {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.length > 12 && Buffer.from(b.subarray(0, 4)).toString('latin1') === 'RIFF' && Buffer.from(b.subarray(8, 12)).toString('latin1') === 'WEBP') return 'image/webp'
  return 'image/jpeg'
}

/** Thumbnails kept for a while; a full image and an avatar are read each time and never kept (a held avatar could outlive a sign-out). */
export class Thumbs {
  readonly #held = new Map<string, { at: number; bytes: Buffer }>()
  readonly #now: () => number

  constructor(now: () => number = Date.now) {
    this.#now = now
  }

  get size(): number {
    return this.#held.size
  }

  /** The image bytes, or the HTTP status to answer with. */
  async get(session: Pick<Session, 'call' | 'cfg'>, key: Key): Promise<Buffer | number> {
    const own = key.owner === 'me'
    const keep = !key.full && !own
    const id = `${key.gown ? 'g' : 'u'}/${key.owner}/${key.photo}`
    if (keep) {
      const hit = this.#held.get(id)
      if (hit && this.#now() - hit.at < TTL_MS) return hit.bytes
    }
    const path = own ? '/api/v1/me/avatar' : `/api/v1/${key.gown ? 'gowns' : 'uploads'}/${key.owner}/photos/${key.photo}?size=${key.full ? 'full' : 'thumb'}`
    let raw
    try {
      raw = await session.call('GET', path, null, session.cfg.requestTimeoutMs)
    } catch (e) {
      if (!(e instanceof BridgeError)) throw e
      return 503
    }
    if (raw.status !== 200) return raw.status === 404 ? 404 : 502
    if (keep) {
      const now = this.#now()
      for (const [k, v] of this.#held) if (now - v.at >= TTL_MS) this.#held.delete(k)
      if (this.#held.size < MAX_ENTRIES) this.#held.set(id, { at: now, bytes: raw.bytes })
    }
    return raw.bytes
  }
}

const reply = (status: number, body?: Buffer): Response =>
  new Response(body ? new Uint8Array(body) : null, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(body ? { 'Content-Type': mime(body) } : {}) },
  })

/** Only GET and only the paths `parse` accepts; every answer, errors included, is `no-store` and `nosniff`. */
export const imageHandler = (session: Pick<Session, 'call' | 'cfg'>, thumbs = new Thumbs()): Serve => async (req) => {
  let key: Key | null = null
  try {
    key = req.method === 'GET' ? parse(new URL(req.url).pathname) : null
  } catch { /* malformed URL: 400 below */ }
  if (!key) return reply(400)
  const r = await thumbs.get(session, key)
  return typeof r === 'number' ? reply(r) : reply(200, r)
}

/** Windows: the renderer asks for plain http on one host. That host goes to the image handler; every other http request fails closed without touching the network. */
export const windowsAlias = (serve: Serve): Serve => async (req) => {
  try {
    const u = new URL(req.url)
    if (u.protocol === 'http:' && u.hostname === WINDOWS_HOST && u.port === '' && u.username === '' && u.password === '') return serve(req)
  } catch { /* fall through */ }
  return reply(403)
}
