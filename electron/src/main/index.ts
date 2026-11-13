import { app, Menu } from 'electron'
import { join } from 'node:path'
import { APP_ID, PRODUCT_NAME, SMOKE_EXIT_MS, USER_DATA_DIR } from './identity.ts'
import { createHandlers } from './commands.ts'
import { loadConfig } from './config.ts'
import { createInvoker } from './invoker.ts'
import { registerIpc, releaseOnGone } from './ipc.ts'
import { MemoryKeychain } from './keychain.ts'
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
    // shortcut: memory keychain until 16.3 wires the OS store; nothing is signed in across launches before then.
    const session = new Session(loadConfig(__dirname), new MemoryKeychain())
    const handlers = createHandlers({ session, exit: (code) => app.exit(code) })
    const invoker = createInvoker({ handlers, trustedSender: isMainContents, log: (reason) => console.warn(`ipc rejected: ${reason}`) })
    registerIpc(invoker)
    releaseOnGone(createMainWindow(setupSession()).webContents, invoker)
    if (process.env.KLEI_SMOKE === '1') setTimeout(() => app.exit(1), SMOKE_EXIT_MS).unref()
  })
}
