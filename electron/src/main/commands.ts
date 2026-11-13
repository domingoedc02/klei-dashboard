import { COMMANDS } from '../shared/commands.ts'
import { BridgeError } from '../shared/errors.ts'
import type { UploadSummary } from '../shared/events.ts'
import type { Handlers } from './invoker.ts'
import type { Session } from './session.ts'
import { run, Uploader } from './uploads.ts'

const notImplemented = () => Promise.reject(new BridgeError('failed', 'not implemented'))

export interface Deps {
  session: Session
  /** Switches the credential store to process memory ("Continue without saving"). */
  useMemory(): void
  exit(code: number): void
  /** Native photo picker (filter "Photos", multi-select): the chosen paths, empty when the dialog is cancelled. */
  pickPhotos?(): Promise<string[]>
  /** Shared with the private drop channel (index.ts); a fresh one when omitted. */
  uploader?: Uploader
}

const NONE = (): UploadSummary => ({ stored: [], rejected: [], cancelled: false })

// One entry per command; Epics 16 and 17 replace the stubs. Keyed by COMMANDS so a tenth name cannot be added here alone.
export const createHandlers = ({ session, useMemory, exit, pickPhotos, uploader = new Uploader() }: Deps): Handlers => {
  return {
  ...(Object.fromEntries(COMMANDS.map((c) => [c, notImplemented])) as unknown as Handlers),
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
      default: // avatar, attachment: 17.3
        return notImplemented()
    }
    const paths = kind === 'photo' ? ((await pickPhotos?.()) ?? []) : uploader.takeDrop()
    if (paths.length === 0) return NONE()
    const slot = uploader.begin(ctx.signal)
    try {
      return await run(session, targetId, paths, slot.signal, ctx.emit)
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
