import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from './Shell';
import type { Me } from './context';

const mocks = vi.hoisted(() => ({ request: vi.fn(), setDirty: vi.fn(), uploadFiles: vi.fn() }));
vi.mock('../bridge', async (orig) => ({ ...(await orig<typeof import('../bridge')>()), bridge: mocks }));

const ME: Me = { id: 'a1', name: 'Ada Admin', email: 'ada@example.test', role: 'Admin', permissions: ['PERM_VIEW_GALLERY', 'PERM_REPLY'] };
const G1 = '0b1c2d3e-0000-4000-8000-000000000001';
const I1 = '0b1c2d3e-0000-4000-8000-000000000002';
const HITS = [
  { kind: 'gown', id: G1, title: 'Aurora', subtitle: 'A-line, Silk', thumbs: ['p1', 'p2'] },
  { kind: 'inquiry', id: I1, title: 'Mia Client', subtitle: 'Aurora fitting' },
];

let answer: () => Promise<{ status: number; body?: unknown }>;
let searches: unknown[];

beforeEach(() => {
  vi.resetAllMocks();
  window.location.hash = '#/dashboard';
  mocks.setDirty.mockResolvedValue(undefined);
  searches = [];
  answer = async () => ({ status: 200, body: { items: HITS } });
  mocks.request.mockImplementation(async (m: string, p: string, b?: unknown) => {
    if (p === '/api/v1/notifications') return { status: 200, body: { items: [], unread: 0 } };
    if (p === '/api/v1/dashboard') return { status: 200, body: { aiStatus: { phase: 'idle' }, errors: [] } };
    if (p === '/api/v1/search' && m === 'POST') { searches.push(b); return answer(); }
    return { status: 200, body: null };
  });
});

const mount = (me: Me = ME) => render(<Shell me={me} onExpired={vi.fn()} onSignOut={vi.fn()} />);
const box = () => screen.getByRole('searchbox');
const find = async (text: string) => { await userEvent.type(box(), text); return screen.findByRole('listbox', { name: 'Search results' }); };

describe('SearchBox', () => {
  it('asks once after typing stops, with the words in the body, and lists the hits in one flat list in server order', async () => {
    mount();
    const list = await find('aurora');
    expect(searches).toEqual([{ q: 'aurora' }]);
    expect(within(list).queryAllByRole('group')).toHaveLength(0);
    const options = within(list).getAllByRole('option');
    expect(options[0].textContent).toContain('Aurora');
    expect(options[0].textContent).toContain('A-line, Silk');
    expect(options[0].querySelector('svg')).toBeTruthy();
    expect(options[0].querySelectorAll('img')).toHaveLength(0);
    expect(options[1].textContent).toContain('Mia Client');
    expect(options[1].textContent).toContain('Aurora fitting');
  });

  it('shows at most six hits', async () => {
    answer = async () => ({ status: 200, body: { items: Array.from({ length: 8 }, (_, i) => ({ kind: 'inquiry', id: `0b1c2d3e-0000-4000-8000-0000000001${i}0`, title: `Client ${i}`, subtitle: 'Fitting' })) } });
    mount();
    const list = await find('client');
    expect(within(list).getAllByRole('option')).toHaveLength(6);
  });

  it('arrow keys move and Enter opens the Gown or the Inquiry', async () => {
    mount();
    await find('aurora');
    expect(box().hasAttribute('aria-activedescendant')).toBe(false);
    await userEvent.keyboard('{Enter}');
    expect(window.location.hash).toBe(`#/gallery/${G1}`);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect((box() as HTMLInputElement).value).toBe('');

    await find('aurora');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(box().getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[1].id);
    await userEvent.keyboard('{Enter}');
    expect(window.location.hash).toBe(`#/inquiries/${I1}`);
  });

  it('clicking a result opens it', async () => {
    mount();
    await find('aurora');
    await userEvent.click(screen.getAllByRole('option')[1]);
    expect(window.location.hash).toBe(`#/inquiries/${I1}`);
  });

  it('the box reads "Search gowns, inquiries…"', () => {
    mount();
    expect(box().getAttribute('placeholder')).toBe('Search gowns, inquiries…');
  });

  it('says so when nothing matches and Clear search empties the box', async () => {
    answer = async () => ({ status: 200, body: { items: [] } });
    mount();
    await userEvent.type(box(), 'zzz');
    expect(await screen.findByText('No results for “zzz”')).toBeTruthy();
    expect(screen.getByText('Check the spelling or try a gown name, fabric, or client.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect((box() as HTMLInputElement).value).toBe('');
    expect(screen.queryByText(/No results/)).toBeNull();
  });

  it('shows the error with Try again that asks again', async () => {
    answer = async () => ({ status: 500, body: null });
    mount();
    await userEvent.type(box(), 'aurora');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Search is unavailable.');
    answer = async () => ({ status: 200, body: { items: HITS } });
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('listbox', { name: 'Search results' })).toBeTruthy();
    expect(searches).toHaveLength(2);
  });

  it('asks nothing for an empty box or spaces', async () => {
    mount();
    await userEvent.type(box(), '   ');
    await new Promise((r) => setTimeout(r, 400));
    expect(searches).toEqual([]);
    expect(screen.queryByText(/No results/)).toBeNull();
  });

  it('an older answer that arrives late never replaces the newer one', async () => {
    let slow!: (v: { status: number; body: unknown }) => void;
    let n = 0;
    answer = () => (++n === 1
      ? new Promise((res) => { slow = res; })
      : Promise.resolve({ status: 200, body: { items: [{ kind: 'gown', id: G1, title: 'Newer', thumbs: [] }] } }));
    mount();
    await userEvent.type(box(), 'old');
    await waitFor(() => expect(searches).toHaveLength(1));
    await userEvent.type(box(), 'er');
    expect(await screen.findByText('Newer')).toBeTruthy();
    slow({ status: 200, body: { items: [{ kind: 'gown', id: G1, title: 'Stale', thumbs: [] }] } });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Stale')).toBeNull();
    expect(screen.getByText('Newer')).toBeTruthy();
  });

  it('Escape closes the popover', async () => {
    mount();
    await find('aurora');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('is disabled and never asks for a User with neither PERM_VIEW_GALLERY nor PERM_REPLY', async () => {
    mount({ ...ME, role: 'Nobody', permissions: ['PERM_EDIT_GOWN'] });
    expect((box() as HTMLInputElement).disabled).toBe(true);
    expect(searches).toEqual([]);
  });

  it('axe finds nothing with the popover open', async () => {
    const { container } = mount();
    await find('aurora');
    const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
});
