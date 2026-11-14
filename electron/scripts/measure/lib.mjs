// Shared bits of the 20.2 measurements. Limits are NFR-2 and are not tuned here.
export const LIMITS = { coldStartMs: 3000, idleMb: 300 }

export const median = (a) => {
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** `rows` are [pid, ppid]; returns root and every process below it. */
export function descendants(rows, root) {
  const out = new Set([root])
  for (let grew = true; grew; ) {
    grew = false
    for (const [p, pp] of rows) if (out.has(pp) && !out.has(p)) out.add(p), (grew = true)
  }
  return [...out]
}

/** One run above the limit is a FAIL; the median is context only. */
export const verdict = (values, limit) => (values.length > 0 && values.every((v) => v <= limit) ? 'PASS' : 'FAIL')
