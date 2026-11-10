import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from '../shell/Shell';
import type { Me } from '../shell/context';
import { POLL_MS } from './events';

const mocks = vi.hoisted(() => ({ request: vi.fn(), setDirty: vi.fn() }));
vi.mock('../bridge', async (orig) => ({ ...(await orig<typeof import('../bridge')>()), bridge: mocks }));

const STAFF: Me = { id: 's1', name: 'Sam Staff', email: 'sam@example.test', role: 'Staff', permissions: ['PERM_VIEW_GALLERY', 'PERM_REPLY'] };
const VIEWER: Me = { id: 'v1', name: 'Vic Viewer', email: 'vic@example.test', role: 'Viewer', permissions: ['PERM_VIEW_GALLERY'] };
const noisy = { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } };

const id = (n: number) => `0b1c2d3e-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = (n: number, over: Record<string, unknown> = {}) => ({
  id: id(n), clientId: id(n + 500), clientName: `Client ${n}`, subject: `Subject ${n}`, preview: `Preview ${n}`,
  lastMessageAt: '2026-11-01T10:00:00Z', status: 'new', unread: true, ...over,
});

type Q = { status: string | null; before: number | null; limit: number };
let queries: Q[];
let answer: (q: Q) => { status: number; body?: unknown };
let count: number;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.setDirty.mockResolvedValue(undefined);
  queries = [];
  count = 2;
  answer = () => ({ status: 200, body: { items: [row(2), row(1, { status: 'replied', unread: false })], next: null } });
  mocks.request.mockImplementation(async (m: string, p: string, body?: Q) => {
    if (m === 'POST' && p === '/api/v1/inquiries/query') { queries.push(body!); return answer(body!); }
    if (p === '/api/v1/inquiries/count') return { status: 200, body: { count } };
    return { status: 200, body: null };
  });
});
afterEach(() => vi.useRealTimers());

const open = (me: Me = STAFF) => {
  window.location.hash = '#/inquiries';
  return render(<Shell me={me} onExpired={vi.fn()} onSignOut={vi.fn()} />);
};

describe('Inquiries', () => {
  it('shows skeleton rows, then a row per inquiry with name, subject, preview, date, status and an unread cue', async () => {
    const { container } = open();
    expect(container.querySelectorAll('.inq-skel').length).toBe(6);
    const list = await screen.findByRole('list', { name: 'Inquiries' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Client 2')).toBeTruthy();
    expect(within(rows[0]).getByText('Subject 2')).toBeTruthy();
    expect(within(rows[0]).getByText('Preview 2')).toBeTruthy();
    expect(within(rows[0]).getByText('New')).toBeTruthy();
    expect(within(rows[0]).getByText('Unread')).toBeTruthy();
    expect(within(rows[1]).queryByText('Unread')).toBeNull();
    expect(within(rows[1]).getByText('Replied')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Select an inquiry' })).toBeTruthy();
    expect(queries[0]).toEqual({ status: null, before: null, limit: 25 });
  });

  it('filters by chip through the server and says which filter is empty', async () => {
    answer = (q) => (q.status === 'closed' ? { status: 200, body: { items: [], next: null } } : { status: 200, body: { items: [row(1)], next: null } });
    open();
    await screen.findByRole('list', { name: 'Inquiries' });
    await userEvent.click(screen.getByRole('button', { name: 'Closed' }));
    expect(await screen.findByText('No closed inquiries')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Closed' }).getAttribute('aria-pressed')).toBe('true');
    expect(queries.at(-1)?.status).toBe('closed');
  });

  it('shows the empty state with no filter, with the website-form action', async () => {
    answer = () => ({ status: 200, body: { items: [], next: null } });
    open();
    expect(await screen.findByRole('heading', { name: 'No inquiries yet' })).toBeTruthy();
    expect(screen.getByText('Website inquiries land here as soon as they arrive.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'View website form' }));
    expect(await screen.findByText("The website form isn't connected yet.")).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open first message' })).toBeNull();
  });

  it('shows the filtered empty state with Show all, which brings the rows back', async () => {
    answer = (q) => (q.status === 'closed' ? { status: 200, body: { items: [], next: null } } : { status: 200, body: { items: [row(1)], next: null } });
    const { container } = open();
    await screen.findByRole('list', { name: 'Inquiries' });
    await userEvent.click(screen.getByRole('button', { name: 'Closed' }));
    expect(await screen.findByRole('heading', { name: 'No closed inquiries' })).toBeTruthy();
    expect(screen.getByText('Try another filter to see more messages.')).toBeTruthy();
    expect(container.querySelector('.empty.compact img')!.getAttribute('height')).toBe('144');
    await userEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(await screen.findByRole('list', { name: 'Inquiries' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows art, copy and Open first message in the empty thread pane, and the link opens the first row', async () => {
    open();
    await screen.findByRole('list', { name: 'Inquiries' });
    expect(screen.getByText('Pick a message on the left to read and reply.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open first message' }).getAttribute('href')).toBe(`#/inquiries/${id(2)}`);
  });

  it('offers Retry when the read fails', async () => {
    answer = () => ({ status: 500 });
    open();
    expect(await screen.findByText("Couldn't load inquiries.")).toBeTruthy();
    answer = () => ({ status: 200, body: { items: [row(1)], next: null } });
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('list', { name: 'Inquiries' })).toBeTruthy();
  });

  it('loads older rows with the next cursor', async () => {
    answer = (q) => (q.before === null
      ? { status: 200, body: { items: [row(3)], next: 7 } }
      : { status: 200, body: { items: [row(2)], next: null } });
    open();
    await screen.findByText('Client 3');
    await userEvent.click(screen.getByRole('button', { name: 'Show more inquiries' }));
    expect(await screen.findByText('Client 2')).toBeTruthy();
    expect(queries.at(-1)).toEqual({ status: null, before: 7, limit: 25 });
    expect(screen.queryByRole('button', { name: 'Show more inquiries' })).toBeNull();
  });

  it('polls page 1 every 30 s and puts a new inquiry on top', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    open();
    await screen.findByText('Client 2');
    answer = () => ({ status: 200, body: { items: [row(9), row(2)], next: null } });
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS + 10); });
    const rows = within(screen.getByRole('list', { name: 'Inquiries' })).getAllByRole('listitem');
    expect(rows[0].textContent).toContain('Client 9');
    expect(rows).toHaveLength(3);
  });

  it('shows "N new" on the sidebar item only when N is above zero', async () => {
    open();
    expect(await screen.findByText('2 new')).toBeTruthy();
    count = 0;
    await act(async () => { window.location.hash = '#/gallery'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    await waitFor(() => expect(screen.queryByText('2 new')).toBeNull());
  });

  it('hides Inquiries from a Viewer and never reads the count', async () => {
    open(VIEWER);
    await screen.findByRole('navigation', { name: 'Main' });
    expect(screen.queryByRole('link', { name: /Inquiries/ })).toBeNull();
    expect(mocks.request.mock.calls.some((c) => c[1] === '/api/v1/inquiries/count')).toBe(false);
  });

  it('has no axe violations', async () => {
    const { container } = open();
    await screen.findByRole('list', { name: 'Inquiries' });
    expect((await axe.run(container, noisy)).violations).toEqual([]);
  });
});
