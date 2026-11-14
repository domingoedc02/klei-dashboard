import { app, BrowserWindow, dialog, session, type Session } from 'electron'
import { join } from 'node:path'
import { APP_URL, isAppUrl, PERMISSIONS_ALLOWED, webPreferences } from './boundary.ts'
import { MAIN_WINDOW } from './identity.ts'
import { imageHandler } from './image-protocol.ts'
import { installAppProtocol, installImageProtocol } from './protocol.ts'
import type { Session as ApiSession } from './session.ts'

let main: BrowserWindow | undefined

// One non-persistent session for all content (spike 4): nothing from the page reaches disk, and the app:// handler lives only here.
export function setupSession(api: ApiSession): Session {
  const ses = session.fromPartition('klei')
  // KLEI_RENDERER_DIR serves a hostile test page; ignored in a packaged app.
  const dir = !app.isPackaged && process.env.KLEI_RENDERER_DIR ? process.env.KLEI_RENDERER_DIR : join(__dirname, '..', 'renderer')
  installAppProtocol(ses, dir)
  installImageProtocol(ses, imageHandler(api))
  ses.setPermissionRequestHandler((_wc, permission, done) => done(PERMISSIONS_ALLOWED.includes(permission)))
  ses.setPermissionCheckHandler((_wc, permission) => PERMISSIONS_ALLOWED.includes(permission))
  ses.setDevicePermissionHandler(() => false)
  return ses
}

// Covers every web contents, including frames: no popups, no webviews, no navigation away from app://klei/.
export function hardenWebContents(): void {
  app.on('web-contents-created', (_e, wc) => {
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    const stay = (e: { url: string; preventDefault(): void }) => {
      if (!isAppUrl(e.url)) e.preventDefault()
    }
    wc.on('will-navigate', stay)
    wc.on('will-redirect', stay)
    wc.on('will-frame-navigate', stay)
    wc.on('will-attach-webview', (e) => e.preventDefault())
    // A page with a `beforeunload` handler (Review with unsaved edits) is never closed silently: Electron shows no prompt of its own, so ask here. Same words as the in-app leave dialog.
    wc.on('will-prevent-unload', (e) => {
      const win = BrowserWindow.fromWebContents(wc)
      const opts = { type: 'warning' as const, title: 'Leave without saving?', message: 'Leave without saving?', detail: 'Your changes to this batch will be lost.', buttons: ['Keep reviewing', 'Leave'], defaultId: 0, cancelId: 0, noLink: true }
      const leave = (win ? dialog.showMessageBoxSync(win, opts) : dialog.showMessageBoxSync(opts)) === 1
      if (leave) e.preventDefault()
    })
  })
}

export function createMainWindow(ses: Session): BrowserWindow {
  const win = new BrowserWindow({ ...MAIN_WINDOW, webPreferences: { ...webPreferences(app.isPackaged), session: ses, preload: join(__dirname, '..', 'preload', 'index.js') } })
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => { main = undefined })
  void win.loadURL(APP_URL)
  main = win
  return win
}

export const isMainContents = (id: number): boolean => main !== undefined && !main.isDestroyed() && main.webContents.id === id

export function focusMainWindow(): void {
  if (!main) return
  if (main.isMinimized()) main.restore()
  main.show()
  main.focus()
}
