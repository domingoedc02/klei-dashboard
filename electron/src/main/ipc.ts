import { ipcMain, type WebContents } from 'electron'
import { DROP_CHANNEL, INVOKE_CHANNEL } from '../shared/commands.ts'
import type { Invoker } from './invoker.ts'
import { dropListener, type Uploader } from './uploads.ts'

// The only ipcMain registrations in the app (a test scans for them). The command name is data the preload sets; it is checked against the closed list before anything runs.
export const registerIpc = (invoker: Invoker, uploader: Uploader) => {
  ipcMain.handle(INVOKE_CHANNEL, (event, command, args, eventId) => invoker.invoke(event, command, args, eventId))
  // The one-way private channel the preload uses for window drags (17.2): trusted main frame only, exact message shape only.
  ipcMain.on(DROP_CHANNEL, dropListener(invoker.trusted, uploader))
}

// Reload, close or crash: running calls stop as `cancel` would and their event ids are forgotten.
export function releaseOnGone(wc: WebContents, invoker: Invoker): void {
  const id = wc.id
  const gone = () => invoker.release(id)
  wc.on('did-start-navigation', (d) => { if (d.isMainFrame && !d.isSameDocument) gone() })
  wc.on('render-process-gone', gone)
  wc.once('destroyed', gone)
}
