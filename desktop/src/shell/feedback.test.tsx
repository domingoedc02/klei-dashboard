import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from './Shell';
import type { Me } from './context';

const mocks = vi.hoisted(() => ({ request: vi.fn(), setDirty: vi.fn() }));
vi.mock('../bridge', async (orig) => ({ ...(await orig<typeof import('../bridge')>()), bridge: mocks }));

const ME: Me = { id: 's1', name: 'Sam Staff', email: 'sam@example.test', role: 'Staff', permissions: ['PERM_VIEW_GALLERY', 'PERM_REPLY'] };
const row = { id: '0b1c2d3e-0000-4000-8000-000000000001', clientId: '0b1c2d3e-0000-4000-8000-000000000501', clientName: 'Client 1', subject: 'Subject 1', preview: 'Preview 1', lastMessageAt: '2026-11-01T10:00:00Z', status: 'new', unread: true };
const BUDGET_MS = 100;

/** NFR-2: a control answers a click in under 100 ms even while the server is slow, so every request here takes a second. */
beforeEach(() => {
  vi.resetAllMocks();
  mocks.setDirty.mockResolvedValue(undefined);
  const late = (body: unknown) => new Promise((r) => setTimeout(() => r({ status: 200, body }), 1000));
  mocks.request.mockImplementation((m: string, p: string, b?: { status?: string }) => {
    if (p === '/api/v1/inquiries/query') return b?.status === 'closed' ? late({ items: [], next: null }) : Promise.resolve({ status: 200, body: { items: [row], next: null } });
    if (p === '/api/v1/inquiries/count') return Promise.resolve({ status: 200, body: { count: 1 } });
    if (p === '/api/v1/notifications' && m === 'GET') return late({ items: [], unread: 0 });
    return Promise.resolve({ status: 200, body: null });
  });
});

const timed = (act: () => void) => { const s = performance.now(); act(); return performance.now() - s; };

describe('UI feedback under 100 ms', () => {
  it('a filter chip shows pressed at once while its request is still out', async () => {
    window.location.hash = '#/inquiries';
    render(<Shell me={ME} onExpired={vi.fn()} onSignOut={vi.fn()} />);
    await screen.findByRole('list', { name: 'Inquiries' });
    const chip = screen.getByRole('button', { name: 'Closed' });
    const ms = timed(() => fireEvent.click(chip));
    expect(screen.getByRole('button', { name: 'Closed' }).getAttribute('aria-pressed')).toBe('true');
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('the Bell menu opens at once while its list is still loading', async () => {
    window.location.hash = '#/dashboard';
    render(<Shell me={ME} onExpired={vi.fn()} onSignOut={vi.fn()} />);
    const bell = await screen.findByRole('button', { name: /^Notifications/ });
    const ms = timed(() => fireEvent.click(bell));
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeTruthy();
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});
