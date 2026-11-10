import { Channel, invoke } from '@tauri-apps/api/core';

/** The webview has no network: every call goes through the closed Rust command set (architecture §2). */
export type ErrorKind =
  | 'signed_out'
  | 'keychain_unavailable'
  | 'session_expired'
  | 'no_access'
  | 'failed'
  | 'timeout'
  | 'cancelled'
  | 'offline'
  | 'bad_request'
  | 'too_large'
  | 'update_refused'
  | 'update_unverified';

export interface BridgeError {
  kind: ErrorKind;
  message: string;
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T | null;
  /** The shell swapped a stale token for a new one to answer this call. */
  refreshed?: boolean;
}

/** Why the shell or the server turned a photo away; the screen owns the wording. */
export type RejectReason = 'type' | 'size' | 'full' | 'dimensions' | 'unreadable';

export interface UploadProgress {
  done: number;
  total: number;
  /** A file waits for the connection or a busy server. */
  waiting: boolean;
  /** The Photo the server just stored, when this tick is a stored file. */
  photoId: string | null;
}

export type UploadEvent =
  | ({ type: 'progress' } & UploadProgress)
  | { type: 'drag'; over: boolean }
  | { type: 'dropped'; count: number };

export interface UploadSummary {
  stored: string[];
  rejected: { name: string; reason: RejectReason }[];
  cancelled: boolean;
}

/** `attachment` picks files for the Reply of Inquiry `targetId` (stored holds the Attachment ids), `avatar` picks one photo for the User's own avatar (stored holds "avatar"), `photo` opens the file dialog, `dropped` sends the files just dropped on the window, `cancel` stops the run, `watch`/`unwatch` start and stop drag-and-drop news. */
export type UploadKind = 'photo' | 'dropped' | 'cancel' | 'watch' | 'unwatch' | 'avatar' | 'attachment';

export interface ExportProgress {
  /** Gowns whose files are in the archive. */
  done: number;
  total: number;
}

export interface ExportSummary {
  gowns: number;
  photos: number;
  /** The save dialog was dismissed or the run was cancelled; nothing was kept. */
  cancelled: boolean;
}

/** What the update check found; the feed address and the package never reach the webview. */
export type UpdateStatus = { status: 'none' } | { status: 'available'; version: string };

export function asBridgeError(e: unknown): BridgeError {
  if (typeof e === 'object' && e !== null && 'kind' in e) return e as BridgeError;
  return { kind: 'failed', message: String(e) };
}

export const bridge = {
  /** `ifMatch` is the row version the screen last read; Rust sends it as `If-Match`. `idempotencyKey` goes out as `Idempotency-Key`. */
  request: <T = unknown>(method: string, path: string, body?: unknown, ifMatch?: number, idempotencyKey?: string) =>
    invoke<ApiResponse<T>>('api_request', { request: { method, path, body: body ?? null, ifMatch: ifMatch ?? null, idempotencyKey: idempotencyKey ?? null } }),
  signIn: () => invoke<void>('sign_in'),
  sessionOnly: () => invoke<void>('session_only'),
  signOut: () => invoke<void>('sign_out'),
  setDirty: (dirty: boolean) => invoke<void>('set_dirty', { dirty }),
  checkUpdate: () => invoke<UpdateStatus>('check_update'),
  /** Downloads, verifies and installs, then the app restarts, so a success never answers. Refused with `update_refused` while unsent work exists. */
  installUpdate: () => invoke<void>('install_update'),
  /** Paths and file bytes stay in Rust; only counts, ids and file names come back (AD-10). */
  uploadFiles: (kind: UploadKind, targetId: string, onEvent: (e: UploadEvent) => void = () => {}) => {
    const channel = new Channel<UploadEvent>();
    channel.onmessage = onEvent;
    return invoke<UploadSummary>('upload_files', { kind, targetId, onEvent: channel });
  },
  /** `start` opens the save dialog and writes the .zip there; `cancel` stops the running one. Photos and the file path stay in Rust. */
  exportGowns: (kind: 'start' | 'cancel', ids: string[], onEvent: (e: ExportProgress) => void = () => {}) => {
    const channel = new Channel<ExportProgress>();
    channel.onmessage = onEvent;
    return invoke<ExportSummary>('export_gowns', { kind, ids, onEvent: channel });
  },
};
