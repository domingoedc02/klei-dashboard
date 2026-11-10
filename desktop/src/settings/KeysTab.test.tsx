import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from '../shell/Shell';
import type { Me } from '../shell/context';
import { KEYS_POLL_MS } from './KeysTab';

const mocks = vi.hoisted(() => ({ request: vi.fn(), setDirty: vi.fn() }));
vi.mock('../bridge', async (orig) => ({ ...(await orig<typeof import('../bridge')>()), bridge: (await import('../shell/quietBell')).quietBell(mocks) }));

const ADMIN: Me = { id: 'a1', name: 'Ada Admin', email: 'ada@example.test', role: 'Admin', permissions: ['PERM_KEY_ROTATE', 'PERM_VIEW_GALLERY'] };
const idle = { state: 'idle', done: 0, total: 0, dataKey: 0, storedObject: 0 };
const status = (over: object = {}) => ({
  active: 2, highest: 2, configured: [1, 2], rows: { dataKey: { '1': 1, '2': 2 }, storedObject: { '1': 4, '2': 6 } }, run: idle, ...over,
});

let current: { status: number; body: unknown };
let posts: { status: number; body: unknown }[];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.setDirty.mockResolvedValue(undefined);
  current = { status: 200, body: status() };
  posts = [{ status: 202, body: { state: 'running', done: 0, total: 5, dataKey: 0, storedObject: 0 } }];
  mocks.request.mockImplementation(async (m: string, p: string) => {
    if (p === '/api/v1/admin/keys/status') return current;
    if (p === '/api/v1/admin/keys/rewrap' && m === 'POST') return posts.shift() ?? { status: 200, body: idle };
    return { status: 200, body: null };
  });
});

async function open(me = ADMIN) {
  window.location.hash = '#/settings/keys';
  return render(<Shell me={me} onExpired={vi.fn()} onSignOut={vi.fn()} />);
}
const pressed = () => screen.getByRole('button', { name: 'Re-wrap now' });

describe('Keys tab', () => {
  it('is offered only with the key Permission', async () => {
    window.location.hash = '#/settings';
    render(<Shell me={{ ...ADMIN, permissions: ['PERM_VIEW_GALLERY'] }} onExpired={vi.fn()} onSignOut={vi.fn()} />);
    await screen.findByRole('tab', { name: 'Profile' });
    expect(screen.queryByRole('button', { name: 'Keys' })).toBeNull();
  });

  it('shows counts per master key version, marks the active one, and passes axe', async () => {
    const { container } = await open();
    const table = await screen.findByRole('table', { name: 'Keys' });
    const rows = within(table).getAllByRole('row');
    expect(rows.map((r) => r.textContent)).toEqual(['Master keyData keysStored filesStatus', 'Version 114In use', 'Version 226Active']);
    expect(pressed().hasAttribute('disabled')).toBe(false);
    const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });

  it('with nothing left at an old version the button is off and says why', async () => {
    current = { status: 200, body: status({ rows: { dataKey: { '2': 3 }, storedObject: { '2': 6 } } }) };
    await open();
    await screen.findByRole('table', { name: 'Keys' });
    expect(pressed().hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Nothing to re-wrap.')).toBeTruthy();
  });

  it('when the newest key is not the active one the button is off and says what to do', async () => {
    current = { status: 200, body: status({ active: 1 }) };
    await open();
    await screen.findByRole('table', { name: 'Keys' });
    expect(pressed().hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Make the newest key the active one and deploy before re-wrapping.')).toBeTruthy();
  });

  it('Re-wrap now starts the run, shows progress while it polls, then the finished line', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await open();
      await screen.findByRole('table', { name: 'Keys' });
      current = { status: 200, body: status({ run: { state: 'running', done: 2, total: 5, dataKey: 1, storedObject: 1 } }) };
      await userEvent.click(pressed());
      expect((await screen.findByRole('status')).textContent).toContain('Re-wrapping: 2 of 5 done.');
      expect(pressed().hasAttribute('disabled')).toBe(true);
      current = { status: 200, body: status({ rows: { dataKey: { '2': 3 }, storedObject: { '2': 10 } }, run: { state: 'done', done: 5, total: 5, dataKey: 1, storedObject: 4 } }) };
      await act(async () => { await vi.advanceTimersByTimeAsync(KEYS_POLL_MS + 100); });
      await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Done. 5 keys now use master key version 2.'));
      expect(within(screen.getByRole('table', { name: 'Keys' })).getByText('Not needed')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a refused start toasts and reads the status again', async () => {
    posts = [{ status: 409, body: null }];
    await open();
    await screen.findByRole('table', { name: 'Keys' });
    await userEvent.click(pressed());
    expect(await screen.findByText('A re-wrap is already running, or the new key is not active yet.')).toBeTruthy();
  });

  it('a failed run says so and the button stays available', async () => {
    current = { status: 200, body: status({ run: { state: 'failed', done: 1, total: 5, dataKey: 1, storedObject: 0 } }) };
    await open();
    expect(await screen.findByText('The re-wrap stopped early. Press Re-wrap now to continue where it left off.')).toBeTruthy();
    expect(pressed().hasAttribute('disabled')).toBe(false);
  });

  it('a failed first read shows the error with Retry', async () => {
    current = { status: 500, body: null };
    await open();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Couldn't load the key status.");
    current = { status: 200, body: status() };
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('table', { name: 'Keys' })).toBeTruthy();
  });
});
