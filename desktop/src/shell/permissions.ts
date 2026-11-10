import type { IconName } from './icons';

/** Sidebar items and the Permission that opens each; an empty list means every signed-in User (A-UX7). */
export const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', any: [] },
  { id: 'upload', label: 'AI Upload', icon: 'upload', any: ['PERM_UPLOAD_IMAGES'] },
  { id: 'gallery', label: 'Gallery', icon: 'gallery', any: ['PERM_VIEW_GALLERY'] },
  { id: 'inquiries', label: 'Inquiries', icon: 'inquiries', any: ['PERM_REPLY', 'PERM_CLOSE_INQUIRY'] },
  { id: 'settings', label: 'Settings', icon: 'settings', any: [] },
] as const satisfies ReadonlyArray<{ id: string; label: string; icon: IconName; any: readonly string[] }>;

export type RouteId = (typeof NAV)[number]['id'];

/** Start pages a User may choose (FR-33) and the Permission each needs; `dashboard` is open to everyone. */
export const START_PAGES = [
  { id: 'dashboard', label: 'Dashboard', any: [] },
  { id: 'gallery', label: 'Gallery', any: ['PERM_VIEW_GALLERY'] },
  { id: 'upload', label: 'AI Upload', any: ['PERM_UPLOAD_IMAGES'] },
  { id: 'inquiries', label: 'Inquiries', any: ['PERM_REPLY'] },
] as const satisfies ReadonlyArray<{ id: RouteId; label: string; any: readonly string[] }>;

/** The screen to open after sign-in: the chosen one if the User may still open it, else the Dashboard. */
export function startRoute(page: string | undefined, held: readonly string[] | undefined): RouteId {
  const p = START_PAGES.find((s) => s.id === page);
  const nav = NAV.find((n) => n.id === page);
  return p && nav && allows(held, p.any) && allows(held, nav.any) ? p.id : 'dashboard';
}

export const ASSISTANT_NEEDS = ['PERM_REPLY'] as const;

export function allows(held: readonly string[] | undefined, any: readonly string[]): boolean {
  return any.length === 0 || any.some((p) => held?.includes(p));
}
