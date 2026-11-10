import type { components } from '../api/schema';

export type Card = Required<components['schemas']['GownCard']>;
export interface Filters { silhouette: string; fabric: string; days: number }
export interface Loaded { items: Card[]; next: number | null; total: number; matching: number }

export const NONE: Filters = { silhouette: '', fabric: '', days: 0 };

interface Held { user: string; filters: Filters; loaded: Loaded }
let held: Held | null = null;

// shortcut: kept in memory for this session only, so coming back from a Gown restores filters and loaded pages; anything that changes
// Gowns (Save, edit, delete) must call forgetGallery() so the next visit reads fresh data.
export const remember = (user: string, filters: Filters, loaded: Loaded) => { held = { user, filters, loaded }; };
export const recall = (user: string) => (held?.user === user ? held : null);
export const forgetGallery = () => { held = null; };
