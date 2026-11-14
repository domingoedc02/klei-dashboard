import { BridgeError } from '../shared/errors.ts'
import type { ExportSummary, UploadSummary } from '../shared/events.ts'
import { build, clean, Exporter, fetchManifest } from './export.ts'
import type { Handlers } from './invoker.ts'
import type { Session } from './session.ts'
import { check, install } from './update.ts'
import { attachFiles, checkInquiry, run, setAvatar, Uploader } from './uploads.ts'

export interface Deps {
  session: Session
  /** Switches the credential store to process memory ("Continue without saving"). */
  useMemory(): void
  exit(code: number): void
  /** Native file dialog: `photo` (filter "Photos", multi-select), `avatar` (same filter, one file), `attachment` (any type, multi-select). The chosen paths; empty when dismissed. */
  pick?(kind: 'photo' | 'avatar' | 'attachment'): Promise<string[]>
  /** The save dialog for the download; null when the User dismisses it. */
  save?(suggested: string): Promise<string | null>
  exporter?: Exporter
  /** The running app's version, for the update check. */
  version?: string
  /** Opens a URL in the system browser (`shell.openExternal`). */
  open?(url: string): Promise<void>
  /** Shared with the private drop channel (index.ts); a fresh one when omitted. */
  uploader?: Uploader
}

const NONE = (): UploadSummary => ({ stored: [], rejected: [], cancelled: false })
const DISMISSED = (): UploadSummary => ({ ...NONE(), cancelled: true })
const NOTHING = (cancelled: boolean): ExportSummary => ({ gowns: 0, photos: 0, cancelled })

// One entry per command; `Handlers` is keyed by COMMANDS so a tenth name cannot be added here alone.
export const createHandlers = ({ session, useMemory, exit, pick, save, uploader = new Uploader(), exporter = new Exporter(), version = '0.0.0', open = () => Promise.reject(new Error('no browser')) }: Deps): Handlers => {
  return {
  check_update: () => check(session.cfg.download, version),
  install_update: async () => {
    await install(session.cfg.download, session.isDirty(), open)
    return null
  },
  async upload_files({ kind, targetId }, ctx) {
    switch (kind) {
      case 'cancel':
        uploader.cancel()
        return NONE()
      case 'watch': // stays open until `unwatch`, a newer watch or the page going away: the events ride this call's channel
        await uploader.watch(ctx.emit, ctx.signal)
        return NONE()
      case 'unwatch':
        uploader.unwatch()
        return NONE()
      case 'photo':
      case 'dropped':
        break
      case 'avatar': {
        const [path] = (await pick?.('avatar')) ?? []
        return path === undefined ? DISMISSED() : setAvatar(session, path, ctx.signal)
      }
      case 'attachment': {
        checkInquiry(targetId)
        const picked = (await pick?.('attachment')) ?? []
        return picked.length === 0 ? DISMISSED() : attachFiles(session, targetId, picked, ctx.signal)
      }
      default:
        throw new BridgeError('bad_request', 'unknown upload kind')
    }
    const paths = kind === 'photo' ? ((await pick?.('photo')) ?? []) : uploader.takeDrop()
    if (paths.length === 0) return NONE()
    const slot = uploader.begin(ctx.signal)
    try {
      return await run(session, targetId, paths, slot.signal, ctx.emit)
    } finally {
      slot.release()
    }
  },
  async export_gowns({ kind, ids }, ctx) {
    if (kind === 'cancel') {
      exporter.cancel()
      return NOTHING(false)
    }
    if (kind !== 'start') throw new BridgeError('bad_request', 'unknown download kind')
    if (ids.length === 0) throw new BridgeError('bad_request', 'nothing to download')
    const slot = exporter.begin(ctx.signal)
    try {
      const items = await fetchManifest(session, ids)
      const first = items[0]
      if (!first) throw new BridgeError('failed', 'those gowns no longer exist')
      const dest = await save?.(items.length === 1 ? `${clean(first.name)}.zip` : 'klei-gowns.zip')
      if (!dest) return NOTHING(true)
      return await build(session, items, dest, slot.signal, ctx.emit)
    } finally {
      slot.release()
    }
  },
  async sign_in() {
    await session.signIn()
    return null
  },
  async sign_out() {
    await session.signOut()
    return null
  },
  set_dirty({ dirty }) {
    session.setDirty(dirty)
    return Promise.resolve(null)
  },
  session_only() {
    useMemory()
    return Promise.resolve(null)
  },
  async api_request({ request }) {
    try {
      return await session.requestIf(request)
    } catch (e) {
      // KLEI_SMOKE=1: the first answer the page gets is "signed out", which proves the IPC round trip under the CSP.
      // Exit a moment later so the signed-out screen is drawn before the process ends.
      if (session.cfg.smoke && e instanceof BridgeError && e.kind === 'signed_out') setTimeout(() => exit(0), 1000)
      throw e
    }
  },
  }
}
