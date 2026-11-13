export const APP_ID = 'co.klei.bridal.electron.preview'
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
  show: false,
} as const
