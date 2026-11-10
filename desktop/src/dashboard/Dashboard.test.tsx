import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INQUIRY_EVENT } from '../inquiries/events';
import { Shell } from '../shell/Shell';
import type { Me } from '../shell/context';

const mocks = vi.hoisted(() => ({ request: vi.fn(), setDirty: vi.fn(), uploadFiles: vi.fn() }));
vi.mock('../bridge', async (orig) => ({ ...(await orig<typeof import('../bridge')>()), bridge: mocks }));

const ALL = ['PERM_VIEW_GALLERY', 'PERM_REPLY', 'PERM_UPLOAD_IMAGES'];
const TZ = 'America/Chicago'; // UTC-6 in November
const prefs = { timezone: TZ, dateFormat: 'MM/DD/YYYY', startPage: 'dashboard', enterToSend: false, newInquiry: true, aiFinished: true, teamActivity: true };
const meWith = (permissions: string[]): Me => ({ id: 'a1', name: 'Ada Admin', email: 'ada@example.test', role: 'Admin', permissions, preferences: prefs as Me['preferences'] });
const id = (n: number) => `0b1c2d3e-0000-4000-8000-${String(n).padStart(12, '0')}`;
const gown = (n: number, extra: object = {}) => ({ id: id(n), name: `Gown ${n}`, silhouette: [], fabric: [], photos: 1, thumbs: [id(100 + n)], addedAt: '2026-11-01T10:00:00Z', isNew: false, ...extra });
const inquiry = (n: number) => ({ id: id(200 + n), clientId: id(300 + n), clientName: `Client ${n}`, subject: `Subject ${n}`, preview: '', lastMessageAt: '2026-11-01T10:00:00Z', status: 'new', unread: true });

// 2026-11-07 is a Saturday; 15:10 UTC is 09:10 in Chicago.
const NOW = '2026-11-07T15:10:00Z';
const FULL = {
  recentGowns: [gown(1, { isNew: true, silhouette: ['A-line'], photos: 3 }), gown(2, { silhouette: [], photos: 1 })], totalGowns: 1234, newThisWeek: 6,
  photosThisMonth: 42, gownsThisMonth: 6,
  aiStatus: { phase: 'processing', step: 2, done: 3, total: 8 },
  inquiries: { unread: 4, latest: [inquiry(1), inquiry(2), inquiry(3)], oldestUnreadAt: '2026-11-06T14:00:00Z' },
  avgReplySeconds: 8640, prevAvgReplySeconds: 11160, errors: [],
};
const EMPTY = {
  recentGowns: [], totalGowns: 0, newThisWeek: 0, photosThisMonth: 0, gownsThisMonth: 0, aiStatus: { phase: 'idle' },
  inquiries: { unread: 0, latest: [] }, errors: [],
};

let dash: { status: number; body: unknown };
let calls: number;

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  window.location.hash = '#/dashboard';
  mocks.setDirty.mockResolvedValue(undefined);
  dash = { status: 200, body: FULL };
  calls = 0;
  mocks.request.mockImplementation(async (m: string, p: string) => {
    if (p === '/api/v1/notifications') return { status: 200, body: { items: [], unread: 0 } };
    if (p === '/api/v1/dashboard' && m === 'GET') { calls += 1; return dash; }
    return { status: 200, body: null };
  });
});
afterEach(() => vi.useRealTimers());

const mount = (perms = ALL) => render(<Shell me={meWith(perms)} onExpired={vi.fn()} onSignOut={vi.fn()} />);
const loaded = async (el: HTMLElement) => { await waitFor(() => expect(el.querySelector('.skeleton')).toBeNull()); return el; };
const card = async (name: string) => loaded(await screen.findByRole('region', { name }));
const stat = async (name: string) => loaded(await screen.findByRole('group', { name }));
const statNames = () => [...document.querySelectorAll('.dash-stat .stat-label')].map((e) => e.textContent);
const axeClean = async (container: HTMLElement) => {
  const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
};

describe('Dashboard page head', () => {
  it.each([
    ['2026-11-07T15:10:00Z', 'Good morning, Ada'], // 09:10
    ['2026-11-07T20:00:00Z', 'Good afternoon, Ada'], // 14:00
    ['2026-11-08T02:00:00Z', 'Good evening, Ada'], // 20:00
  ])('at %s the one h1 reads "%s", the date line has no appointments, Upload photos is primary', async (at, text) => {
    vi.setSystemTime(new Date(at));
    const { container } = mount();
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe(text);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getByText(/^\w+day, Nov \d+$/).textContent).not.toMatch(/appointment/i);
    const up = screen.getAllByRole('link', { name: 'Upload photos' })[0];
    expect(up.className).toContain('primary');
    expect(up.getAttribute('href')).toBe('#/upload');
  });

  it('the date line reads "Saturday, Nov 7" in the Preferences timezone', async () => {
    mount();
    expect(await screen.findByText('Saturday, Nov 7')).toBeTruthy();
  });
});

describe('Dashboard stats', () => {
  it('an Admin sees four stat cards with figures and sub-lines', async () => {
    mount();
    expect(await screen.findByRole('group', { name: 'Total gowns' })).toBeTruthy();
    const total = await stat('Total gowns');
    expect(within(total).getByText('1,234')).toBeTruthy();
    expect(within(total).getByText('+6 this week')).toBeTruthy();
    const unread = await stat('Unread inquiries');
    expect(within(unread).getByText('4')).toBeTruthy();
    expect(within(unread).getByText('Oldest from Nov 6')).toBeTruthy();
    const photos = await stat('Photos this month');
    expect(within(photos).getByText('42')).toBeTruthy();
    expect(within(photos).getByText('Across 6 gowns')).toBeTruthy();
    const reply = await stat('Avg. reply time');
    expect(within(reply).getByText('2.4h')).toBeTruthy();
    expect(within(reply).getByText('Down from 3.1h')).toBeTruthy();
    expect(statNames()).toEqual(['Total gowns', 'Unread inquiries', 'Photos this month', 'Avg. reply time']);
  });

  it('the oldest unread shows a time when it is from today and a date otherwise', async () => {
    dash = { status: 200, body: { ...FULL, inquiries: { ...FULL.inquiries, oldestUnreadAt: '2026-11-07T14:15:00Z' } } };
    mount();
    expect(within(await stat('Unread inquiries')).getByText('Oldest from 8:15 AM')).toBeTruthy();
  });

  it.each([
    [8640, 5400, 'Up from 1.5h'],
    [8640, 11160, 'Down from 3.1h'],
    [8640, null, ''],
    [8640, 8640, ''],
  ])('reply time %i against previous %s reads "%s"', async (cur, prev, sub) => {
    dash = { status: 200, body: { ...FULL, avgReplySeconds: cur, prevAvgReplySeconds: prev } };
    mount();
    const reply = await stat('Avg. reply time');
    expect(within(reply).getByText('2.4h')).toBeTruthy();
    expect(reply.querySelector('.stat-sub')?.textContent).toBe(sub);
  });

  it('a Viewer sees Total gowns and Photos this month only, no Upload photos button, no Inquiry text', async () => {
    const { inquiries: _i, avgReplySeconds: _a, prevAvgReplySeconds: _p, ...viewer } = FULL;
    dash = { status: 200, body: viewer };
    mount(['PERM_VIEW_GALLERY']);
    await card('Recent uploads');
    await stat('Total gowns');
    expect(statNames()).toEqual(['Total gowns', 'Photos this month']);
    expect(screen.queryByRole('link', { name: 'Upload photos' })).toBeNull();
    expect(document.querySelector('.dashboard')?.textContent).not.toMatch(/inquir/i);
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-labelledby'))).toEqual(['dash-recent', 'dash-ai']);
  });

  it('a Role with Reply only sees Unread inquiries and Avg. reply time, no gallery text', async () => {
    dash = { status: 200, body: { aiStatus: { phase: 'idle' }, inquiries: FULL.inquiries, avgReplySeconds: 8640, errors: [] } };
    mount(['PERM_REPLY']);
    await card('Unread inquiries');
    await stat('Avg. reply time');
    expect(statNames()).toEqual(['Unread inquiries', 'Avg. reply time']);
    expect(screen.queryByRole('region', { name: 'Recent uploads' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Upload photos' })).toBeNull();
    expect(document.querySelector('.dashboard')?.textContent).not.toMatch(/gown/i);
  });

  it('an empty workspace reads the four empty sub-lines, a dash for the reply time, and Idle', async () => {
    dash = { status: 200, body: EMPTY };
    mount();
    expect(within(await stat('Total gowns')).getByText('Nothing saved yet')).toBeTruthy();
    expect(within(await stat('Unread inquiries')).getByText('Inbox is clear')).toBeTruthy();
    expect(within(await stat('Photos this month')).getByText('Upload to get started')).toBeTruthy();
    const reply = await stat('Avg. reply time');
    expect(within(reply).getByText('No replies yet')).toBeTruthy();
    expect(within(reply).getByText('—')).toBeTruthy();
    const ai = await card('AI processing');
    expect(within(ai).getByText('Idle')).toBeTruthy();
    const recent = await card('Recent uploads');
    expect(within(recent).getByText('No uploads yet')).toBeTruthy();
    expect(within(recent).getByText('Upload gown photos and AI will group them for you.')).toBeTruthy();
    expect(within(recent).getByRole('link', { name: 'Upload photos' }).getAttribute('href')).toBe('#/upload');
    const inbox = await card('Unread inquiries');
    expect(within(inbox).getByText('No new inquiries')).toBeTruthy();
    expect(within(inbox).getByText('New website inquiries will appear here.')).toBeTruthy();
    expect(within(inbox).getByRole('link', { name: 'Open inbox' }).getAttribute('href')).toBe('#/inquiries');
  });

  it('a Viewer with an empty workspace gets the sentence and no Upload photos button', async () => {
    dash = { status: 200, body: { recentGowns: [], totalGowns: 0, newThisWeek: 0, photosThisMonth: 0, gownsThisMonth: 0, aiStatus: { phase: 'idle' }, errors: [] } };
    mount(['PERM_VIEW_GALLERY']);
    const recent = await card('Recent uploads');
    expect(within(recent).getByText('No uploads yet')).toBeTruthy();
    expect(within(recent).queryByRole('link', { name: 'Upload photos' })).toBeNull();
  });
});

describe('Dashboard widgets', () => {
  it('Recent uploads rows show thumb, name and "{silhouette} · {n} photos"; only the new one has the New pill', async () => {
    mount();
    const recent = await card('Recent uploads');
    const rows = within(recent).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('img')).toBeTruthy();
    expect(within(rows[0]).getByText('Gown 1')).toBeTruthy();
    expect(within(rows[0]).getByText('A-line · 3 photos')).toBeTruthy();
    expect(within(rows[0]).getByText('New').className).toContain('info');
    expect(within(rows[1]).getByText('1 photo')).toBeTruthy();
    expect(within(rows[1]).queryByText('New')).toBeNull();
    expect(within(rows[0]).getByRole('link').getAttribute('href')).toBe(`#/gallery/${id(1)}`);
    expect(within(recent).getByRole('link', { name: 'View gallery' }).getAttribute('href')).toBe('#/gallery');
  });

  it('Unread inquiries lists the latest rows and links each one', async () => {
    mount();
    const inbox = await card('Unread inquiries');
    expect(within(inbox).getAllByRole('link').map((a) => a.textContent)).toEqual(['Open inbox', 'Client 1Subject 1', 'Client 2Subject 2', 'Client 3Subject 3']);
    expect(within(inbox).getByRole('link', { name: /Client 2/ }).getAttribute('href')).toBe(`#/inquiries/${id(202)}`);
  });

  it('AI card: Checking… with a named bar, then Ready for review with counts and Review groups, then Stopped, then Idle', async () => {
    const { unmount } = mount();
    let ai = await card('AI processing');
    expect(within(ai).getByText('Checking…').className).toContain('info');
    expect(within(ai).getByText('Grouping · 3 of 8 photos')).toBeTruthy();
    expect((within(ai).getByRole('progressbar', { name: 'Grouping progress' }) as HTMLProgressElement).value).toBe(3);
    unmount();

    dash = { status: 200, body: { ...FULL, aiStatus: { phase: 'review', groups: 10, lowConfidence: 3 } } };
    const second = mount();
    ai = await card('AI processing');
    expect(within(ai).getByText('Ready for review').className).toContain('pos');
    expect(within(ai).getByText('Grouped into 10 gowns · 3 need a quick look.')).toBeTruthy();
    expect(within(ai).getByRole('link', { name: 'Review groups' }).getAttribute('href')).toBe('#/upload');
    second.unmount();

    dash = { status: 200, body: { ...FULL, aiStatus: { phase: 'error' } } };
    const third = mount();
    ai = await card('AI processing');
    expect(within(ai).getByText('Stopped').className).toContain('warn');
    expect(within(ai).getByText('The last run stopped. Open AI Upload to try again.')).toBeTruthy();
    third.unmount();

    dash = { status: 200, body: { ...FULL, aiStatus: { phase: 'idle' } } };
    mount();
    expect(within(await card('AI processing')).getByText('Idle').className).toContain('neutral');
  });

  it('Review groups is hidden without Upload images; one group needing a look reads singular, none reads clean', async () => {
    dash = { status: 200, body: { ...FULL, aiStatus: { phase: 'review', groups: 1, lowConfidence: 1 } } };
    const { unmount } = mount(['PERM_VIEW_GALLERY', 'PERM_REPLY']);
    const ai = await card('AI processing');
    expect(within(ai).getByText('Grouped into 1 gown · 1 needs a quick look.')).toBeTruthy();
    expect(within(ai).queryByRole('link', { name: 'Review groups' })).toBeNull();
    unmount();
    dash = { status: 200, body: { ...FULL, aiStatus: { phase: 'review', groups: 4, lowConfidence: 0 } } };
    mount();
    expect(within(await card('AI processing')).getByText('Grouped into 4 gowns.')).toBeTruthy();
  });

  it('a widget named in errors shows its own error; the others still render, and Retry reads again', async () => {
    dash = { status: 200, body: { ...FULL, inquiries: undefined, avgReplySeconds: undefined, prevAvgReplySeconds: undefined, errors: ['inquiries'] } };
    mount();
    const inbox = await card('Unread inquiries');
    const alert = within(inbox).getByRole('alert');
    expect(alert.textContent).toContain("Couldn't load inquiries.");
    expect(within(await stat('Total gowns')).getByText('1,234')).toBeTruthy();
    const reply = await stat('Avg. reply time');
    expect(reply.textContent).toContain("Couldn't load.");
    dash = { status: 200, body: FULL };
    const before = calls;
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(within(inbox).getByText('Client 1')).toBeTruthy());
    expect(calls).toBeGreaterThan(before);
    expect(within(await stat('Unread inquiries')).getByText('4')).toBeTruthy();
  });

  it('a failed read shows one error with Retry under the greeting, then the widgets', async () => {
    dash = { status: 500, body: null };
    mount();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Couldn't load the dashboard.");
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Good morning, Ada');
    dash = { status: 200, body: FULL };
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await card('Recent uploads')).toBeTruthy();
  });

  it('shows four stat skeletons and three widget skeletons until the read answers', async () => {
    let release: (v: unknown) => void = () => {};
    mocks.request.mockImplementation((_m: string, p: string) => {
      if (p === '/api/v1/notifications') return Promise.resolve({ status: 200, body: { items: [], unread: 0 } });
      if (p === '/api/v1/dashboard') return new Promise((res) => { release = res; });
      return Promise.resolve({ status: 200, body: null });
    });
    mount();
    const recent = await screen.findByRole('region', { name: 'Recent uploads' });
    expect(recent.querySelector('.skeleton')).toBeTruthy();
    expect(document.querySelectorAll('.dash-stat .skeleton')).toHaveLength(4);
    const regions = screen.getAllByRole('region');
    expect(regions).toHaveLength(3);
    regions.forEach((r) => expect(r.querySelector('.skeleton')).toBeTruthy());
    await act(async () => { release({ status: 200, body: FULL }); });
    await waitFor(() => expect(within(recent).getByText('Gown 1')).toBeTruthy());
    expect(document.querySelector('.dashboard .skeleton')).toBeNull();
  });

  it('reads again when an Inquiry changes', async () => {
    mount();
    await card('Recent uploads');
    const before = calls;
    dash = { status: 200, body: { ...FULL, inquiries: { unread: 0, latest: [] } } };
    act(() => { window.dispatchEvent(new Event(INQUIRY_EVENT)); });
    await waitFor(() => expect(calls).toBe(before + 1));
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Unread inquiries' })).getByText('Inbox is clear')).toBeTruthy());
  });
});

describe('Dashboard accessibility', () => {
  const states: [string, string[], object][] = [
    ['processing, all figures', ALL, FULL],
    ['review', ALL, { ...FULL, aiStatus: { phase: 'review', groups: 10, lowConfidence: 3 } }],
    ['stopped', ALL, { ...FULL, aiStatus: { phase: 'error' } }],
    ['empty workspace', ALL, EMPTY],
    ['viewer', ['PERM_VIEW_GALLERY'], { ...FULL, inquiries: undefined, avgReplySeconds: undefined, prevAvgReplySeconds: undefined }],
    ['reply only', ['PERM_REPLY'], { aiStatus: { phase: 'idle' }, inquiries: FULL.inquiries, avgReplySeconds: 8640, errors: [] }],
    ['a widget error', ALL, { ...FULL, inquiries: undefined, errors: ['inquiries'] }],
  ];
  it.each(states)('%s has no axe violations and one h1', async (_n, perms, body) => {
    dash = { status: 200, body };
    const { container } = mount(perms);
    await screen.findByRole('region', { name: 'AI processing' });
    await waitFor(() => expect(container.querySelector('.dashboard .skeleton')).toBeNull());
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    await axeClean(container);
  });
});
