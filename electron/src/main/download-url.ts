const TOKEN = /^[A-Za-z0-9_-]{43,}$/

/** Development builds only (a release build must be given the real one): the local download site with a placeholder token. */
export const DEV_BASE = `http://127.0.0.1:8090/${'x'.repeat(43)}`

/**
 * The download site's base URL, checked at build time: https (plain http only to this machine and only outside a release), no credentials, query or fragment, one path segment that is the secret token.
 * Returns it without a trailing slash. Errors never carry the value.
 */
export function parseBase(raw: string | undefined, release: boolean): string {
  let u: URL
  try {
    u = new URL(raw ?? '')
  } catch {
    throw new Error('KLEI_DOWNLOAD_BASE_URL is missing or not a URL')
  }
  const local = u.protocol === 'http:' && u.hostname === '127.0.0.1' && !release
  if (u.protocol !== 'https:' && !local) throw new Error('KLEI_DOWNLOAD_BASE_URL must be https')
  if (u.username || u.password || u.search || u.hash) throw new Error('KLEI_DOWNLOAD_BASE_URL must be only the site and its path token')
  const token = u.pathname.replace(/^\/|\/$/g, '')
  if (!TOKEN.test(token)) throw new Error('KLEI_DOWNLOAD_BASE_URL needs a path token of 43 or more letters, digits, - or _')
  return `${u.origin}/${token}`
}
