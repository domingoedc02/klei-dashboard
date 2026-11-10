import { describe, expect, it } from 'vitest';
import { dateLine, greeting, replyTime, since } from './clock';

describe('clock', () => {
  it('greets by the hour in the zone', () => {
    const z = 'America/Chicago'; // UTC-6 in November
    expect(greeting(new Date('2026-11-07T11:00:00Z'), z)).toBe('Good morning'); // 05:00 there
    expect(greeting(new Date('2026-11-07T10:59:00Z'), z)).toBe('Good evening'); // 04:59 there
    const utc = (hhmm: string) => greeting(new Date(`2026-11-07T${hhmm}:00Z`), 'UTC');
    expect(['04:59', '05:00', '11:59', '12:00', '16:59', '17:00', '23:59', '00:00'].map(utc)).toEqual([
      'Good evening', 'Good morning', 'Good morning', 'Good afternoon', 'Good afternoon', 'Good evening', 'Good evening', 'Good evening',
    ]);
  });

  it('writes the date line in the zone, an unknown zone falls back', () => {
    expect(dateLine(new Date('2026-11-07T15:10:00Z'), 'America/Chicago')).toBe('Saturday, Nov 7');
    expect(dateLine(new Date('2026-11-07T23:30:00Z'), 'Pacific/Kiritimati')).toBe('Sunday, Nov 8');
    expect(dateLine(new Date('2026-11-07T12:00:00Z'), 'Not/AZone')).toMatch(/^\w+, Nov \d+$/);
  });

  it('shows a time for today and a date for any other day', () => {
    const now = new Date('2026-11-07T20:00:00Z');
    expect(since('2026-11-07T08:15:00Z', now, 'UTC')).toBe('8:15 AM');
    expect(since('2026-11-06T23:59:00Z', now, 'UTC')).toBe('Nov 6');
    expect(since('2026-11-07T01:00:00Z', now, 'Asia/Manila')).toBe('Nov 7'); // 09:00 on the 7th there, but now is already the 8th
    expect(since('nonsense', now, 'UTC')).toBe('');
  });

  it('formats a reply time as minutes, hours or days', () => {
    expect([0, 59, 60, 2520, 3599].map(replyTime)).toEqual(['0m', '0m', '1m', '42m', '59m']);
    expect([3600, 8640, 11160, 47 * 3600].map(replyTime)).toEqual(['1.0h', '2.4h', '3.1h', '47.0h']);
    expect([48 * 3600, 3.5 * 86400].map(replyTime)).toEqual(['2.0d', '3.5d']);
  });
});
