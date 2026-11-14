// The one place a renderer request becomes native work. No electron import, so it runs under plain Node in tests (ipc.ts wires it to ipcMain).
import { CHANNEL_COMMANDS, eventChannel, isCommand, isEventId, validate, type Args, type Command, type Envelope } from '../shared/commands.ts'
import { toBridgeError } from '../shared/errors.ts'
import { isAppUrl } from './boundary.ts'

export interface FrameLike { url: string; origin: string; parent: unknown }
export interface InvokeEventLike {
  sender: { id: number; mainFrame: unknown; isDestroyed(): boolean; send(channel: string, ...args: unknown[]): void }
  senderFrame: FrameLike | null
}

export interface Ctx {
  /** Aborted when the page reloads, the window closes or the renderer dies. Handlers stop as `cancel` would. */
  signal: AbortSignal
  /** Channel commands only. Dropped after abort. */
  emit(message: unknown): void
}
export type Handlers = { [C in Command]: (args: Args[C], ctx: Ctx) => Promise<unknown> }

export interface InvokerDeps {
  handlers: Handlers
  trustedSender(webContentsId: number): boolean
  /** Reason only, never arguments. */
  log(reason: string): void
}

const bad = (): Envelope => ({ err: { kind: 'bad_request', message: 'bad request' } })

export function createInvoker({ handlers, trustedSender, log }: InvokerDeps) {
  const live = new Map<number, Map<string, AbortController>>()
  const callsOf = (senderId: number) => live.get(senderId) ?? live.set(senderId, new Map()).get(senderId)!

  const trusted = (e: InvokeEventLike): boolean => {
    const f = e.senderFrame
    return f !== null && trustedSender(e.sender.id) && f === e.sender.mainFrame && f.parent === null && f.origin === 'app://klei' && isAppUrl(f.url)
  }

  async function invoke(e: InvokeEventLike, command: unknown, args: unknown, eventId: unknown): Promise<Envelope> {
    if (!trusted(e)) { log('untrusted sender'); return bad() }
    if (!isCommand(command)) { log('unknown command'); return bad() }
    const channel = (CHANNEL_COMMANDS as readonly string[]).includes(command)
    if (channel !== (eventId !== undefined)) { log('event id mismatch'); return bad() }
    let checked: Args[Command]
    try {
      checked = validate(command, args)
    } catch (x) {
      log('invalid arguments')
      return { err: toBridgeError(x) }
    }
    const calls = callsOf(e.sender.id)
    if (channel && (!isEventId(eventId) || calls.has(eventId))) { log('bad event id'); return bad() }

    const abort = new AbortController()
    const id = channel ? (eventId as string) : ''
    if (channel) calls.set(id, abort)
    let index = 0
    const post = (payload: unknown) => {
      if (!abort.signal.aborted && !e.sender.isDestroyed()) e.sender.send(eventChannel(id), payload)
    }
    const ctx: Ctx = { signal: abort.signal, emit: (message) => { if (channel) post({ index: index++, message }) } }
    let out: Envelope
    try {
      out = { ok: await (handlers[command] as (a: Args[Command], c: Ctx) => Promise<unknown>)(checked, ctx) }
    } catch (x) {
      out = { err: toBridgeError(x) }
    }
    if (channel) {
      post({ end: true, index })
      calls.delete(id)
      if (calls.size === 0 && live.get(e.sender.id) === calls) live.delete(e.sender.id)
      out.ended = true
    }
    return out
  }

  // The page went away (reload, close, crash): every call of that sender stops and its callback ids are forgotten.
  const release = (senderId: number) => {
    for (const c of live.get(senderId)?.values() ?? []) c.abort()
    live.delete(senderId)
  }
  return { invoke, release, trusted, liveCalls: () => [...live.values()].reduce((n, m) => n + m.size, 0) }
}
export type Invoker = ReturnType<typeof createInvoker>
