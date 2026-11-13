// Same value as desktop/src-tauri/tauri.conf.json `app.security.csp` (release). Checked against it in boundary.test.ts.
export const CSP = "default-src 'self'; img-src 'self' klei-img: data:; connect-src 'none'; style-src 'self'; script-src 'self'; font-src 'self'"

export const SECURITY_HEADERS = { 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff' } as const
