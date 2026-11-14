// Same twelve kinds as desktop/src-tauri/src/error.rs::Kind and desktop/src/bridge.ts::ErrorKind (types-match.test.ts).
export const KINDS = [
  'signed_out', 'keychain_unavailable', 'session_expired', 'no_access', 'failed', 'timeout',
  'cancelled', 'offline', 'bad_request', 'too_large', 'update_refused', 'update_unverified',
] as const
export type Kind = (typeof KINDS)[number]

/** What the page sees when a command fails. Messages never carry tokens, codes, paths or response bodies. */
export interface BridgeErrorValue { kind: Kind; message: string }

// The only error type a handler may throw on purpose; anything else becomes "request failed".
export class BridgeError extends Error {
  kind: Kind
  constructor(kind: Kind, message: string) {
    super(message)
    this.kind = kind
  }
}

export const toBridgeError = (e: unknown): BridgeErrorValue =>
  e instanceof BridgeError && KINDS.includes(e.kind) && typeof e.message === 'string'
    ? { kind: e.kind, message: e.message }
    : { kind: 'failed', message: 'request failed' }

// Preload side: whatever main (or a fault) hands back is reduced to the same plain shape before the page sees it.
export const parseBridgeError = (v: unknown): BridgeErrorValue => {
  const o = v as { kind?: unknown; message?: unknown } | null
  return typeof o === 'object' && o !== null && (KINDS as readonly unknown[]).includes(o.kind) && typeof o.message === 'string'
    ? { kind: o.kind as Kind, message: o.message }
    : { kind: 'failed', message: 'request failed' }
}
