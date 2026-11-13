import { BrowserWindow } from 'electron'
import { MAIN_WINDOW } from './identity.ts'

let main: BrowserWindow | undefined

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({ ...MAIN_WINDOW })
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => { main = undefined })
  void win.loadURL('about:blank')
  main = win
  return win
}

export function focusMainWindow(): void {
  if (!main) return
  if (main.isMinimized()) main.restore()
  main.show()
  main.focus()
}
