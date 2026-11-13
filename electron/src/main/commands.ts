import { COMMANDS } from '../shared/commands.ts'
import { BridgeError } from '../shared/errors.ts'
import type { Handlers } from './invoker.ts'

const notImplemented = () => Promise.reject(new BridgeError('failed', 'not implemented'))

// One entry per command, each replaced by Epic 16 or 17. Keyed by COMMANDS so a tenth name cannot be added here alone.
export const handlers: Handlers = Object.fromEntries(COMMANDS.map((c) => [c, notImplemented])) as unknown as Handlers
