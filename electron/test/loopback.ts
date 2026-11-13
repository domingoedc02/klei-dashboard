// In-process stand-in for Electron: a preload bridge wired straight to a main invoker, with the same {ok}|{err} envelope and event channels.
import { createBridge, type Ipc } from '../src/preload/bridge.ts'
import { createInvoker, type FrameLike, type Handlers, type InvokeEventLike } from '../src/main/invoker.ts'
import { COMMANDS } from '../src/shared/commands.ts'
import { BridgeError } from '../src/shared/errors.ts'

export const frame = (over: Partial<FrameLike> = {}): FrameLike => ({ url: 'app://klei/', origin: 'app://klei', parent: null, ...over })

export function fakeSender(id = 1) {
  const sent: { channel: string; payload: unknown }[] = []
  const listeners = new Map<string, Set<(e: unknown, p: unknown) => void>>()
  const mainFrame = frame()
  const sender = {
    id,
    mainFrame,
    destroyed: false,
    isDestroyed() { return this.destroyed },
    send(channel: string, payload: unknown) {
      sent.push({ channel, payload })
      for (const l of listeners.get(channel) ?? []) l({}, payload)
    },
  }
  return { sender, sent, listeners, mainFrame }
}

export const stubHandlers = (over: Partial<Record<(typeof COMMANDS)[number], (a: never, c: never) => Promise<unknown>>> = {}): Handlers => {
  const h: Record<string, unknown> = {}
  for (const c of COMMANDS) h[c] = over[c] ?? (() => Promise.reject(new BridgeError('failed', 'not implemented')))
  return h as Handlers
}

export function loopback(handlers: Handlers, opts: { trusted?: boolean; frame?: FrameLike | null } = {}) {
  const fs = fakeSender()
  const logs: string[] = []
  const calls: { channel: string; args: unknown[] }[] = []
  const invoker = createInvoker({ handlers, trustedSender: () => opts.trusted ?? true, log: (r) => logs.push(r) })
  const event: InvokeEventLike = { sender: fs.sender, senderFrame: opts.frame === undefined ? fs.mainFrame : opts.frame }
  const ipc: Ipc = {
    invoke: (channel, ...args) => { calls.push({ channel, args }); return invoker.invoke(event, args[0], args[1], args[2]) },
    on: (channel, l) => void (fs.listeners.get(channel) ?? fs.listeners.set(channel, new Set()).get(channel)!).add(l),
    removeListener: (channel, l) => void fs.listeners.get(channel)?.delete(l),
  }
  let n = 0
  const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
  return { bridge: createBridge(ipc, id), invoker, fs, logs, calls, event, ipc }
}
