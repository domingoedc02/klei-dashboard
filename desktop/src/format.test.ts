import { afterEach, describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, setFormatPrefs, type Prefs } from './format';

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
