/** Dashboard clock and figure formats. Zone is the User's Preferences timezone; an unknown zone falls back to the computer's own. */
const zoned = (tz: string | null | undefined, o: Intl.DateTimeFormatOptions) => {
  try {
    return new Intl.DateTimeFormat('en-US', { ...o, timeZone: tz || undefined });
  } catch {
    return new Intl.DateTimeFormat('en-US', o);
  }
};

/** 05:00 to 11:59 morning, 12:00 to 16:59 afternoon, otherwise evening. */
export function greeting(now: Date, tz?: string | null): string {
  const h = Number(zoned(tz, { hour: 'numeric', hourCycle: 'h23' }).format(now));
  return h >= 5 && h < 12 ? 'Good morning' : h >= 12 && h < 17 ? 'Good afternoon' : 'Good evening';
}

/** `Saturday, Nov 7`. */
export const dateLine = (now: Date, tz?: string | null): string => zoned(tz, { weekday: 'long', month: 'short', day: 'numeric' }).format(now);

/** `8:15 AM` when [at] falls on today's date in the zone, otherwise `Nov 5`; blank for junk. */
export function since(at: string, now: Date, tz?: string | null): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const day = zoned(tz, { year: 'numeric', month: 'numeric', day: 'numeric' });
  if (day.format(d) !== day.format(now)) return zoned(tz, { month: 'short', day: 'numeric' }).format(d);
  const p = Object.fromEntries(zoned(tz, { hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.hour}:${p.minute} ${p.dayPeriod}`;
}

/** Under an hour `42m`, under 48 hours `2.4h`, else `3.5d`. */
export function replyTime(seconds: number): string {
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 48 * 3600) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}
