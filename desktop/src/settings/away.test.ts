import { describe, expect, it } from 'vitest';
import { scheduleError, summary, type Schedule } from './away';

const base: Schedule = { mode: 'weekly', days: ['sun', 'mon'], start: '', end: '', from: '18:00', to: '09:00' };

describe('away schedule', () => {
  it('words each mode as the prototype does', () => {
    expect(summary(base)).toBe('Closed every Monday, Sunday, all day.');
    expect(summary({ ...base, mode: 'once', start: '2026-11-26', end: '2026-11-27' })).toBe('Closed Nov 26, 2026 to Nov 27, 2026. Happens once.');
    expect(summary({ ...base, mode: 'once', start: '2026-11-26', end: '2026-11-26' })).toBe('Closed Nov 26, 2026. Happens once.');
    expect(summary({ ...base, mode: 'once', start: '2026-11-26' })).toBe('Closed Nov 26, 2026. Happens once.');
    expect(summary({ ...base, mode: 'daily' })).toBe('Closed every day from 6:00 PM until 9:00 AM.');
    expect(summary({ ...base, mode: 'daily', from: '00:00', to: '12:30' })).toBe('Closed every day from 12:00 AM until 12:30 PM.');
  });

  it('gives the error text in place of a summary', () => {
    expect(scheduleError({ ...base, mode: 'once' })).toBe('Pick the first day closed.');
    expect(scheduleError({ ...base, mode: 'once', start: '2026-11-27', end: '2026-11-26' })).toBe('The last day can’t be before the first day.');
    expect(scheduleError({ ...base, days: [] })).toBe('Pick at least one day.');
    expect(scheduleError({ ...base, mode: 'daily', from: '18:00', to: '18:00' })).toBe('Closing and reopening times must differ.');
    expect(scheduleError({ ...base, mode: 'daily', to: '' })).toBe('Closing and reopening times must differ.');
    expect(summary({ ...base, days: [] })).toBe('Pick at least one day.');
    expect(scheduleError(base)).toBe('');
  });
});
