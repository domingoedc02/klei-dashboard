// Stands in for `@tauri-apps/api/core` in the Electron build (alias in electron/vite.config.mjs), so desktop/src/bridge.ts:1 works unchanged.
// Each of the nine commands goes to its own named method on `window.klei`; the page never sends a command name through preload.
type Cb = (e: unknown) => void
type Native = {
  api_request(request: unknown): Promise<unknown>
  sign_in(): Promise<unknown>
  sign_out(): Promise<unknown>
  session_only(): Promise<unknown>
  set_dirty(dirty: boolean): Promise<unknown>
  check_update(): Promise<unknown>
  install_update(): Promise<unknown>
  upload_files(kind: string, targetId: string, onEvent: Cb): Promise<unknown>
  export_gowns(kind: string, ids: string[], onEvent: Cb): Promise<unknown>
}
const native = () => (window as unknown as { klei: Native }).klei

// bridge.ts only assigns `onmessage`. Class instances do not cross contextBridge, so the page keeps this object and hands preload a plain callback.
export class Channel<T = unknown> {
  onmessage: (m: T) => void = () => {}
}

export async function invoke<R>(cmd: string, args: Record<string, unknown> = {}): Promise<R> {
  const n = native()
  const ch = args.onEvent as Channel | undefined
  const send: Cb = (m) => ch?.onmessage(m)
  switch (cmd) {
    case 'api_request': return (await n.api_request(args.request)) as R
    case 'sign_in': return (await n.sign_in()) as R
    case 'sign_out': return (await n.sign_out()) as R
    case 'session_only': return (await n.session_only()) as R
    case 'set_dirty': return (await n.set_dirty(args.dirty as boolean)) as R
    case 'check_update': return (await n.check_update()) as R
    case 'install_update': return (await n.install_update()) as R
    case 'upload_files': return (await n.upload_files(args.kind as string, args.targetId as string, send)) as R
    case 'export_gowns': return (await n.export_gowns(args.kind as string, args.ids as string[], send)) as R
    default: throw { kind: 'bad_request', message: 'unknown command' }
  }
}
