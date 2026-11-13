import { COMMANDS } from '../shared/commands.ts'
import { BridgeError } from '../shared/errors.ts'
import type { Handlers } from './invoker.ts'
import type { Session } from './session.ts'

const notImplemented = () => Promise.reject(new BridgeError('failed', 'not implemented'))

export interface Deps {
  session: Session
  /** Switches the credential store to process memory ("Continue without saving"). */
  useMemory(): void
  exit(code: number): void
}

// One entry per command; Epics 16 and 17 replace the stubs. Keyed by COMMANDS so a tenth name cannot be added here alone.
export const createHandlers = ({ session, useMemory, exit }: Deps): Handlers => ({
  ...(Object.fromEntries(COMMANDS.map((c) => [c, notImplemented])) as unknown as Handlers),
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
})
