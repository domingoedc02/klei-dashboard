import type { App } from 'electron'

/** Accepts only `klei://auth/callback?...`; everything else (other schemes, hosts, paths, junk) is ignored. */
export function parseCallback(raw: string): URL | null {
  try {
    const u = new URL(raw)
    return u.protocol === 'klei:' && u.hostname === 'auth' && u.pathname === '/callback' ? u : null
  } catch {
    return null
  }
}

/**
 * Delivers `klei://auth/callback` URLs to `complete`: `open-url` (macOS), the launch argv and `second-instance` argv (Windows, Linux).
 * Not called by the preview: it never registers `klei://`, so the Tauri app keeps the link. Registration, and calling this, is the owner's cutover decision (OQ-M4).
 */
export function attachDeepLink(app: Pick<App, 'on'>, argv: readonly string[], complete: (url: URL) => Promise<void>): void {
  const take = (list: readonly string[]) => {
    for (const a of list) {
      const u = parseCallback(a)
      if (u) complete(u).catch(() => {})
    }
  }
  app.on('open-url', (event, url) => {
    event.preventDefault()
    take([url])
  })
  app.on('second-instance', (_e, args) => take(args))
  take(argv)
}
