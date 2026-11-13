// Runs in the page. Imports the ORIGINAL bridge.ts; `@tauri-apps/api/core` resolves to electron/src/renderer-compat/core.ts.
import { bridge, asBridgeError } from '../../../desktop/src/bridge'

void (async () => {
const out: Record<string, unknown> = {}
const keys = Object.keys((window as any).klei ?? {}).sort()
out.exposedKeys = keys
out.tauriInternalsPresent = '__TAURI_INTERNALS__' in window
out.request = await bridge.request('POST', '/api/v1/x', { a: 1 }, 7, 'idem-1').then((r) => r, (e) => ({ threw: asBridgeError(e) }))
out.requestRejected = await bridge.request('GET', '/boom').then((r) => ({ resolved: r }), (e) => ({ kind: e?.kind, message: e?.message, isError: e instanceof Error, json: JSON.stringify(e) }))
await bridge.setDirty(true)
const up: unknown[] = []
out.upload = { summary: await bridge.uploadFiles('photo', 'target-1', (e) => up.push(e)), events: up }
const ex: unknown[] = []
out.exportRun = { summary: await bridge.exportGowns('start', ['g1', 'g2'], (e) => ex.push(e)), events: ex }
const many: number[] = []
await bridge.uploadFiles('many' as never, 't', (e) => many.push((e as { done: number }).done))
out.manyEvents = { count: many.length, inOrder: many.every((v, i) => v === i + 1) }
out.signIn = await bridge.signIn()
document.title = JSON.stringify(out)
})()
