export const APP_ID = 'co.klei.bridal.electron.preview'
// Never `co.klei.bridal`: that is the Tauri app's entry.
export const KEYCHAIN_SERVICE = APP_ID
export const PRODUCT_NAME = 'Klei Bridal Preview'
export const USER_DATA_DIR = 'Klei Bridal Preview'
export const MAIN_LABEL = 'main'
export const SMOKE_EXIT_MS = 60_000

// Same title and sizes as desktop/src-tauri/tauri.conf.json. `show: false`: shown on ready-to-show.
export const MAIN_WINDOW = {
  title: 'Klei Bridal',
  width: 1280,
  height: 800,
  minWidth: 1100,
  minHeight: 700,
  // Tauri sizes the web content (inner size); Electron's default sizes the frame, which cost 32 px of height on macOS.
  useContentSize: true,
  show: false,
} as const
