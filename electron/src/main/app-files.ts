import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, join, sep } from 'node:path'
import { SECURITY_HEADERS } from './csp.ts'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

// Every segment is decoded and checked, then the real path (symlinks followed) must stay under the real root.
export async function resolveAppFile(root: string, pathname: string): Promise<string | undefined> {
  const path = pathname === '' || pathname === '/' ? '/index.html' : pathname
  if (!path.startsWith('/')) return undefined
  let segs: string[]
  try {
    segs = path.slice(1).split('/').map(decodeURIComponent)
  } catch {
    return undefined
  }
  if (segs.some((s) => s === '' || s === '.' || s === '..' || /[\\/:\0]/.test(s))) return undefined
  try {
    const base = await realpath(root)
    const file = await realpath(join(base, ...segs))
    return file.startsWith(base + sep) && (await stat(file)).isFile() ? file : undefined
  } catch {
    return undefined
  }
}

export async function serveAppFile(root: string, req: { url: string; method: string }): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { ...SECURITY_HEADERS, Allow: 'GET, HEAD' } })
  }
  const u = new URL(req.url)
  const file = u.hostname === 'klei' ? await resolveAppFile(root, u.pathname) : undefined
  const type = file && MIME[extname(file).toLowerCase()]
  if (!file || !type) return new Response(null, { status: 404, headers: { ...SECURITY_HEADERS } })
  const body = req.method === 'HEAD' ? null : new Uint8Array(await readFile(file))
  return new Response(body, { headers: { ...SECURITY_HEADERS, 'Content-Type': type } })
}
