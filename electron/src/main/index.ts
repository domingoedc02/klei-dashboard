import { app, Menu } from 'electron'
import { join } from 'node:path'
import { APP_ID, PRODUCT_NAME, SMOKE_EXIT_MS, USER_DATA_DIR } from './identity.ts'
import { createMainWindow, focusMainWindow } from './window.ts'

// Before `ready`: own profile, never the Tauri app's directory. The single-instance lock follows userData, so an installed Tauri app starts independently.
app.setName(PRODUCT_NAME)
app.setPath('userData', join(app.getPath('appData'), USER_DATA_DIR))
app.setAppUserModelId(APP_ID)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', focusMainWindow)
  app.on('window-all-closed', () => app.quit())
  void app.whenReady().then(() => {
    // Tauri shows no menu bar on Windows and Linux; macOS keeps the default (Edit keys, Quit).
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
    createMainWindow()
    if (process.env.KLEI_SMOKE === '1') setTimeout(() => app.exit(1), SMOKE_EXIT_MS).unref()
  })
}
