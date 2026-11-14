// The only thing the page can call: nine named methods. Each fixes its own command name, so the page never chooses a channel or a command.
// Imports local shared code only; index.ts hands in `ipcRenderer`. Kept electron-free so tests drive it with a fake.
import { BridgeError, parseBridgeError } from '../shared/errors.ts'
import { eventChannel, INVOKE_CHANNEL, validate, type Args, type Command, type Envelope } from '../shared/commands.ts'

type Listener = (event: unknown, payload: unknown) => void
export interface Ipc {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, listener: Listener): void
  removeListener(channel: string, listener: Listener): void
}

const badRequest = () => parseBridgeError(new BridgeError('bad_request', 'bad request'))
const checked = <C extends Command>(command: C, args: unknown): Args[C] => {
  try {
    return validate(command, args)
  } catch (x) {
    throw parseBridgeError(x)
  }
}
const open = (r: unknown): unknown => {
  const e = r as Partial<Envelope> | null
  if (typeof e === 'object' && e !== null) {
    if ('err' in e) throw parseBridgeError(e.err)
    if ('ok' in e) return e.ok
  }
  throw parseBridgeError(null)
}
const ask = async (ipc: Ipc, command: Command, args: unknown, eventId?: string): Promise<Envelope> => {
  try {
    return (await ipc.invoke(INVOKE_CHANNEL, command, args, eventId)) as Envelope
  } catch {
    throw parseBridgeError(null)
  }
}

export function createBridge(ipc: Ipc, newId: () => string = () => crypto.randomUUID()) {
  const plain = async (command: Command, args: unknown) => open(await ask(ipc, command, checked(command, args)))

  // Main sends {index,message}... then {end:true,index}. The page sees messages in index order, and the call settles only after the end marker, like the Tauri Channel.
  const withEvents = async (command: Command, args: unknown, onEvent: unknown) => {
    const a = checked(command, args)
    if (typeof onEvent !== 'function') throw badRequest()
    const id = newId()
    const pending = new Map<number, unknown>()
    let next = 0
    let endAt = -1
    let finish!: () => void
    const finished = new Promise<void>((r) => (finish = r))
    const pump = () => {
      while (pending.has(next)) {
        const m = pending.get(next)
        pending.delete(next++)
        try { onEvent(m) } catch { /* a throwing page callback must not break the run */ }
      }
      if (endAt === next) finish()
    }
    const listener: Listener = (_e, raw) => {
      const r = raw as { index?: unknown; end?: unknown; message?: unknown } | null
      if (typeof r !== 'object' || r === null || !Number.isSafeInteger(r.index) || (r.index as number) < next) return
      if (r.end === true) endAt = r.index as number
      else pending.set(r.index as number, r.message)
      pump()
    }
    const channel = eventChannel(id)
    ipc.on(channel, listener)
    try {
      const envelope = await ask(ipc, command, a, id)
      if (envelope && envelope.ended === true) await finished
      return open(envelope)
    } finally {
      ipc.removeListener(channel, listener)
      pending.clear()
    }
  }

  return {
    api_request: (request: unknown) => plain('api_request', { request }),
    sign_in: () => plain('sign_in', {}),
    sign_out: () => plain('sign_out', {}),
    session_only: () => plain('session_only', {}),
    set_dirty: (dirty: unknown) => plain('set_dirty', { dirty }),
    check_update: () => plain('check_update', {}),
    install_update: () => plain('install_update', {}),
    upload_files: (kind: unknown, targetId: unknown, onEvent: unknown) => withEvents('upload_files', { kind, targetId }, onEvent),
    export_gowns: (kind: unknown, ids: unknown, onEvent: unknown) => withEvents('export_gowns', { kind, ids }, onEvent),
  }
}
export type Bridge = ReturnType<typeof createBridge>
