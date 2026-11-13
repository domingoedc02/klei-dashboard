// The closed command set and the argument checks both preload and main run. Source of the names: desktop/src-tauri/src/commands.rs::NAMES.
import { BridgeError, type BridgeErrorValue } from './errors.ts'
import { EXPORT_KINDS, UPLOAD_KINDS, type UploadKind } from './events.ts'

export const COMMANDS = [
  'api_request', 'sign_in', 'sign_out', 'upload_files', 'export_gowns', 'check_update', 'install_update', 'set_dirty', 'session_only',
] as const
export type Command = (typeof COMMANDS)[number]
export const isCommand = (n: unknown): n is Command => typeof n === 'string' && (COMMANDS as readonly string[]).includes(n)

export const INVOKE_CHANNEL = 'klei:invoke'
export const eventChannel = (id: string) => `klei:ev:${id}`

/** What main answers to `klei:invoke`. `ended`: main sent the end marker on this call's event channel, so preload may wait for it. */
export type Envelope = ({ ok: unknown } | { err: BridgeErrorValue }) & { ended?: true }

// These two answer through a channel of events; the others never carry an event id.
export const CHANNEL_COMMANDS: readonly Command[] = ['upload_files', 'export_gowns']

// Rust has no bound for most of these. Each is the smallest value that keeps the original screens working; 16.1 and 17.x may tighten them.
export const LIMITS = {
  method: 16,
  path: 2048,
  body: 4 * 1024 * 1024,
  idempotencyKey: 128,
  targetId: 128,
  ids: 1000,
  id: 64,
} as const

export interface ApiCall { method: string; path: string; body: unknown; ifMatch: number | null; idempotencyKey: string | null }
export interface Args {
  api_request: { request: ApiCall }
  sign_in: Record<string, never>
  sign_out: Record<string, never>
  upload_files: { kind: UploadKind; targetId: string }
  export_gowns: { kind: (typeof EXPORT_KINDS)[number]; ids: string[] }
  check_update: Record<string, never>
  install_update: Record<string, never>
  set_dirty: { dirty: boolean }
  session_only: Record<string, never>
}

const bad = () => new BridgeError('bad_request', 'bad request')
const plain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v))
// Exactly the allowed keys: all of `required`, any of `optional`, nothing else.
const keys = (v: unknown, required: string[], optional: string[] = []): Record<string, unknown> => {
  if (!plain(v)) throw bad()
  const ks = Object.keys(v)
  if (!required.every((k) => ks.includes(k)) || !ks.every((k) => required.includes(k) || optional.includes(k))) throw bad()
  return v
}
const str = (v: unknown, max: number): string => {
  if (typeof v !== 'string' || v.length > max) throw bad()
  return v
}
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T => {
  if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) throw bad()
  return v as T
}
const none = (v: unknown): Record<string, never> => keys(v, []) as Record<string, never>

const apiCall = (v: unknown): ApiCall => {
  const r = keys(v, ['method', 'path'], ['body', 'ifMatch', 'idempotencyKey'])
  const ifMatch = r.ifMatch ?? null
  if (ifMatch !== null && !(typeof ifMatch === 'number' && Number.isSafeInteger(ifMatch) && ifMatch >= 0)) throw bad()
  const key = r.idempotencyKey ?? null
  if (key !== null && (typeof key !== 'string' || new TextEncoder().encode(key).length > LIMITS.idempotencyKey)) throw bad()
  const body = r.body ?? null
  try {
    if (body !== null && JSON.stringify(body).length > LIMITS.body) throw bad()
  } catch {
    throw bad()
  }
  return { method: str(r.method, LIMITS.method), path: str(r.path, LIMITS.path), body, ifMatch, idempotencyKey: key as string | null }
}

const VALIDATORS: { [C in Command]: (a: unknown) => Args[C] } = {
  api_request: (a) => ({ request: apiCall(keys(a, ['request']).request) }),
  sign_in: none,
  sign_out: none,
  check_update: none,
  install_update: none,
  session_only: none,
  set_dirty: (a) => {
    const { dirty } = keys(a, ['dirty'])
    if (typeof dirty !== 'boolean') throw bad()
    return { dirty }
  },
  upload_files: (a) => {
    const r = keys(a, ['kind', 'targetId'])
    return { kind: oneOf(r.kind, UPLOAD_KINDS), targetId: str(r.targetId, LIMITS.targetId) }
  },
  export_gowns: (a) => {
    const r = keys(a, ['kind', 'ids'])
    if (!Array.isArray(r.ids) || r.ids.length > LIMITS.ids) throw bad()
    return { kind: oneOf(r.kind, EXPORT_KINDS), ids: r.ids.map((i) => str(i, LIMITS.id)) }
  },
}

export const validate = <C extends Command>(cmd: C, args: unknown): Args[C] => VALIDATORS[cmd](args)

export const isEventId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)
