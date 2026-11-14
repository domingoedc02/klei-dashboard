// Manual update (18.3), the approved Electron-only replacement for desktop/src-tauri/src/update.rs: look for a newer version, then open the download page. Nothing is downloaded, verified, installed or restarted here.
import { BridgeError } from '../shared/errors.ts'

export const DIRTY = 'You have unsent work. Finish or discard it first.'
export const TIMEOUT_MS = 30_000
export const MAX_BYTES = 4096

export type Status = { status: 'none' } | { status: 'available'; version: string }
export interface CheckOptions { timeoutMs?: number; platform?: string; arch?: string }

const ID = String.raw`(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)`
const SEMVER = new RegExp(String.raw`^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(?:-(${ID}(?:\.${ID})*))?$`)
const OS: Record<string, string> = { darwin: 'macos', win32: 'windows', linux: 'linux' }

const parts = (v: string) => {
  const m = SEMVER.exec(v)
  return m ? { n: [Number(m[1]), Number(m[2]), Number(m[3])] as const, pre: m[4]?.split('.') ?? [] } : null
}

/** Semver 2.0 precedence; both must be valid, no build metadata. */
export function compare(a: string, b: string): number {
  const x = parts(a)
  const y = parts(b)
  if (!x || !y) throw new BridgeError('failed', 'update check failed')
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i]! - y.n[i]!
  if (x.pre.length === 0 || y.pre.length === 0) return y.pre.length - x.pre.length
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i]
    const q = y.pre[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    if (p === q) continue
    const num = [/^\d+$/.test(p), /^\d+$/.test(q)]
    if (num[0] && num[1]) return p.length - q.length || (p < q ? -1 : 1)
    if (num[0]) return -1
    if (num[1]) return 1
    return p < q ? -1 : 1
  }
  return 0
}

const failed = () => new BridgeError('failed', 'update check failed')
// Messages are fixed text: the address and the token in it never reach the page or a log.
const network = (e: unknown) => (e instanceof BridgeError ? e : (e as { name?: string })?.name === 'TimeoutError' ? new BridgeError('timeout', 'request timed out') : new BridgeError('offline', 'server unreachable'))

async function read(res: Response): Promise<string> {
  if (Number(res.headers.get('content-length')) > MAX_BYTES) throw failed()
  const chunks: Uint8Array[] = []
  let n = 0
  const reader = res.body?.getReader()
  for (let r = await reader?.read(); r && !r.done; r = await reader?.read()) {
    n += r.value.length
    if (n > MAX_BYTES) {
      void reader?.cancel()
      throw failed()
    }
    chunks.push(r.value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** One GET of `<base>/latest.json`; it carries the app version, OS and architecture and nothing else (no token, cookie or identity). */
export async function check(base: string, current: string, { timeoutMs = TIMEOUT_MS, platform = process.platform, arch = process.arch }: CheckOptions = {}): Promise<Status> {
  if (!parts(current)) throw failed()
  const url = new URL(`${base}/latest.json`)
  url.search = new URLSearchParams({ version: current, os: OS[platform] ?? platform, arch }).toString()
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } })
    if (res.status !== 200) {
      void res.body?.cancel()
      throw failed()
    }
    let version: unknown
    try {
      version = (JSON.parse(await read(res)) as { version?: unknown }).version
    } catch (e) {
      throw e instanceof SyntaxError ? failed() : e
    }
    if (typeof version !== 'string' || !parts(version)) throw failed()
    return compare(version, current) > 0 ? { status: 'available', version } : { status: 'none' }
  } catch (e) {
    throw network(e)
  }
}

/** Opens the fixed page in the system browser. The only URL ever opened is `<base>/`; nothing from the page can change it. */
export async function install(base: string, dirty: boolean, open: (url: string) => Promise<void>): Promise<void> {
  if (dirty) throw new BridgeError('update_refused', DIRTY)
  try {
    await open(`${base}/`)
  } catch {
    throw new BridgeError('failed', 'could not open the download page')
  }
}
