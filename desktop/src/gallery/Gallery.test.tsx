import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from '../shell/Shell';
import type { Me } from '../shell/context';
import { forgetGallery } from './memory';

const mocks = vi.hoisted(() => ({ request: vi.fn(), exportGowns: vi.fn() }));
vi.mock('../bridge', async (orig) => ({ ...(await orig<typeof import('../bridge')>()), bridge: mocks }));

const id = (n: number) => `0b1c2d3e-0000-4000-8000-${String(n).padStart(12, '0')}`;
const STAFF: Me = { id: 's1', name: 'Sam Staff', email: 'sam@example.test', role: 'Staff', permissions: ['PERM_VIEW_GALLERY', 'PERM_UPLOAD_IMAGES'] };
const ADMIN: Me = { id: 'a1', name: 'Ada Admin', email: 'ada@example.test', role: 'Admin', permissions: ['PERM_VIEW_GALLERY', 'PERM_UPLOAD_IMAGES', 'PERM_DELETE_GOWN'] };
const VIEWER: Me = { id: 'v1', name: 'Vic Viewer', email: 'vic@example.test', role: 'Viewer', permissions: ['PERM_VIEW_GALLERY'] };
const noisy = { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } };
const TAX = {
  groups: [
    { type: 'silhouette', values: [{ id: 's-a', value: 'A-line' }, { id: 's-m', value: 'Mermaid' }] },
    { type: 'fabric', values: [{ id: 'f-l', value: 'Lace' }, { id: 'f-t', value: 'Tulle' }] },
  ],
};

const card = (n: number, over: Record<string, unknown> = {}) => ({
  id: id(n), name: `Gown ${n}`, silhouette: ['A-line'], fabric: ['Lace'], photos: 5, thumbs: [id(n + 100), id(n + 200)],
  addedAt: '2026-11-01T10:00:00Z', isNew: false, ...over,
});
const page = (items: unknown[], next: number | null, total: number, matching: number) => ({ status: 200, body: { items, next, total, matching } });

type Query = { silhouette: string[]; fabric: string[]; days: number; before: number | null; limit: number };
let queries: Query[];
let answer: (q: Query) => { status: number; body?: unknown };

beforeEach(() => {
  vi.resetAllMocks();
  forgetGallery();
  queries = [];
  answer = () => page([card(1, { isNew: true }), card(2, { thumbs: [] })], null, 2, 2);
  mocks.request.mockImplementation(async (m: string, p: string, body?: Query) => {
    if (m === 'POST' && p === '/api/v1/gowns/query') {
      queries.push(body!);
      return answer(body!);
    }
    if (p === '/api/v1/taxonomy') return { status: 200, body: TAX };
    return { status: 200, body: null };
  });
});

const open = async (me: Me = STAFF) => {
  window.location.hash = '#/gallery';
  return render(<Shell me={me} onExpired={vi.fn()} onSignOut={vi.fn()} />);
};

describe('Gallery', () => {
  it('shows eight skeleton cards while loading, then a card per gown with labels, count, date and New', async () => {
    let release: (v: unknown) => void = () => undefined;
    const held = new Promise((r) => { release = r; });
    mocks.request.mockImplementation(async (_m: string, p: string) => {
      if (p === '/api/v1/taxonomy') return { status: 200, body: TAX };
      await held;
      return page([card(1, { isNew: true })], null, 1, 1);
    });
    const { container } = await open();
    expect(container.querySelectorAll('.grid .skeleton').length).toBe(8);
    release(null);
    const list = await screen.findByRole('list', { name: 'Gowns' });
    const item = within(list).getByRole('heading', { name: 'Gown 1' }).closest('li')!;
    expect(item.textContent).toContain('A-line · Lace');
    expect(item.textContent).toContain('5 photos');
    expect(within(item).getByText('New')).toBeTruthy();
    expect(screen.getByText('1 of 1 gowns · latest upload first')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Upload photos' }).getAttribute('href')).toBe('#/upload');
    expect(screen.getByText('Latest upload first')).toBeTruthy();
    expect(within(item).getByRole('checkbox', { name: 'Select Gown 1' })).toBeTruthy();
    expect(item.querySelectorAll('img').length).toBe(2);
    expect(item.querySelector('img')!.getAttribute('src')).toBe(`klei-img://localhost/g/${id(1)}/${id(101)}`);
  });

  it('puts every filter in the body, never the URL, and narrows through one reload per change', async () => {
    const user = userEvent.setup();
    await open();
    await screen.findByRole('list', { name: 'Gowns' });
    expect(queries[0]).toEqual({ silhouette: [], fabric: [], days: 0, before: null, limit: 48 });
    await waitFor(() => expect(screen.getByRole('option', { name: 'Mermaid' })).toBeTruthy());
    answer = () => page([card(3, { silhouette: ['Mermaid'] })], null, 9, 1);
    await user.selectOptions(screen.getByLabelText('Silhouette'), 'Mermaid');
    await screen.findByText('1 of 9 gowns · latest upload first');
    await user.selectOptions(screen.getByLabelText('Fabric'), 'Tulle');
    await user.selectOptions(screen.getByLabelText('Date added'), 'Last 30 days');
    await waitFor(() => expect(queries.length).toBe(4));
    expect(queries[3]).toEqual({ silhouette: ['s-m'], fabric: ['f-t'], days: 30, before: null, limit: 48 });
    for (const call of mocks.request.mock.calls.filter((c) => c[1].includes('gowns'))) expect(call[1]).toBe('/api/v1/gowns/query');
  });

  it('Clear filters appears only with a filter and puts everything back', async () => {
    const user = userEvent.setup();
    await open();
    await screen.findByRole('list', { name: 'Gowns' });
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    await user.selectOptions(screen.getByLabelText('Date added'), 'Last 7 days');
    await user.click(await screen.findByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(queries.at(-1)).toEqual({ silhouette: [], fabric: [], days: 0, before: null, limit: 48 }));
    expect((screen.getByLabelText('Date added') as HTMLSelectElement).value).toBe('0');
  });

  it('Show more gowns asks for the next page by cursor and appends', async () => {
    const user = userEvent.setup();
    answer = (q) => (q.before === null ? page([card(1), card(2)], 77, 3, 3) : page([card(3)], null, 3, 3));
    await open();
    await user.click(await screen.findByRole('button', { name: 'Show more gowns' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Gown 3' })).toBeTruthy());
    expect(queries[1].before).toBe(77);
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBe(3);
    expect(screen.queryByRole('button', { name: 'Show more gowns' })).toBeNull();
  });

  it('an empty gallery invites an upload, but not a Viewer', async () => {
    answer = () => page([], null, 0, 0);
    const { unmount } = await open();
    expect(await screen.findByText('Your gallery is empty')).toBeTruthy();
    expect(screen.getByText('Saved gowns appear here as albums, newest first.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Upload photos' }).getAttribute('href')).toBe('#/upload');
    unmount();
    forgetGallery();
    await open(VIEWER);
    expect(await screen.findByText('Your gallery is empty')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Upload photos' })).toBeNull();
  });

  it('no match keeps the filters and offers Clear filters', async () => {
    const user = userEvent.setup();
    await open();
    await screen.findByRole('list', { name: 'Gowns' });
    answer = (q) => (q.days === 7 ? page([], null, 2, 0) : page([card(1)], null, 2, 2));
    await user.selectOptions(screen.getByLabelText('Date added'), 'Last 7 days');
    expect(await screen.findByText('No gowns match these filters')).toBeTruthy();
    expect(screen.getByText('0 of 2 gowns · latest upload first')).toBeTruthy();
    expect(screen.getByText('Try a different silhouette, fabric, or date range.')).toBeTruthy();
    expect((screen.getByLabelText('Date added') as HTMLSelectElement).value).toBe('7');
    const clear = screen.getAllByRole('button', { name: 'Clear filters' });
    fireEvent.click(clear[clear.length - 1]);
    await screen.findByRole('list', { name: 'Gowns' });
  });

  it('a failed load replaces the grid with an error block, keeps the filters, and Retry reloads', async () => {
    const user = userEvent.setup();
    answer = () => ({ status: 500 });
    await open();
    expect(await screen.findByText("Couldn't load the gallery.")).toBeTruthy();
    expect(screen.getByLabelText('Silhouette')).toBeTruthy();
    answer = () => page([card(1)], null, 1, 1);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('list', { name: 'Gowns' })).toBeTruthy();
  });

  it('coming back restores filters and loaded pages without asking again', async () => {
    const user = userEvent.setup();
    answer = (q) => (q.before === null ? page([card(1)], 5, 2, 2) : page([card(2)], null, 2, 2));
    const first = await open();
    await user.selectOptions(screen.getByLabelText('Date added'), 'Last 90 days');
    await user.click(await screen.findByRole('button', { name: 'Show more gowns' }));
    await screen.findByRole('heading', { name: 'Gown 2' });
    const asked = queries.length;
    first.unmount();
    await open();
    expect(await screen.findByRole('heading', { name: 'Gown 2' })).toBeTruthy();
    expect((screen.getByLabelText('Date added') as HTMLSelectElement).value).toBe('90');
    expect(queries.length).toBe(asked);
  });

  it('has no axe violations in the grid and in the empty state', async () => {
    const { container, unmount } = await open();
    await screen.findByRole('list', { name: 'Gowns' });
    expect((await axe.run(container, noisy)).violations).toEqual([]);
    unmount();
    forgetGallery();
    answer = () => page([], null, 0, 0);
    const again = await open();
    await screen.findByText('Your gallery is empty');
    expect((await axe.run(again.container, noisy)).violations).toEqual([]);
  });
});

describe('Select and download', () => {
  const selecting = async (me: Me = STAFF) => {
    answer = () => page([card(1), card(2), card(3)], null, 3, 3);
    await open(me);
    await screen.findByRole('list', { name: 'Gowns' });
  };

  it('every card has a checkbox from the start; Download .zip waits for a pick and sends the picked ids', async () => {
    const user = userEvent.setup();
    mocks.exportGowns.mockResolvedValue({ gowns: 2, photos: 4, cancelled: false });
    await selecting();
    expect(screen.getByText('None selected')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Download .zip' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: 'Select Gown 1' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Gown 3' }));
    expect(screen.getByText('2 selected')).toBeTruthy();
    expect(document.querySelectorAll('.gown[data-picked]').length).toBe(2);
    expect((screen.getByRole('checkbox', { name: 'Select all' }) as HTMLInputElement).indeterminate).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Download .zip' }));
    expect(mocks.exportGowns).toHaveBeenCalledWith('start', [id(1), id(3)], expect.any(Function));
    expect(await screen.findByText('Download saved')).toBeTruthy();
    expect(await screen.findByText('None selected')).toBeTruthy();
  });

  it('Select all picks every loaded gown and again clears them; a Viewer may download', async () => {
    const user = userEvent.setup();
    await selecting(VIEWER);
    await user.click(screen.getByRole('checkbox', { name: 'Select all' }));
    expect(screen.getByText('3 selected')).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: 'Select all' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('button', { name: 'Download .zip' }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByRole('checkbox', { name: 'Select all' }));
    expect(screen.getByText('None selected')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Gown 1' })).toBeTruthy();
  });

  it('over the limit says to select fewer and keeps the selection; a failure says to try again', async () => {
    const user = userEvent.setup();
    await selecting();
    await user.click(screen.getByRole('checkbox', { name: 'Select all' }));
    mocks.exportGowns.mockRejectedValueOnce({ kind: 'too_large', message: 'x' });
    await user.click(screen.getByRole('button', { name: 'Download .zip' }));
    expect(await screen.findByText('Too many to download at once. Select fewer.')).toBeTruthy();
    expect(screen.getByText('3 selected')).toBeTruthy();
    mocks.exportGowns.mockRejectedValueOnce({ kind: 'failed', message: 'x' });
    await user.click(screen.getByRole('button', { name: 'Download .zip' }));
    expect(await screen.findByText('Download failed. Try again.')).toBeTruthy();
    expect(screen.getByText('3 selected')).toBeTruthy();
  });

  it('changing a filter drops the selection', async () => {
    const user = userEvent.setup();
    await selecting();
    await user.click(screen.getByRole('checkbox', { name: 'Select all' }));
    await user.selectOptions(screen.getByLabelText('Date added'), 'Last 7 days');
    expect(await screen.findByText('None selected')).toBeTruthy();
  });

  it('the grid with a selection has no axe violations', async () => {
    const user = userEvent.setup();
    answer = () => page([card(1), card(2)], null, 2, 2);
    const { container } = await open();
    await screen.findByRole('list', { name: 'Gowns' });
    await user.click(screen.getByRole('checkbox', { name: 'Select Gown 1' }));
    expect((await axe.run(container, noisy)).violations).toEqual([]);
  });
});

describe('Delete gowns', () => {
  const deletes = () => mocks.request.mock.calls.filter((c) => c[0] === 'POST' && c[1] === '/api/v1/gowns/delete');
  const picking = async (_user: ReturnType<typeof userEvent.setup>, me: Me = ADMIN) => {
    answer = () => page([card(1), card(2), card(3)], null, 3, 3);
    await open(me);
    await screen.findByRole('list', { name: 'Gowns' });
  };

  it('a Role without the delete Permission sees no Delete in the bulk bar', async () => {
    const user = userEvent.setup();
    await picking(user, STAFF);
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('asks first and sends nothing until confirmed, then deletes the picked ids, reloads and leaves select mode', async () => {
    const user = userEvent.setup();
    await picking(user);
    const button = screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: 'Select Gown 1' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Gown 3' }));
    await user.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Delete 2 folders?' });
    expect(within(dialog).getByText('This removes Gown 1, Gown 3 and 10 photos from Gallery. This can’t be undone.')).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(deletes()).toHaveLength(0);
    mocks.request.mockImplementation(async (_m: string, p: string, body?: Query) => {
      if (p === '/api/v1/gowns/delete') return { status: 200, body: { deleted: 2, missing: [] } };
      if (p === '/api/v1/gowns/query') { queries.push(body!); return page([card(2)], null, 1, 1); }
      return { status: 200, body: p === '/api/v1/taxonomy' ? TAX : null };
    });
    const before = queries.length;
    await user.click(within(dialog).getByRole('button', { name: 'Delete 2 folders' }));
    expect(await screen.findByText('2 folders deleted')).toBeTruthy();
    expect(deletes()[0][2]).toEqual({ ids: [id(1), id(3)] });
    await waitFor(() => expect(queries.length).toBe(before + 1));
    expect(await screen.findByText('1 of 1 gowns · latest upload first')).toBeTruthy();
    expect(await screen.findByText('None selected')).toBeTruthy();
  });

  it('Cancel in the dialog deletes nothing and keeps the selection', async () => {
    const user = userEvent.setup();
    await picking(user);
    await user.click(screen.getByRole('checkbox', { name: 'Select all' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Delete 3 folders?' })).getByRole('button', { name: 'Cancel' }));
    expect(deletes()).toHaveLength(0);
    expect(screen.getByText('3 selected')).toBeTruthy();
  });

  it('a failure says to try again and keeps the selection; more than 100 is refused before asking', async () => {
    const user = userEvent.setup();
    await picking(user);
    await user.click(screen.getByRole('checkbox', { name: 'Select all' }));
    mocks.request.mockImplementation(async (_m: string, p: string, body?: Query) => {
      if (p === '/api/v1/gowns/delete') return { status: 500, body: null };
      if (p === '/api/v1/gowns/query') { queries.push(body!); return answer(body!); }
      return { status: 200, body: p === '/api/v1/taxonomy' ? TAX : null };
    });
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Delete 3 folders?' })).getByRole('button', { name: 'Delete 3 folders' }));
    expect(await screen.findByText("Couldn't delete the gowns. Try again.")).toBeTruthy();
    expect(screen.getByText('3 selected')).toBeTruthy();
  });

  it('the confirm dialog has no axe violations', async () => {
    const user = userEvent.setup();
    await picking(user);
    await user.click(screen.getByRole('checkbox', { name: 'Select Gown 1' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByRole('dialog', { name: 'Delete 1 folder?' });
    expect((await axe.run(document.body, noisy)).violations).toEqual([]);
  });
});

