// Port of desktop/src-tauri/src/export.rs. The only module that writes a file: the one the User chose in the save dialog (NFR-1).
import { createWriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { Writable } from 'node:stream'
import { TextReader, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js'
import { BridgeError } from '../shared/errors.ts'
import type { ExportProgress, ExportSummary } from '../shared/events.ts'
import type { Session } from './session.ts'

const NAME_CHARS = 80
const NAME_BYTES = 200
const RESERVED = ['CON', 'PRN', 'AUX', 'NUL', ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`), ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`)]
const SAFE_ID = /^[\w-]{1,64}$/

export interface ExportPhoto { id: string; type: string }
export interface Item { gownId: string; name: string; photos: ExportPhoto[]; details: string }
export type Emit = (p: ExportProgress) => void

const failed = (what: string) => new BridgeError('failed', what)
const CANCELLED = (): ExportSummary => ({ gowns: 0, photos: 0, cancelled: true })

/** One download at a time; `cancel` stops the running one. */
export class Exporter {
  #active: AbortController | null = null

  begin(outer?: AbortSignal): { signal: AbortSignal; release(): void } {
    if (this.#active) throw new BridgeError('bad_request', 'a download is already running')
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
}

/** A name safe as a file or folder name on macOS, Windows and Linux: no separators, no `..`, no control characters, at most 80 characters and 200 bytes, never empty and never a reserved Windows device name. */
export function clean(raw: string): string {
  let s = [...raw].filter((c) => !/\p{Cc}/u.test(c)).map((c) => ('/\\:*?"<>|'.includes(c) ? '_' : c)).join('')
  while (s.includes('..')) s = s.replaceAll('..', '')
  const edge = /^[\s.]+|[\s.]+$/gu
  const chars = [...s.replace(edge, '')].slice(0, NAME_CHARS)
  while (Buffer.byteLength(chars.join('')) > NAME_BYTES) chars.pop()
  s = chars.join('').replace(edge, '')
  if (s === '') return 'gown'
  return RESERVED.includes(s.toUpperCase()) ? `_${s}` : s
}

/** `clean` plus a number when the name is taken (case-insensitive, like macOS and Windows disks). The number is added after the caps. */
export function unique(raw: string, taken: Set<string>): string {
  const base = clean(raw)
  let name = base
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n})`
  taken.add(name.toLowerCase())
  return name
}

const extension = (type: string): string => {
  switch (type) {
    case 'jpeg': return 'jpg'
    case 'png': return 'png'
    case 'webp': return 'webp'
    default: throw failed('unknown photo type')
  }
}

const unreadable = () => failed('unreadable manifest')
const rec = (v: unknown): Record<string, unknown> => {
  if (typeof v !== 'object' || v === null) throw unreadable()
  return v as Record<string, unknown>
}
const str = (v: unknown): string => {
  if (typeof v !== 'string') throw unreadable()
  return v
}
const id = (v: unknown): string => {
  const s = str(v)
  if (!SAFE_ID.test(s)) throw unreadable()
  return s
}

/** The ids go into request paths, so they must be plain tokens; anything else is a broken manifest. */
export function parseItems(body: unknown): Item[] {
  const list = rec(body).items
  if (!Array.isArray(list)) throw unreadable()
  return list.map((raw) => {
    const o = rec(raw)
    if (!Array.isArray(o.photos)) throw unreadable()
    return { gownId: id(o.gownId), name: str(o.name), details: str(o.details), photos: o.photos.map((p) => ({ id: id(rec(p).id), type: str(rec(p).type) })) }
  })
}

/** Asks the server which photos and details each Gown has. 413 means too many Gowns or too many bytes. */
export async function fetchManifest(session: Session, ids: string[]): Promise<Item[]> {
  const r = await session.requestIf({ method: 'POST', path: '/api/v1/gowns/export', body: { ids }, ifMatch: null, idempotencyKey: null })
  switch (r.status) {
    case 200: return parseItems(r.body)
    case 413: throw new BridgeError('too_large', 'too many to download at once')
    case 403: throw new BridgeError('no_access', 'not allowed')
    case 422: throw new BridgeError('bad_request', 'bad request')
    default: throw failed('the server could not prepare the download')
  }
}

/**
 * Writes the archive at `dest`, one photo at a time: one folder per Gown when there is more than one, photos stored as they are, details deflated.
 * The file is removed unless the archive finished. Progress counts finished Gowns.
 */
export async function build(session: Session, items: Item[], dest: string, signal: AbortSignal, emit: Emit): Promise<ExportSummary> {
  if (signal.aborted) return CANCELLED()
  const out = createWriteStream(dest)
  await new Promise<void>((ok, no) => {
    out.once('open', () => ok())
    out.once('error', () => no(failed('could not write the file')))
  })
  const closed = () => (out.closed ? Promise.resolve() : new Promise<void>((ok) => out.once('close', () => ok())))
  let finished = false
  try {
    const zip = new ZipWriter(Writable.toWeb(out) as WritableStream)
    const taken = new Set<string>()
    let photos = 0
    emit({ done: 0, total: items.length })
    for (const [i, item] of items.entries()) {
      const dir = items.length > 1 ? `${unique(item.name, taken)}/` : ''
      for (const [n, p] of item.photos.entries()) {
        const ext = extension(p.type)
        if (signal.aborted) throw new BridgeError('cancelled', 'cancelled')
        const raw = await session.call('GET', `/api/v1/gowns/${item.gownId}/photos/${p.id}?size=full`, null, session.cfg.uploadTimeoutMs, signal)
        if (raw.status !== 200) throw failed('a photo could not be read')
        await zip.add(`${dir}photo-${n + 1}.${ext}`, new Uint8ArrayReader(raw.bytes), { level: 0 })
        photos++
      }
      await zip.add(`${dir}details.txt`, new TextReader(item.details))
      emit({ done: i + 1, total: items.length })
    }
    await zip.close()
    await closed()
    finished = true
    return { gowns: items.length, photos, cancelled: false }
  } catch (e) {
    if (signal.aborted) return CANCELLED()
    throw e instanceof BridgeError ? e : failed('could not write the file')
  } finally {
    if (!finished) {
      out.destroy()
      await closed()
      await unlink(dest).catch(() => {})
    }
  }
}
