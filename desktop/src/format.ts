import type { components } from './api/schema';

export type Prefs = components['schemas']['PreferencesView'];

// shortcut: one module-level setting, written by the Shell whenever `/me` is read; fine while a window shows one User, revisit if two Users can share a window.
let current: Prefs | undefined;
export const setFormatPrefs = (p?: Prefs | null): void => { current = p ?? undefined; };

function parts(d: Date): Record<string, string> {
  const opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true };
  let f: Intl.DateTimeFormat;
  try {
    f = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: current?.timezone || undefined });
  } catch {
    f = new Intl.DateTimeFormat('en-US', opts); // a zone this runtime does not know: the computer's own
  }
  return Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
}

const when = (v: string | number | Date): Date | null => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** The date in the User's chosen order and zone. */
export function formatDate(v: string | number | Date): string {
  const d = when(v);
  if (!d) return '';
  const p = parts(d);
  switch (current?.dateFormat) {
    case 'DD/MM/YYYY': return `${p.day}/${p.month}/${p.year}`;
    case 'YYYY-MM-DD': return `${p.year}-${p.month}-${p.day}`;
    default: return `${p.month}/${p.day}/${p.year}`;
  }
}

/** The date, then the time as 12-hour `h:mm AM`, in the User's chosen zone. */
export function formatDateTime(v: string | number | Date): string {
  const d = when(v);
  if (!d) return '';
  const p = parts(d);
  return `${formatDate(d)}, ${p.hour}:${p.minute} ${p.dayPeriod}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayNo = (p: Record<string, string>) => Date.UTC(+p.year, +p.month - 1, +p.day) / 864e5;

/** A date for a list or card: `9:42 AM` today, `Yesterday`, `Nov 3` this year, `Jun 14, 2027` otherwise; the zone is the User's, `now` is injectable for tests. */
export function formatRelative(v: string | number | Date, now: Date = new Date()): string {
  const d = when(v);
  if (!d) return '';
  const p = parts(d);
  const ago = dayNo(parts(now)) - dayNo(p);
  if (ago === 0) return `${p.hour}:${p.minute} ${p.dayPeriod}`;
  if (ago === 1) return 'Yesterday';
  const md = `${MONTHS[+p.month - 1]} ${+p.day}`;
  return p.year === parts(now).year ? md : `${md}, ${p.year}`;
}

/** Month and year as `Oct 2026`, in the User's zone. */
export function formatMonthYear(v: string | number | Date): string {
  const d = when(v);
  if (!d) return '';
  const p = parts(d);
  return `${MONTHS[+p.month - 1]} ${p.year}`;
}

/** A calendar day given as `YYYY-MM-DD` (a wedding date), in the chosen order; no zone shift because it is not an instant. */
export function formatDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return '';
  switch (current?.dateFormat) {
    case 'DD/MM/YYYY': return `${m[3]}/${m[2]}/${m[1]}`;
    case 'YYYY-MM-DD': return iso;
    default: return `${m[2]}/${m[3]}/${m[1]}`;
  }
}

/** File size for a list: `812 B`, `34 KB`, `2.5 MB`; a dash when unknown. */
export const formatBytes = (n?: number | null) => (n == null ? '–' : n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
