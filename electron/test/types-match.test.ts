import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { EXPORT_KINDS, UPLOAD_EVENT_TYPES, UPLOAD_KINDS, UPLOAD_PROGRESS_FIELDS, EXPORT_PROGRESS_FIELDS } from '../src/shared/events.ts'
import { KINDS } from '../src/shared/errors.ts'

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const bridge = readFileSync(path('../../desktop/src/bridge.ts'), 'utf8').replaceAll('\r\n', '\n')
const errorRs = readFileSync(path('../../desktop/src-tauri/src/error.rs'), 'utf8').replaceAll('\r\n', '\n')
const quoted = (s: string) => [...s.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!)
const block = (re: RegExp) => re.exec(bridge)?.[1] ?? assert.fail(`not found: ${re}`)
const fields = (body: string) => [...body.matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]!)
const snake = (s: string) => s.replace(/(?<!^)([A-Z])/g, '_$1').toLowerCase()

test('ErrorKind equals bridge.ts and the Rust Kind enum, in order', () => {
  assert.deepEqual([...KINDS], quoted(block(/export type ErrorKind =([^;]+);/)))
  const rust = [...(/pub enum Kind \{([^}]+)\}/.exec(errorRs)?.[1] ?? '').matchAll(/^\s*(\w+),/gm)].map((m) => snake(m[1]!))
  assert.deepEqual([...KINDS], rust)
})

test('UploadKind list equals bridge.ts', () => {
  assert.deepEqual([...UPLOAD_KINDS].sort(), quoted(block(/export type UploadKind =([^;]+);/)).sort())
})

test('export kinds equal bridge.ts', () => {
  assert.deepEqual([...EXPORT_KINDS], quoted(block(/exportGowns: \(kind: ([^,]+),/)))
})

test('event shapes equal bridge.ts', () => {
  assert.deepEqual([...UPLOAD_PROGRESS_FIELDS], fields(block(/export interface UploadProgress \{([^}]+)\}/)))
  assert.deepEqual([...EXPORT_PROGRESS_FIELDS], fields(block(/export interface ExportProgress \{([^}]+)\}/)))
  const ev = block(/export type UploadEvent =([\s\S]+?);\n\n/)
  assert.deepEqual([...UPLOAD_EVENT_TYPES], [...ev.matchAll(/type: '(\w+)'/g)].map((m) => m[1]))
  assert.match(ev, /\{ type: 'drag'; over: boolean \}/)
  assert.match(ev, /\{ type: 'dropped'; count: number \}/)
  assert.deepEqual(fields(block(/export interface UploadSummary \{([^}]*\{[^}]*\}[^}]*)\}/).replace(/\{[^}]*\}/g, '')), ['stored', 'rejected', 'cancelled'])
  assert.deepEqual(fields(block(/export interface ExportSummary \{([^}]+)\}/)), ['gowns', 'photos', 'cancelled'])
  assert.match(bridge, /export type RejectReason = 'type' \| 'size' \| 'full' \| 'dimensions' \| 'unreadable';/)
  assert.match(bridge, /export type UpdateStatus = \{ status: 'none' \} \| \{ status: 'available'; version: string \};/)
  assert.deepEqual(fields(block(/export interface ApiResponse<T = unknown> \{([^}]+)\}/)), ['status', 'body', 'refreshed'])
})

test('the nine invoke call sites in bridge.ts use exactly the closed command names', () => {
  const names = [...bridge.matchAll(/invoke<[^>]*(?:<[^>]*>)?>\('(\w+)'/g)].map((m) => m[1]!)
  assert.deepEqual([...new Set(names)].sort(), ['api_request', 'check_update', 'export_gowns', 'install_update', 'session_only', 'set_dirty', 'sign_in', 'sign_out', 'upload_files'])
  assert.equal(names.length, 9)
})
