export type Mode = 'once' | 'weekly' | 'daily';
export type Schedule = { mode: Mode; days: string[]; start: string; end: string; from: string; to: string };

export const DAYS: readonly [string, string, string][] = [
  ['mon', 'Mon', 'Monday'], ['tue', 'Tue', 'Tuesday'], ['wed', 'Wed', 'Wednesday'], ['thu', 'Thu', 'Thursday'],
  ['fri', 'Fri', 'Friday'], ['sat', 'Sat', 'Saturday'], ['sun', 'Sun', 'Sunday'],
];
export const MODES: readonly [Mode, string, string][] = [
  ['once', 'One time only', 'Closed on a date or date range. Good for holidays.'],
  ['weekly', 'Weekly', 'Closed on the same days every week.'],
  ['daily', 'Every day', 'Closed outside hours, every day.'],
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };
const time = (t: string) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

/** The rule the server also applies; '' means the schedule is valid. */
export function scheduleError(s: Schedule): string {
  if (s.mode === 'once') return !s.start ? 'Pick the first day closed.' : s.end && s.end < s.start ? 'The last day can’t be before the first day.' : '';
  if (s.mode === 'weekly') return s.days.length ? '' : 'Pick at least one day.';
  return !s.from || !s.to || s.from === s.to ? 'Closing and reopening times must differ.' : '';
}

export function summary(s: Schedule): string {
  const bad = scheduleError(s);
  if (bad) return bad;
  if (s.mode === 'once') return `Closed ${day(s.start)}${s.end && s.end !== s.start ? ` to ${day(s.end)}` : ''}. Happens once.`;
  if (s.mode === 'weekly') return `Closed every ${DAYS.filter(([k]) => s.days.includes(k)).map((d) => d[2]).join(', ')}, all day.`;
  return `Closed every day from ${time(s.from)} until ${time(s.to)}.`;
}
