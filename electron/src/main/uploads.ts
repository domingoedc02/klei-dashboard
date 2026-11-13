// Port of desktop/src-tauri/src/uploads.rs (photo run). Reads files, never writes: no copy, cache or temp file (NFR-1).
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import type { RejectReason, UploadProgress, UploadSummary } from '../shared/events.ts'
import { BridgeError } from '../shared/errors.ts'
import type { Session } from './session.ts'

export const MAX_BYTES = 25 * 1024 * 1024
export const MAX_PHOTOS = 200
export const EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp']
const IN_FLIGHT = 3

export interface Picked { path: string; len: number; mtimeNs: bigint }
export interface Rejected { name: string; reason: RejectReason }
export type Emit = (p: { type: 'progress' } & UploadProgress) => void

/** A drop is claimed within this long or forgotten. */
export const DROP_TTL_MS = 10_000
const MAX_DROPPED = 10_000
const MAX_PATH = 4096

interface Watcher { emit(message: unknown): void; end(): void }
type DropMessage = { over: boolean } | { paths: string[] }

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v))

/** What the preload may tell main about a window drag: exactly `{over}` or `{paths}`. Anything else is ignored. */
export function parseDrop(m: unknown): DropMessage | null {
  if (!isPlain(m)) return null
  const ks = Object.keys(m)
  if (ks.length !== 1) return null
  if (ks[0] === 'over') return typeof m.over === 'boolean' ? { over: m.over } : null
  if (ks[0] === 'paths' && Array.isArray(m.paths) && m.paths.length > 0 && m.paths.length <= MAX_DROPPED && m.paths.every((p) => typeof p === 'string' && p.length > 0 && p.length <= MAX_PATH)) return { paths: m.paths as string[] }
  return null
}

/**
 * Run state shared by the commands: at most one run, the screen listening for drops, and the paths of the last OS drop.
 * Dropped paths live here and never go to the page, so only files the User really dropped can be sent.
 */
export class Uploader {
  #active: AbortController | null = null
  #watcher: Watcher | null = null
  #dropped: { at: number; paths: string[] } | null = null
  readonly #now: () => number

  constructor(now: () => number = Date.now) {
    this.#now = now
  }

  begin(outer?: AbortSignal): { signal: AbortSignal; release(): void } {
    if (this.#active) throw new BridgeError('bad_request', 'an upload is already running')
    const own = (this.#active = new AbortController())
    const onOuter = () => own.abort()
    if (outer?.aborted) own.abort()
    outer?.addEventListener('abort', onOuter, { once: true })
    return {
      signal: own.signal,
      release: () => {
        outer?.removeEventListener('abort', onOuter)
        if (this.#active === own) this.#active = null
      },
    }
  }

  cancel(): void {
    this.#active?.abort()
  }

  /** Only the Upload screen listens; a drop anywhere else is forgotten at once. Resolves when this watch ends (unwatch, a newer watch, or the page going away). */
  watch(emit: (message: unknown) => void, signal: AbortSignal): Promise<void> {
    this.#watcher?.end()
    return new Promise<void>((resolve) => {
      const w: Watcher = { emit, end: () => { signal.removeEventListener('abort', gone); resolve() } }
      const gone = () => {
        if (this.#watcher === w) this.unwatch()
        else w.end()
      }
      this.#watcher = w
      if (signal.aborted) gone()
      else signal.addEventListener('abort', gone, { once: true })
    })
  }

  unwatch(): void {
    const w = this.#watcher
    this.#watcher = null
    this.#dropped = null
    w?.end()
  }

  drag(over: boolean): void {
    this.#watcher?.emit({ type: 'drag', over })
  }

  dropFiles(paths: string[]): void {
    const w = this.#watcher
    if (!w) return
    this.#dropped = { at: this.#now(), paths }
    w.emit({ type: 'dropped', count: paths.length })
  }

  /** The paths of the last drop, once, and only while it is younger than the TTL. */
  takeDrop(): string[] {
    const d = this.#dropped
    this.#dropped = null
    return d && this.#now() - d.at < DROP_TTL_MS ? d.paths : []
  }

  /** A private preload message. Dropped unless it has the exact shape. */
  message(m: unknown): void {
    const d = parseDrop(m)
    if (!d) return
    if ('over' in d) this.drag(d.over)
    else {
      this.drag(false)
      this.dropFiles(d.paths)
    }
  }
}

/** The listener for the private drop channel; messages from anything but the trusted main frame are ignored. */
export const dropListener = <E>(trusted: (e: E) => boolean, uploader: Uploader) => (e: E, m: unknown): void => {
  if (trusted(e)) uploader.message(m)
}

/** Reads size and modified time only. Folders are skipped; a file that cannot be inspected is refused. */
export async function statAll(paths: string[]): Promise<{ ok: Picked[]; bad: Rejected[] }> {
  const ok: Picked[] = []
  const bad: Rejected[] = []
  for (const path of paths) {
    try {
      const s = await stat(path, { bigint: true })
      if (!s.isDirectory()) ok.push({ path, len: Number(s.size), mtimeNs: s.mtimeNs })
    } catch {
      bad.push({ name: basename(path), reason: 'unreadable' })
    }
  }
  return { ok, bad }
}

/** Extension, then size, then the room left in the batch (first `room` files stay). The server still confirms the real image type. */
export function triage(picked: Picked[], room: number): { send: Picked[]; refused: Rejected[] } {
  const send: Picked[] = []
  const refused: Rejected[] = []
  for (const p of picked) {
    const ext = extname(p.path).slice(1).toLowerCase()
    const reason: RejectReason | null = !EXTENSIONS.includes(ext) ? 'type' : p.len > MAX_BYTES ? 'size' : send.length >= room ? 'full' : null
    if (reason) refused.push({ name: basename(p.path), reason })
    else send.push(p)
  }
  return { send, refused }
}

/** Same file in the same batch gives the same key, so a resend after a lost answer or a restart stores nothing twice. */
export function keyFor(batch: string, p: Picked): string {
  const h = createHash('sha256')
  for (const part of [batch, p.path, String(p.len), String(p.mtimeNs)]) h.update(part).update('\0')
  return h.digest().subarray(0, 16).toString('hex')
}

type Outcome = { stored: string } | { refused: RejectReason } | 'cancelled' | { fatal: BridgeError }

const parse = <T>(b: Buffer): T | null => {
  try { return JSON.parse(b.toString('utf8')) as T | null } catch { return null }
}

const noAccess = () => new BridgeError('no_access', 'no access')

/** Uploads `paths` into `batch`. The batch must be the caller's own; the room left comes from the server. Stored files stay stored whatever happens later. */
export async function run(session: Session, batch: string, paths: string[], signal: AbortSignal, emit: Emit): Promise<UploadSummary> {
  const cur = await session.call('GET', '/api/v1/uploads/current', null, session.cfg.requestTimeoutMs, signal)
  if (cur.status === 403) throw noAccess()
  const view = cur.status === 200 ? parse<{ id?: unknown; photoIds?: unknown }>(cur.bytes) : null
  if (view === null || typeof view !== 'object') throw new BridgeError('failed', 'no upload batch')
  if (view.id !== batch) throw new BridgeError('bad_request', 'not the current batch')
  const storedBefore = Array.isArray(view.photoIds) ? view.photoIds.length : 0

  const { ok, bad } = await statAll(paths)
  const { send, refused: over } = triage(ok, Math.max(0, MAX_PHOTOS - storedBefore))
  const refused = [...bad, ...over]
  const stored: string[] = []
  const rejected: Rejected[] = []
  const queue = [...send]
  const total = queue.length
  let done = 0
  let waiting = 0
  let fatal: BridgeError | null = null
  const tick = (photoId: string | null) => emit({ type: 'progress', done, total, waiting: waiting > 0, photoId })

  const one = async (job: Picked): Promise<Outcome> => {
    const bytes = await readFile(job.path).catch(() => null)
    if (bytes === null) return { refused: 'unreadable' }
    const name = basename(job.path)
    const key = keyFor(batch, job)
    for (;;) {
      try {
        const raw = await session.call('POST', `/api/v1/uploads/${batch}/photos`, { file: { name, bytes }, key }, session.cfg.uploadTimeoutMs, signal)
        switch (raw.status) {
          case 200:
          case 201: {
            const id = parse<{ id?: unknown }>(raw.bytes)?.id
            return typeof id === 'string' ? { stored: id } : { fatal: new BridgeError('failed', 'bad upload answer') }
          }
          case 413: return { refused: storedBefore + stored.length >= MAX_PHOTOS ? 'full' : 'dimensions' }
          case 415: return { refused: 'type' }
          case 403: return { fatal: noAccess() }
          case 429: case 502: case 503: case 504: break
          default: return { fatal: new BridgeError('failed', 'upload failed') }
        }
      } catch (e) {
        if (signal.aborted) return 'cancelled'
        if (!(e instanceof BridgeError)) return { fatal: new BridgeError('failed', 'upload failed') }
        if (e.kind !== 'offline' && e.kind !== 'timeout') return { fatal: e }
      }
      waiting++
      tick(null)
      try { await sleep(session.cfg.retryDelayMs, undefined, { signal }) } catch { return 'cancelled' } finally { waiting-- }
    }
  }

  const worker = async () => {
    while (!signal.aborted) {
      const job = queue.shift()
      if (!job) return
      const out = await one(job)
      if (out === 'cancelled') return
      if ('fatal' in out) {
        fatal ??= out.fatal
        queue.length = 0
        return
      }
      done++
      if ('stored' in out) {
        stored.push(out.stored)
        tick(out.stored)
      } else {
        rejected.push({ name: basename(job.path), reason: out.refused })
        tick(null)
      }
    }
  }

  tick(null)
  await Promise.all(Array.from({ length: IN_FLIGHT }, worker))
  if (fatal) throw fatal
  return { stored, rejected: [...refused, ...rejected], cancelled: signal.aborted }
}
