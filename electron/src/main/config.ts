import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Config {
  api: string
  auth: string
  signInTimeoutMs: number
  requestTimeoutMs: number
  /** One photo upload, up to 25 MB on a slow link. */
  uploadTimeoutMs: number
  /** Wait before an upload is re-sent after a network error or a busy server. */
  retryDelayMs: number
  smoke: boolean
}

const strip = (u: string) => u.replace(/\/+$/, '')

/** Backend and Auth Web URLs are build-time constants written by scripts/build-main.mjs; the page never sees them. */
export function loadConfig(dir: string, env: NodeJS.ProcessEnv = process.env): Config {
  const built = JSON.parse(readFileSync(join(dir, 'build-config.json'), 'utf8')) as { api: string; auth: string }
  return {
    api: strip(built.api),
    auth: strip(built.auth),
    signInTimeoutMs: 300_000,
    requestTimeoutMs: 10_000,
    uploadTimeoutMs: 120_000,
    retryDelayMs: 3_000,
    smoke: env.KLEI_SMOKE === '1',
  }
}
