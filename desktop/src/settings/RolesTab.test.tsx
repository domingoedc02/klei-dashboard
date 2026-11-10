import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from '../shell/Shell';
import type { Me } from '../shell/context';

const mocks = vi.hoisted(() => ({ request: vi.fn(), setDirty: vi.fn() }));
vi.mock('../bridge', async (orig) => ({ ...(await orig<typeof import('../bridge')>()), bridge: mocks }));

const ADMIN: Me = { id: 'a1', name: 'Ada Admin', email: 'ada@example.test', role: 'Admin', permissions: ['PERM_MANAGE_STAFF', 'PERM_VIEW_GALLERY'] };
const PERMS = ['PERM_VIEW_GALLERY', 'PERM_UPLOAD_IMAGES', 'PERM_EDIT_GOWN', 'PERM_DELETE_GOWN', 'PERM_REPLY', 'PERM_CLOSE_INQUIRY', 'PERM_MANAGE_STAFF', 'PERM_AI_SETTINGS', 'PERM_VIEW_AUDIT'];
const role = (id: string, name: string, permissions: string[], version = 1, locked = false) => ({ id, name, locked, permissions, version });
const matrix = () => ({
  status: 200,
  body: {
    permissions: PERMS,
    roles: [role('r-admin', 'Admin', PERMS, 1, true), role('r-staff', 'Staff', ['PERM_VIEW_GALLERY', 'PERM_UPLOAD_IMAGES'], 4), role('r-viewer', 'Viewer', ['PERM_VIEW_GALLERY'], 2)],
  },
});

function mount() {
  window.location.hash = '#/settings/roles';
  return render(<Shell me={ADMIN} onExpired={vi.fn()} onSignOut={vi.fn()} />);
}
const box = (perm: string, roleName: string) => screen.getByRole('checkbox', { name: `${perm} for ${roleName}` }) as HTMLInputElement;
const puts = () => mocks.request.mock.calls.filter((c) => c[0] === 'PUT');

async function open() {
  mocks.request.mockImplementation(async (m: string, p: string) => (m === 'GET' && p === '/api/v1/admin/roles' ? matrix() : { status: 200, body: null }));
  const view = mount();
  await screen.findByRole('table', { name: 'Role permissions' });
  return view;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.setDirty.mockResolvedValue(undefined);
});

describe('Roles matrix', () => {
  it('shows nine Permissions by three Roles, Admin locked, and passes axe', async () => {
    const { container } = await open();
    expect(screen.getByText('Admin permissions are locked. Changes take effect right away.')).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Role permissions' });
    expect(within(table).getAllByRole('row')).toHaveLength(10);
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Permission', 'AdminLocked', 'Staff', 'Viewer']);
    for (const p of ['View gallery', 'Upload images', 'Edit gown details', 'Delete gown folders', 'Reply to inquiries', 'Close inquiries', 'Manage staff', 'Change AI settings', 'View audit log']) {
      expect(box(p, 'Admin').checked).toBe(true);
      expect(box(p, 'Admin').disabled).toBe(true);
    }
    expect(box('Upload images', 'Staff').checked).toBe(true);
    expect(box('Reply to inquiries', 'Staff').checked).toBe(false);
    expect(box('Upload images', 'Viewer').checked).toBe(false);
    const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });

  it('saves a toggle at once with the Role version, toasts, and uses the answer version next time', async () => {
    await open();
    mocks.request.mockResolvedValueOnce({ status: 200, body: role('r-staff', 'Staff', ['PERM_VIEW_GALLERY', 'PERM_UPLOAD_IMAGES', 'PERM_REPLY'], 5) });
    await userEvent.click(box('Reply to inquiries', 'Staff'));
    await screen.findByText('Permission updated');
    expect(puts()[0]).toEqual(['PUT', '/api/v1/admin/roles', { roleId: 'r-staff', permissions: ['PERM_VIEW_GALLERY', 'PERM_UPLOAD_IMAGES', 'PERM_REPLY'] }, 4, undefined]);
    expect(box('Reply to inquiries', 'Staff').checked).toBe(true);

    mocks.request.mockResolvedValueOnce({ status: 200, body: role('r-staff', 'Staff', ['PERM_VIEW_GALLERY', 'PERM_REPLY'], 6) });
    await userEvent.click(box('Upload images', 'Staff'));
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts()[1][3]).toBe(5);
    expect(puts()[1][2]).toEqual({ roleId: 'r-staff', permissions: ['PERM_VIEW_GALLERY', 'PERM_REPLY'] });
  });

  it('queues quick toggles on one Role so the second save waits for the first version', async () => {
    await open();
    let release: (v: unknown) => void = () => {};
    mocks.request
      .mockReturnValueOnce(new Promise((r) => { release = r; }))
      .mockResolvedValueOnce({ status: 200, body: role('r-staff', 'Staff', ['PERM_VIEW_GALLERY', 'PERM_UPLOAD_IMAGES', 'PERM_REPLY', 'PERM_EDIT_GOWN'], 6) });
    await userEvent.click(box('Reply to inquiries', 'Staff'));
    await userEvent.click(box('Edit gown details', 'Staff'));
    expect(puts()).toHaveLength(1);
    release({ status: 200, body: role('r-staff', 'Staff', ['PERM_VIEW_GALLERY', 'PERM_UPLOAD_IMAGES', 'PERM_REPLY'], 5) });
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts()[1][3]).toBe(5);
  });

  it('puts the box back and says so when a save fails', async () => {
    await open();
    mocks.request.mockResolvedValueOnce({ status: 500, body: null });
    await userEvent.click(box('Reply to inquiries', 'Staff'));
    await screen.findByText("Couldn't save. Try again.");
    expect(box('Reply to inquiries', 'Staff').checked).toBe(false);
  });

  it('reloads the matrix after a 409 and shows the newer state', async () => {
    await open();
    mocks.request
      .mockResolvedValueOnce({ status: 409, body: null })
      .mockResolvedValueOnce({
        status: 200,
        body: { permissions: PERMS, roles: [role('r-admin', 'Admin', PERMS, 1, true), role('r-staff', 'Staff', ['PERM_VIEW_GALLERY', 'PERM_CLOSE_INQUIRY'], 9), role('r-viewer', 'Viewer', ['PERM_VIEW_GALLERY'], 2)] },
      });
    await userEvent.click(box('Reply to inquiries', 'Staff'));
    await screen.findByText("Couldn't save. Try again.");
    await waitFor(() => expect(box('Close inquiries', 'Staff').checked).toBe(true));
    expect(box('Reply to inquiries', 'Staff').checked).toBe(false);
  });

  it('shows skeleton rows while loading, and an error block whose Retry loads again', async () => {
    mocks.request.mockReturnValue(new Promise(() => {}));
    const { container, unmount } = mount();
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
    unmount();

    vi.resetAllMocks();
    mocks.setDirty.mockResolvedValue(undefined);
    // Only the Roles read fails once.
    let reads = 0;
    mocks.request.mockImplementation(async (_m: string, p: string) => (p === '/api/v1/admin/roles' ? (reads++ === 0 ? { status: 500, body: null } : matrix()) : { status: 200, body: { items: [], roles: [] } }));
    mount();
    await screen.findByText("Couldn't load roles.");
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('table', { name: 'Role permissions' });
  });
});
