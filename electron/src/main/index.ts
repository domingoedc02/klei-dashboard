import { app, dialog, Menu, shell } from 'electron'
import { join } from 'node:path'
import { APP_ID, KEYCHAIN_SERVICE, PRODUCT_NAME, SMOKE_EXIT_MS, USER_DATA_DIR } from './identity.ts'
import { loopbackRedirect } from './auth.ts'
import { createHandlers } from './commands.ts'
import { loadConfig } from './config.ts'
import { createInvoker } from './invoker.ts'
import { registerIpc, releaseOnGone } from './ipc.ts'
import { OsKeychain, SwitchKeychain } from './keychain.ts'
import { registerAppScheme } from './protocol.ts'
import { Session } from './session.ts'
import { EXTENSIONS, Uploader } from './uploads.ts'
import { createMainWindow, focusMainWindow, hardenWebContents, isMainContents, setupSession } from './window.ts'

// Before `ready`: own profile, never the Tauri app's directory. The single-instance lock follows userData, so an installed Tauri app starts independently.
app.setName(PRODUCT_NAME)
// KLEI_USER_DATA lets tests use a throwaway profile; ignored in a packaged app.
app.setPath('userData', !app.isPackaged && process.env.KLEI_USER_DATA ? process.env.KLEI_USER_DATA : join(app.getPath('appData'), USER_DATA_DIR))
registerAppScheme()
hardenWebContents()
app.setAppUserModelId(APP_ID)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', focusMainWindow)
  app.on('window-all-closed', () => app.quit())
  const pick = async (kind: 'photo' | 'avatar' | 'attachment') => {
    const r = await dialog.showOpenDialog({
      properties: kind === 'avatar' ? ['openFile'] : ['openFile', 'multiSelections'],
      ...(kind === 'attachment' ? {} : { filters: [{ name: 'Photos', extensions: EXTENSIONS }] }),
    })
    return r.canceled ? [] : r.filePaths
  }
  const save = async (suggested: string) => {
    const r = await dialog.showSaveDialog({ defaultPath: suggested, filters: [{ name: 'Zip archive', extensions: ['zip'] }] })
    return r.canceled ? null : r.filePath
  }
  void app.whenReady().then(() => {
    // Tauri shows no menu bar on Windows and Linux; macOS keeps the default (Edit keys, Quit).
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
    const cfg = loadConfig(__dirname)
    // Memory token: smoke runs (CI has no credential store) and unpackaged builds (every rebuild is a new identity, so the OS asks again). KLEI_KEYCHAIN=os forces the real one.
    const keychain = new SwitchKeychain(new OsKeychain(KEYCHAIN_SERVICE), cfg.smoke || (!app.isPackaged && process.env.KLEI_KEYCHAIN !== 'os'))
    // The preview never registers klei://, so sign-in always returns through the loopback listener (AD-27).
    const session = new Session(cfg, keychain, { redirect: loopbackRedirect, open: (url) => void shell.openExternal(url).catch((e: Error) => console.warn(`open browser failed: ${e.message}`)) })
    const uploader = new Uploader()
    const handlers = createHandlers({ session, useMemory: () => keychain.useMemory(), exit: (code) => app.exit(code), pick, save, uploader })
    const invoker = createInvoker({ handlers, trustedSender: isMainContents, log: (reason) => console.warn(`ipc rejected: ${reason}`) })
    registerIpc(invoker, uploader)
    releaseOnGone(createMainWindow(setupSession(session)).webContents, invoker)
    if (process.env.KLEI_SMOKE === '1') setTimeout(() => app.exit(1), SMOKE_EXIT_MS).unref()
  })
}
