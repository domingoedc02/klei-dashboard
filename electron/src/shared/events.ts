// Shapes copied from desktop/src/bridge.ts; types-match.test.ts compares them with that file's text.
export type RejectReason = 'type' | 'size' | 'full' | 'dimensions' | 'unreadable'

export interface ApiResponse<T = unknown> { status: number; body: T | null; refreshed?: boolean }

export interface UploadProgress { done: number; total: number; waiting: boolean; photoId: string | null }
export type UploadEvent = ({ type: 'progress' } & UploadProgress) | { type: 'drag'; over: boolean } | { type: 'dropped'; count: number }
export interface UploadSummary { stored: string[]; rejected: { name: string; reason: RejectReason }[]; cancelled: boolean }
export type UploadKind = 'photo' | 'dropped' | 'cancel' | 'watch' | 'unwatch' | 'avatar' | 'attachment'

export interface ExportProgress { done: number; total: number }
export interface ExportSummary { gowns: number; photos: number; cancelled: boolean }

export type UpdateStatus = { status: 'none' } | { status: 'available'; version: string }

export const UPLOAD_KINDS = ['photo', 'dropped', 'cancel', 'watch', 'unwatch', 'avatar', 'attachment'] as const satisfies readonly UploadKind[]
export const EXPORT_KINDS = ['start', 'cancel'] as const
export const UPLOAD_EVENT_TYPES = ['progress', 'drag', 'dropped'] as const
export const UPLOAD_PROGRESS_FIELDS = ['done', 'total', 'waiting', 'photoId'] as const
export const EXPORT_PROGRESS_FIELDS = ['done', 'total'] as const
