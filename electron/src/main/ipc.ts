import { ipcMain, type WebContents } from 'electron'
import { INVOKE_CHANNEL } from '../shared/commands.ts'
import type { Invoker } from './invoker.ts'

// The only ipcMain registration in the app (a test scans for it). The command name is data the preload sets; it is checked against the closed list before anything runs.
export const registerIpc = (invoker: Invoker) =>
  ipcMain.handle(INVOKE_CHANNEL, (event, command, args, eventId) => invoker.invoke(event, command, args, eventId))

// Reload, close or crash: running calls stop as `cancel` would and their event ids are forgotten.
export function releaseOnGone(wc: WebContents, invoker: Invoker): void {
  const id = wc.id
  const gone = () => invoker.release(id)
  wc.on('did-start-navigation', (d) => { if (d.isMainFrame && !d.isSameDocument) gone() })
  wc.on('render-process-gone', gone)
  wc.once('destroyed', gone)
}
