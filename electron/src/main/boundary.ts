export const APP_URL = 'app://klei/'

// Empty on purpose. 17.6 may add one entry, only with a packaged-app test showing the original needs it.
export const PERMISSIONS_ALLOWED: readonly string[] = []

export const webPreferences = (packaged: boolean) => ({
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  spellcheck: true,
  devTools: !packaged,
}) as const

export function isAppUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'app:' && u.hostname === 'klei' && u.port === '' && u.username === '' && u.password === ''
  } catch {
    return false
  }
}
