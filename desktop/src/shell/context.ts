import { createContext, useContext, type ReactNode } from 'react';
import type { components } from '../api/schema';
import type { ApiResponse } from '../bridge';
import type { Prefs } from '../format';

export type ToastAction = { label: string; run: () => void };
export type Me = components['schemas']['MeResponse'];

/** A confirm dialog, or a custom one whose body draws its own fields and buttons (Invite/Edit staff). */
export type DialogSpec = { title: string } & (
  | { body: ReactNode; confirm: { label: string; danger?: boolean; run: () => void }; cancel?: string; custom?: undefined }
  | { custom: (close: () => void) => ReactNode; body?: undefined; confirm?: undefined; cancel?: undefined }
);

export interface ShellApi {
  me: Me;
  offline: boolean;
  /** True when the User holds any one of these Permissions (an empty list is always true). */
  can(any: readonly string[]): boolean;
  /** Every screen request goes through here so failures feed the connection banner, 403 view and expiry. */
  request<T = unknown>(method: string, path: string, body?: unknown, ifMatch?: number, idempotencyKey?: string): Promise<ApiResponse<T>>;
  /** An action (Undo) keeps the toast for 8 s instead of 5. */
  toast(text: string, kind?: 'info' | 'error', action?: ToastAction): void;
  openDialog(spec: DialogSpec): void;
  openDrawer(title: string, content: ReactNode): void;
  closeDrawer(): void;
  /** Read `/api/v1/me` again so the top bar follows a changed name or avatar. */
  reloadMe(): Promise<void>;
  /** Take the preferences the server just answered, so dates and the start page follow without another read of `/me`. */
  applyPreferences(p: Prefs): void;
  /** Ask the update feed now; the answer shows as a banner or a toast, because the User asked. */
  checkForUpdates(): Promise<void>;
  /** Tell the shell unsaved work exists; the updater reads it before installing (story 9.3). */
  setDirty(dirty: boolean): void;
}

export const ShellCtx = createContext<ShellApi | null>(null);

export function useShell(): ShellApi {
  const c = useContext(ShellCtx);
  if (!c) throw new Error('useShell outside Shell');
  return c;
}
