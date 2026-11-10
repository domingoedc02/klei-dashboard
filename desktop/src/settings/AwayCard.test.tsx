import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from '../shell/Shell';
import type { Me } from '../shell/context';

const mocks = vi.hoisted(() => ({ request: vi.fn(), setDirty: vi.fn() }));
vi.mock('../bridge', async (orig) => ({ ...(await orig<typeof import('../bridge')>()), bridge: (await import('../shell/quietBell')).quietBell(mocks) }));

const ADMIN: Me = { id: 'a1', name: 'Ada Admin', email: 'ada@example.test', role: 'Admin', permissions: ['PERM_AWAY', 'PERM_VIEW_GALLERY'] };
const TEXT = 'We are closed and will write back soon.';
const view = (over: Record<string, unknown> = {}) => ({
  enabled: false, message: TEXT, schedule: { mode: 'weekly', days: ['sun', 'mon'], start: null, end: null, from: '18:00', to: '09:00' }, zone: 'UTC', version: 0, ...over,
});

type Out = { status: number; body?: unknown };
let read: () => Out;
let put: () => Out;
const puts = () => mocks.request.mock.calls.filter((c) => c[0] === 'PUT' && c[1] === '/api/v1/admin/away');

beforeEach(() => {
  vi.resetAllMocks();
  read = () => ({ status: 200, body: view() });
  put = () => ({ status: 200, body: view({ enabled: true, version: 1 }) });
  mocks.setDirty.mockResolvedValue(undefined);
  mocks.request.mockImplementation(async (m: string, p: string) => (p === '/api/v1/admin/away' ? (m === 'GET' ? read() : put()) : { status: 200, body: null }));
});

const open = async () => {
  window.location.hash = '#/settings/admin/away';
  const r = render(<Shell me={ADMIN} onExpired={vi.fn()} onSignOut={vi.fn()} />);
  await screen.findByLabelText('Message');
  return r;
};
const mode = (name: string) => userEvent.setup().click(screen.getByRole('radio', { name: new RegExp(`^${name}`) }));
const summary = () => document.getElementById('away-summary')!.textContent;
const save = () => userEvent.setup().click(screen.getByRole('button', { name: 'Save away message' }));
const turnOn = () => userEvent.setup().click(screen.getByRole('switch', { name: 'Send away message' }));

describe('Away message card', () => {
  it('opens off, with the message, three schedule cards with their help text, and Save disabled', async () => {
    await open();
    expect(screen.getByText('Off. Turn on when the studio is closed.')).toBeTruthy();
    expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe(TEXT);
    expect(screen.getByRole('group', { name: 'When is the business off?' })).toBeTruthy();
    expect(screen.getAllByRole('radio').map((r) => (r.closest('label') as HTMLElement).textContent)).toEqual([
      'One time onlyClosed on a date or date range. Good for holidays.',
      'WeeklyClosed on the same days every week.',
      'Every dayClosed outside hours, every day.',
    ]);
    expect(screen.getByRole('radio', { name: /^Weekly/ })).toHaveProperty('checked', true);
    expect(screen.getByText('Times use UTC, the time zone in the saving Admin’s Preferences.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save away message' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('words the summary for every mode and shows it next to the On state', async () => {
    await open();
    await turnOn();
    expect(screen.getByText('On. Closed every Monday, Sunday, all day.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Wednesday' }));
    expect(summary()).toBe('Closed every Monday, Wednesday, Sunday, all day.');
    await mode('Every day');
    expect(summary()).toBe('Closed every day from 6:00 PM until 9:00 AM.');
    fireEvent.change(screen.getByLabelText('Reopens at'), { target: { value: '07:30' } });
    expect(summary()).toBe('Closed every day from 6:00 PM until 7:30 AM.');
    await mode('One time only');
    fireEvent.change(screen.getByLabelText('First day closed'), { target: { value: '2026-11-26' } });
    expect(summary()).toBe('Closed Nov 26, 2026. Happens once.');
    fireEvent.change(screen.getByLabelText('Last day closed'), { target: { value: '2026-11-27' } });
    expect(summary()).toBe('Closed Nov 26, 2026 to Nov 27, 2026. Happens once.');
  });

  it('shows each schedule error in place of the summary and sends nothing', async () => {
    await open();
    await mode('One time only');
    expect(summary()).toBe('Pick the first day closed.');
    await save();
    expect(puts()).toHaveLength(0);
    expect(screen.getByRole('alert').textContent).toBe('Pick the first day closed.');
    fireEvent.change(screen.getByLabelText('First day closed'), { target: { value: '2026-11-27' } });
    fireEvent.change(screen.getByLabelText('Last day closed'), { target: { value: '2026-11-26' } });
    expect(summary()).toBe('The last day can’t be before the first day.');
    await mode('Weekly');
    fireEvent.click(screen.getByRole('button', { name: 'Sunday' }));
    fireEvent.click(screen.getByRole('button', { name: 'Monday' }));
    expect(summary()).toBe('Pick at least one day.');
    await mode('Every day');
    fireEvent.change(screen.getByLabelText('Reopens at'), { target: { value: '18:00' } });
    expect(summary()).toBe('Closing and reopening times must differ.');
    await save();
    expect(puts()).toHaveLength(0);
  });

  it('refuses an empty message while the switch is on and saves nothing', async () => {
    await open();
    await turnOn();
    await userEvent.setup().clear(screen.getByLabelText('Message'));
    await save();
    expect(await screen.findByText('Enter the message to send.')).toBeTruthy();
    expect(screen.getByLabelText('Message').getAttribute('aria-invalid')).toBe('true');
    expect(puts()).toHaveLength(0);
  });

  it('saves with the version it read, trims the message, drops empty dates and shows the toast', async () => {
    await open();
    await turnOn();
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: `  ${TEXT}  ` } });
    await save();
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0][2]).toEqual({ enabled: true, message: TEXT, schedule: { mode: 'weekly', days: ['sun', 'mon'], start: null, end: null, from: '18:00', to: '09:00' } });
    expect(puts()[0][3]).toBe(0);
    expect(await screen.findByText('Away message saved')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save away message' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps the form and offers Reload on a stale write; names the message when the server refuses it', async () => {
    await open();
    await turnOn();
    put = () => ({ status: 409 });
    await save();
    expect((await screen.findByRole('alert')).textContent).toContain('changed in another window');
    expect((screen.getByRole('switch', { name: 'Send away message' }) as HTMLInputElement).checked).toBe(true);
    read = () => ({ status: 200, body: view({ enabled: false, message: 'Newer', version: 4 }) });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('Newer'));
    await turnOn();
    put = () => ({ status: 422, body: { fields: [{ field: 'message', code: 'too_long' }] } });
    await save();
    expect(await screen.findByText('Use 2000 characters or fewer.')).toBeTruthy();
  });

  it('shows a Retry when the read fails', async () => {
    read = () => ({ status: 500 });
    window.location.hash = '#/settings/admin/away';
    render(<Shell me={ADMIN} onExpired={vi.fn()} onSignOut={vi.fn()} />);
    expect(await screen.findByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('passes axe in every mode and with an error showing', async () => {
    const { container } = await open();
    const clean = async () => {
      const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
      expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    };
    await clean();
    await mode('One time only');
    await clean();
    await save();
    await clean();
    await mode('Every day');
    await clean();
  });
});
