import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const path = (p: string) => fileURLToPath(new URL(p, import.meta.url))
export const ROOT = path('..')
const { _electron } = createRequire(path('../../desktop/package.json'))('@playwright/test')
const electronBin: string = createRequire(path('../package.json'))('electron')

export const build = () => { execFileSync(process.execPath, [join(ROOT, 'scripts/build-main.mjs')], { stdio: 'inherit' }) }

/** The built main process on a throwaway profile, serving a test page instead of the renderer. */
export const launch = (profile: string, renderer: string, env: Record<string, string> = {}) =>
  _electron.launch({ executablePath: electronBin, args: [join(ROOT, 'build/main/index.js')], cwd: ROOT, env: { ...process.env, KLEI_USER_DATA: profile, KLEI_RENDERER_DIR: renderer, ...env } })
