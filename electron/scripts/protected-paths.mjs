// Protected-path gate (story 14.1). Exit 0: original Tauri app untouched. Exit 1: lists each offending path.
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const BASELINE = '8083c944b523285c1fce33bb2f1d3331bc0c350d'
export const PROTECTED = [
  'desktop', 'backend', 'infra', 'prototype', 'docs/api',
  'docs/install-guide.md', 'docs/release-checklist.md', '.github/workflows',
]
const ELECTRON_YML = /^\.github\/workflows\/electron[^/]*\.yml$/
const ADDED = /^(\?\?| A|A |AM)$/

/** Pure: `git diff --name-status BASELINE -- PROTECTED` and `git status --porcelain --untracked-files=all -- PROTECTED`. */
export function evaluate(diffText, statusText) {
  const bad = []
  for (const line of diffText.split('\n').filter(Boolean)) {
    const [code, ...paths] = line.split('\t')
    if (code === 'A' && ELECTRON_YML.test(paths[0])) continue
    bad.push(`${code[0]} ${paths.join(' -> ')}`)
  }
  for (const line of statusText.split('\n').filter(Boolean)) {
    const xy = line.slice(0, 2)
    const path = line.slice(3).split(' -> ').pop()
    if (ADDED.test(xy) && ELECTRON_YML.test(path)) continue
    bad.push(`${xy === '??' ? '??' : xy.trim()} ${line.slice(3)}`)
  }
  const report = [...new Set(bad)]
  return { code: report.length ? 1 : 0, report }
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd: execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim() })
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    git('cat-file', '-e', `${BASELINE}^{commit}`)
    const { code, report } = evaluate(
      git('diff', '--name-status', BASELINE, '--', ...PROTECTED),
      git('status', '--porcelain', '--untracked-files=all', '--', ...PROTECTED),
    )
    if (code === 0) console.log('protected paths unchanged')
    else console.error(`protected paths changed:\n${report.join('\n')}`)
    process.exit(code)
  } catch (e) {
    console.error(`gate could not run: ${e.message}`)
    process.exit(1)
  }
}
