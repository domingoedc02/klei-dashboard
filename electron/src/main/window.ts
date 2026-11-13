import { app, BrowserWindow, session, type Session } from 'electron'
import { join } from 'node:path'
import { APP_URL, isAppUrl, PERMISSIONS_ALLOWED, webPreferences } from './boundary.ts'
import { MAIN_WINDOW } from './identity.ts'
import { installAppProtocol } from './protocol.ts'

let main: BrowserWindow | undefined

// One non-persistent session for all content (spike 4): nothing from the page reaches disk, and the app:// handler lives only here.
export function setupSession(): Session {
  const ses = session.fromPartition('klei')
  // KLEI_RENDERER_DIR serves a hostile test page; ignored in a packaged app.
  const dir = !app.isPackaged && process.env.KLEI_RENDERER_DIR ? process.env.KLEI_RENDERER_DIR : join(__dirname, '..', 'renderer')
  installAppProtocol(ses, dir)
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
  })
}

export function createMainWindow(ses: Session): BrowserWindow {
  const win = new BrowserWindow({ ...MAIN_WINDOW, webPreferences: { ...webPreferences(app.isPackaged), session: ses } })
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => { main = undefined })
  void win.loadURL(APP_URL)
  main = win
  return win
}

export function focusMainWindow(): void {
  if (!main) return
  if (main.isMinimized()) main.restore()
  main.show()
  main.focus()
}
