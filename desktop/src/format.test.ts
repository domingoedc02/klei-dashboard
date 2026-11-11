import { afterEach, describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatMonthYear, formatRelative, setFormatPrefs, type Prefs } from './format';

const base: Prefs = { timezone: 'UTC', dateFormat: 'MM/DD/YYYY', startPage: 'dashboard', enterToSend: false, newInquiry: true, aiFinished: true, teamActivity: true, emailNewInquiry: false, emailAiFinished: false, emailTeamActivity: false, digest: 'never', version: 1 };
const at = '2026-11-08T23:30:00Z';

afterEach(() => setFormatPrefs(null));

describe('formatDate', () => {
  it('follows the chosen order', () => {
    setFormatPrefs({ ...base, dateFormat: 'DD/MM/YYYY' });
    expect(formatDate(at)).toBe('08/11/2026');
    setFormatPrefs({ ...base, dateFormat: 'YYYY-MM-DD' });
    expect(formatDate(at)).toBe('2026-11-08');
    setFormatPrefs({ ...base, dateFormat: 'MM/DD/YYYY' });
    expect(formatDate(at)).toBe('11/08/2026');
  });

  it('follows the chosen zone, and the zone can move the day', () => {
    setFormatPrefs({ ...base, timezone: 'Pacific/Kiritimati' });
    expect(formatDate(at)).toBe('11/09/2026');
    expect(formatDateTime(at)).toBe('11/09/2026, 1:30 PM');
  });

  it('uses US order with no preferences, an unknown zone falls back, and junk is blank', () => {
    expect(formatDate(at)).toMatch(/^\d\d\/\d\d\/2026$/);
    setFormatPrefs({ ...base, timezone: 'Not/AZone' });
    expect(formatDate(at)).toMatch(/^\d\d\/\d\d\/2026$/);
    expect(formatDate('nonsense')).toBe('');
    expect(formatDateTime('nonsense')).toBe('');
  });
});

describe('formatRelative', () => {
  const now = new Date('2026-11-11T15:00:00Z');

  it('reads as clock, Yesterday, short month, then month and year', () => {
    setFormatPrefs(base);
    expect(formatRelative('2026-11-11T09:42:00Z', now)).toBe('9:42 AM');
    expect(formatRelative('2026-11-10T23:59:00Z', now)).toBe('Yesterday');
    expect(formatRelative('2026-11-03T08:00:00Z', now)).toBe('Nov 3');
    expect(formatRelative('2027-06-14T08:00:00Z', now)).toBe('Jun 14, 2027');
    expect(formatRelative('2025-12-31T08:00:00Z', now)).toBe('Dec 31, 2025');
  });

  it('counts days in the chosen zone, not UTC', () => {
    setFormatPrefs({ ...base, timezone: 'Pacific/Kiritimati' });
    expect(formatRelative('2026-11-11T19:00:00Z', now)).toBe('9:00 AM');
    expect(formatRelative('2026-11-11T09:00:00Z', now)).toBe('Yesterday');
  });

  it('keeps the chosen order for absolute dates and is blank for junk', () => {
    setFormatPrefs({ ...base, dateFormat: 'DD/MM/YYYY' });
    expect(formatDate(at)).toBe('08/11/2026');
    expect(formatRelative('nonsense', now)).toBe('');
  });
});

describe('formatMonthYear', () => {
  it('is month and year', () => {
    setFormatPrefs(base);
    expect(formatMonthYear('2026-10-15T12:00:00Z')).toBe('Oct 2026');
    expect(formatMonthYear('nonsense')).toBe('');
  });
});
