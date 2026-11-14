export const APP_URL = 'app://klei/'

// Copy buttons (Assistant, Viewer, TwoFactor) call navigator.clipboard.writeText; Electron asks for this permission and refuses without it (webview-behavior.test.ts). Reading the clipboard, notifications, media and the rest stay denied.
export const PERMISSIONS_ALLOWED: readonly string[] = ['clipboard-sanitized-write']

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
