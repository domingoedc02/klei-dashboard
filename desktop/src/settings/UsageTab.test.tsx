import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from '../shell/Shell';
import type { Me } from '../shell/context';

const mocks = vi.hoisted(() => ({ request: vi.fn(), setDirty: vi.fn() }));
vi.mock('../bridge', async (orig) => ({ ...(await orig<typeof import('../bridge')>()), bridge: mocks }));

const ADMIN: Me = { id: 'a1', name: 'Ada Admin', email: 'ada@example.test', role: 'Admin', permissions: ['PERM_AI_SETTINGS', 'PERM_VIEW_GALLERY'] };
const row = (n: number, over: object = {}) => ({ id: `u${n}`, time: '2026-11-08T10:00:00Z', user: 'Ada Admin', purpose: 'embed', model: 'dinov2-base', size: 2048, outcome: 'ok', durationMs: 340, ...over });
const page = (n: number, pages: number, items: object[]) => ({ status: 200, body: { items, page: n, pages } });

// The AI provider tab is the first tab for this user and reads its own paths; only the usage path gets the queued answers.
type Answer = { status: number; body: unknown } | Promise<never>;
function usageAnswers(...queue: Answer[]) {
  mocks.request.mockImplementation(async (_m: string, p: string) => (p.startsWith('/api/v1/admin/ai/usage') ? (queue.length > 1 ? queue.shift() : queue[0]) : { status: 200, body: null }));
}
const usageCalls = () => mocks.request.mock.calls.map((c) => c[1]).filter((p) => String(p).startsWith('/api/v1/admin/ai/usage'));

async function open(me = ADMIN) {
  window.location.hash = '#/settings/usage';
  return render(<Shell me={me} onExpired={vi.fn()} onSignOut={vi.fn()} />);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.setDirty.mockResolvedValue(undefined);
});

describe('AI usage tab', () => {
  it('lists the columns with an outcome pill, readable size and duration, and passes axe', async () => {
    usageAnswers(page(1, 3, [row(2), row(1, { purpose: 'test', model: null, size: null, outcome: 'timeout', user: 'System', durationMs: 4200 }), row(3, { purpose: 'verify', model: 'vision-x' })]));
    const { container } = await open();
    const table = await screen.findByRole('table', { name: 'AI usage' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Time', 'User', 'Purpose', 'Model', 'Size', 'Outcome', 'Duration']);
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(within(rows[3]).getByText('Grouping check')).toBeTruthy();
    for (const t of ['Ada Admin', 'Photo matching', 'dinov2-base', '2 KB', 'OK', '340 ms']) expect(within(rows[1]).getByText(t)).toBeTruthy();
    for (const t of ['System', 'Test connection', 'Timed out', '4.2 s']) expect(within(rows[2]).getByText(t)).toBeTruthy();
    expect(within(rows[2]).getAllByText('–')).toHaveLength(2);
    expect(within(rows[2]).getByText('Timed out').className).toContain('warn');
    expect(screen.getByText('Page 1 of 3')).toBeTruthy();
    const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });

  it('pages with Next and Previous', async () => {
    usageAnswers(page(1, 2, [row(2)]), page(2, 2, [row(1)]), page(1, 2, [row(2)]));
    await open();
    await screen.findByText('Page 1 of 2');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Page 2 of 2');
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await screen.findByText('Page 1 of 2');
    expect(usageCalls()).toEqual(['/api/v1/admin/ai/usage?page=1', '/api/v1/admin/ai/usage?page=2', '/api/v1/admin/ai/usage?page=1']);
  });

  it('shows the empty state', async () => {
    usageAnswers(page(1, 1, []));
    await open();
    await screen.findByText('No AI requests yet');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows skeleton rows while loading, and an error block whose Retry loads again', async () => {
    usageAnswers(new Promise<never>(() => {}));
    const first = await open();
    expect(first.container.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
    first.unmount();

    vi.resetAllMocks();
    mocks.setDirty.mockResolvedValue(undefined);
    usageAnswers({ status: 500, body: null }, page(1, 1, [row(1)]));
    await open();
    await screen.findByText("Couldn't load the AI usage log.");
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('table', { name: 'AI usage' });
  });

  it('is absent without PERM_AI_SETTINGS', () => {
    window.location.hash = '#/settings';
    render(<Shell me={{ ...ADMIN, permissions: ['PERM_VIEW_GALLERY', 'PERM_VIEW_AUDIT'] }} onExpired={vi.fn()} onSignOut={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'AI usage' })).toBeNull();
  });
});
