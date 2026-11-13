import { app, Menu, shell } from 'electron'
import { join } from 'node:path'
import { APP_ID, KEYCHAIN_SERVICE, PRODUCT_NAME, SMOKE_EXIT_MS, USER_DATA_DIR } from './identity.ts'
import { createHandlers } from './commands.ts'
import { loadConfig } from './config.ts'
import { createInvoker } from './invoker.ts'
import { registerIpc, releaseOnGone } from './ipc.ts'
import { OsKeychain, SwitchKeychain } from './keychain.ts'
import { registerAppScheme } from './protocol.ts'
import { Session } from './session.ts'
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
  void app.whenReady().then(() => {
    // Tauri shows no menu bar on Windows and Linux; macOS keeps the default (Edit keys, Quit).
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
    const cfg = loadConfig(__dirname)
    // Memory token: smoke runs (CI has no credential store) and unpackaged builds (every rebuild is a new identity, so the OS asks again). KLEI_KEYCHAIN=os forces the real one.
    const keychain = new SwitchKeychain(new OsKeychain(KEYCHAIN_SERVICE), cfg.smoke || (!app.isPackaged && process.env.KLEI_KEYCHAIN !== 'os'))
    const session = new Session(cfg, keychain, { open: (url) => void shell.openExternal(url).catch((e: Error) => console.warn(`open browser failed: ${e.message}`)) })
    const handlers = createHandlers({ session, useMemory: () => keychain.useMemory(), exit: (code) => app.exit(code) })
    const invoker = createInvoker({ handlers, trustedSender: isMainContents, log: (reason) => console.warn(`ipc rejected: ${reason}`) })
    registerIpc(invoker)
    releaseOnGone(createMainWindow(setupSession()).webContents, invoker)
    if (process.env.KLEI_SMOKE === '1') setTimeout(() => app.exit(1), SMOKE_EXIT_MS).unref()
  })
}
