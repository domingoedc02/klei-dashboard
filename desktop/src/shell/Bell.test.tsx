import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from './Shell';
import type { Me } from './context';
import { POLL_MS } from '../inquiries/events';

const mocks = vi.hoisted(() => ({ request: vi.fn(), setDirty: vi.fn(), uploadFiles: vi.fn() }));
vi.mock('../bridge', async (orig) => ({ ...(await orig<typeof import('../bridge')>()), bridge: mocks }));

const ME: Me = { id: 'a1', name: 'Ada Admin', email: 'ada@example.test', role: 'Admin', permissions: ['PERM_VIEW_GALLERY'] };
const n = (i: number, over: Record<string, unknown> = {}) => ({
  id: `0b1c2d3e-0000-4000-8000-${String(i).padStart(12, '0')}`, type: 'new_inquiry', title: `New inquiry from Client ${i}`,
  target: `inquiries/0b1c2d3e-0000-4000-8000-${String(i).padStart(12, '0')}`, read: false, createdAt: '2026-11-01T10:00:00Z', ...over,
});

let bell: { status: number; body?: unknown };
let calls: { m: string; p: string; b?: unknown }[];

beforeEach(() => {
  vi.resetAllMocks();
  window.location.hash = '#/dashboard';
  mocks.setDirty.mockResolvedValue(undefined);
  bell = { status: 200, body: { items: [n(1), n(2, { read: true, type: 'ai_finished', title: 'AI finished grouping 4 images into 2 gowns', target: 'upload' })], unread: 1 } };
  calls = [];
  mocks.request.mockImplementation(async (m: string, p: string, b?: unknown) => {
    calls.push({ m, p, b });
    if (p === '/api/v1/notifications' && m === 'GET') return bell;
    if (p === '/api/v1/dashboard') return { status: 200, body: { aiStatus: { phase: 'idle' }, errors: [] } };
    if (p === '/api/v1/notifications/read' || (p === '/api/v1/notifications' && m === 'DELETE')) return { status: 204, body: null };
    return { status: 200, body: null };
  });
});

const mount = (me: Me = ME) => render(<Shell me={me} onExpired={vi.fn()} onSignOut={vi.fn()} />);
const button = () => screen.findByRole('button', { name: /^Notifications/ });

describe('Bell', () => {
  it('shows a dot and the unread count in its name while something is unread, none when all read', async () => {
    mount();
    await waitFor(async () => expect((await button()).getAttribute('aria-label')).toBe('Notifications, 1 unread'));
    expect(document.querySelector('.bell .dot')).toBeTruthy();
  });

  it('has no dot when everything is read', async () => {
    bell = { status: 200, body: { items: [n(2, { read: true })], unread: 0 } };
    mount();
    await waitFor(() => expect(calls.some((c) => c.p === '/api/v1/notifications')).toBe(true));
    expect((await button()).getAttribute('aria-label')).toBe('Notifications');
    expect(document.querySelector('.bell .dot')).toBeNull();
  });

  it('lists the lines with unread ones marked, and axe finds nothing', async () => {
    const { container } = mount();
    await userEvent.click(await button());
    const menu = await screen.findByRole('menu', { name: 'Notifications' });
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'Clear all', expect.stringContaining('New inquiry from Client 1'), expect.stringContaining('AI finished grouping 4 images into 2 gowns'),
    ]);
    expect(items[1].className).toContain('unread');
    expect(items[2].className).not.toContain('unread');
    const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });

  it('shows the Notifications heading and a Go to Inquiries footer only to a User who may open Inquiries', async () => {
    const view = mount({ ...ME, permissions: ['PERM_VIEW_GALLERY', 'PERM_REPLY'] });
    await userEvent.click(await button());
    const menu = await screen.findByRole('menu', { name: 'Notifications' });
    expect(within(menu).getByText('Notifications', { selector: 'strong' })).toBeTruthy();
    const items = within(menu).getAllByRole('menuitem');
    const foot = items[items.length - 1];
    expect(foot.textContent).toBe('Go to Inquiries');
    expect(foot.getAttribute('href')).toBe('#/inquiries');
    await userEvent.click(foot);
    expect(screen.queryByRole('menu', { name: 'Notifications' })).toBeNull();
    view.unmount();
    mount();
    await userEvent.click(await button());
    await screen.findByRole('menu', { name: 'Notifications' });
    expect(screen.queryByRole('menuitem', { name: 'Go to Inquiries' })).toBeNull();
  });

  it('the empty menu still offers Go to Inquiries', async () => {
    bell = { status: 200, body: { items: [], unread: 0 } };
    mount({ ...ME, permissions: ['PERM_REPLY'] });
    await userEvent.click(await button());
    expect(await screen.findByText('You’re all caught up')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Go to Inquiries' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Clear all' })).toBeNull();
  });

  it('click marks that line read, goes to its target and closes the menu', async () => {
    mount();
    await userEvent.click(await button());
    await userEvent.click(await screen.findByRole('menuitem', { name: /New inquiry from Client 1/ }));
    expect(calls.find((c) => c.p === '/api/v1/notifications/read')?.b).toEqual({ ids: [n(1).id] });
    expect(window.location.hash).toBe(`#/${n(1).target}`);
    expect(screen.queryByRole('menu', { name: 'Notifications' })).toBeNull();
    expect((await button()).getAttribute('aria-label')).toBe('Notifications');
  });

  it('a line that is already read goes to its target without another write', async () => {
    mount();
    await userEvent.click(await button());
    await userEvent.click(await screen.findByRole('menuitem', { name: /AI finished/ }));
    expect(window.location.hash).toBe('#/upload');
    expect(calls.some((c) => c.p === '/api/v1/notifications/read')).toBe(false);
  });

  it('Clear all deletes, empties the list and toasts', async () => {
    mount();
    await userEvent.click(await button());
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Clear all' }));
    expect(calls.some((c) => c.m === 'DELETE' && c.p === '/api/v1/notifications')).toBe(true);
    expect(await screen.findByText('Notifications cleared')).toBeTruthy();
    expect(await screen.findByText("You’re all caught up")).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Clear all' })).toBeNull();
  });

  it('shows the empty line for a new User', async () => {
    bell = { status: 200, body: { items: [], unread: 0 } };
    mount();
    await userEvent.click(await button());
    expect(await screen.findByText("You’re all caught up")).toBeTruthy();
  });

  it('a failed first read shows the error with Retry that reads again', async () => {
    bell = { status: 500, body: null };
    mount();
    await userEvent.click(await button());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Couldn't load notifications.");
    bell = { status: 200, body: { items: [n(1)], unread: 1 } };
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('menuitem', { name: /New inquiry from Client 1/ })).toBeTruthy();
  });

  it('Escape closes the menu', async () => {
    mount();
    await userEvent.click(await button());
    await screen.findByRole('menu', { name: 'Notifications' });
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'Notifications' })).toBeNull();
  });

  it('polls again every 30 seconds so a new line shows the dot', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      bell = { status: 200, body: { items: [], unread: 0 } };
      mount();
      expect((await button()).getAttribute('aria-label')).toBe('Notifications');
      bell = { status: 200, body: { items: [n(3)], unread: 1 } };
      await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS + 100); });
      await waitFor(() => expect(screen.getByRole('button', { name: /^Notifications/ }).getAttribute('aria-label')).toBe('Notifications, 1 unread'));
    } finally {
      vi.useRealTimers();
    }
  });
});
