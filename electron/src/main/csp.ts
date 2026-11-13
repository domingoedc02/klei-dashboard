// Same value as desktop/src-tauri/tauri.conf.json `app.security.csp` (release). Checked against it in boundary.test.ts.
export const CSP = "default-src 'self'; img-src 'self' klei-img: data:; connect-src 'none'; style-src 'self'; script-src 'self'; font-src 'self'"

const IMG_SRC = "img-src 'self' klei-img: data:"
/** Windows reaches the image protocol over one http origin (platform.ts); `connect-src` stays none. */
export const WINDOWS_IMG_ORIGIN = 'http://klei-img.localhost'
export const cspFor = (platform: string = process.platform): string => (platform === 'win32' ? CSP.replace(IMG_SRC, `${IMG_SRC} ${WINDOWS_IMG_ORIGIN}`) : CSP)
export const SECURITY_HEADERS = { 'Content-Security-Policy': cspFor(), 'X-Content-Type-Options': 'nosniff' } as const
