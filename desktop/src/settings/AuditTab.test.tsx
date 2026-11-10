import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from '../shell/Shell';
import type { Me } from '../shell/context';

const mocks = vi.hoisted(() => ({ request: vi.fn(), setDirty: vi.fn() }));
vi.mock('../bridge', async (orig) => ({ ...(await orig<typeof import('../bridge')>()), bridge: (await import('../shell/quietBell')).quietBell(mocks) }));

const AUDITOR: Me = { id: 'a1', name: 'Ada Admin', email: 'ada@example.test', role: 'Admin', permissions: ['PERM_VIEW_AUDIT', 'PERM_VIEW_GALLERY'] };
const row = (n: number, action: string, extra: object = {}) => ({ id: `e${n}`, ts: '2026-11-08T10:00:00Z', actor: 'Ada Admin', action, detail: null, ip: '203.0.113.9', ...extra });
const page = (n: number, pages: number, items: object[]) => ({ status: 200, body: { items, page: n, pages } });

function mount(me = AUDITOR) {
  window.location.hash = '#/settings/audit';
  return render(<Shell me={me} onExpired={vi.fn()} onSignOut={vi.fn()} />);
}
const reads = () => mocks.request.mock.calls.filter((c) => String(c[1]).startsWith('/api/v1/admin/audit')).map((c) => c[1]);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.setDirty.mockResolvedValue(undefined);
});

describe('Audit log tab', () => {
  it('lists newest first with a label map, detail, IP, the pager, and passes axe', async () => {
    mocks.request.mockResolvedValue(page(1, 3, [row(2, 'role_permissions_changed', { detail: 'Staff: +PERM_REPLY' }), row(1, 'brand_new_code', { ip: null })]));
    const { container } = mount();
    const table = await screen.findByRole('table', { name: 'Audit log' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText('Role permissions changed')).toBeTruthy();
    expect(within(rows[1]).getByText('Staff: +PERM_REPLY')).toBeTruthy();
    expect(within(rows[1]).getByText('203.0.113.9')).toBeTruthy();
    expect(within(rows[2]).getByText('brand_new_code')).toBeTruthy();
    expect(within(rows[2]).getByText('–')).toBeTruthy();
    expect(screen.getByText('Page 1 of 3')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true);
    const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });

  it('pages with Next and Previous and disables each at its end', async () => {
    mocks.request
      .mockResolvedValueOnce(page(1, 2, [row(2, 'user_deleted')]))
      .mockResolvedValueOnce(page(2, 2, [row(1, 'user_invited')]))
      .mockResolvedValueOnce(page(1, 2, [row(2, 'user_deleted')]));
    mount();
    await screen.findByText('Page 1 of 2');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Page 2 of 2');
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await screen.findByText('Page 1 of 2');
    expect(reads()).toEqual(['/api/v1/admin/audit?page=1', '/api/v1/admin/audit?page=2', '/api/v1/admin/audit?page=1']);
  });

  it('shows the empty state when there is no activity', async () => {
    mocks.request.mockResolvedValue(page(1, 1, []));
    mount();
    await screen.findByText('No activity yet');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows skeleton rows while loading, and an error block whose Retry loads again', async () => {
    mocks.request.mockReturnValue(new Promise(() => {}));
    const first = mount();
    expect(first.container.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
    first.unmount();

    vi.resetAllMocks();
    mocks.setDirty.mockResolvedValue(undefined);
    mocks.request.mockResolvedValueOnce({ status: 500, body: null }).mockResolvedValue(page(1, 1, [row(1, 'user_invited')]));
    mount();
    await screen.findByText("Couldn't load the audit log.");
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('table', { name: 'Audit log' });
  });

  it('is absent without the permission, and has no edit or delete control', async () => {
    mocks.request.mockResolvedValue(page(1, 1, [row(1, 'user_invited')]));
    const { unmount } = mount();
    await screen.findByRole('table', { name: 'Audit log' });
    expect(screen.queryByRole('button', { name: /edit|delete|remove/i })).toBeNull();
    unmount();

    mount({ ...AUDITOR, permissions: ['PERM_VIEW_GALLERY', 'PERM_MANAGE_STAFF'] });
    expect(screen.queryByRole('button', { name: 'Audit log' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Staff', pressed: true })).toBeTruthy();
  });
});
