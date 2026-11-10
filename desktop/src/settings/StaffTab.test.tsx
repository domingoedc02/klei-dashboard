import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from '../shell/Shell';
import type { Me } from '../shell/context';

const mocks = vi.hoisted(() => ({ request: vi.fn(), setDirty: vi.fn() }));
vi.mock('../bridge', async (orig) => ({ ...(await orig<typeof import('../bridge')>()), bridge: (await import('../shell/quietBell')).quietBell(mocks) }));

const ADMIN: Me = { id: 'a1', name: 'Ada Admin', email: 'ada@example.test', role: 'Admin', permissions: ['PERM_MANAGE_STAFF', 'PERM_VIEW_GALLERY'] };
const STAFF_ME: Me = { ...ADMIN, name: 'Sam Staff', role: 'Staff', permissions: ['PERM_VIEW_GALLERY'] };
const ROLES = [{ id: 'r-admin', name: 'Admin' }, { id: 'r-staff', name: 'Staff' }, { id: 'r-viewer', name: 'Viewer' }];
const ADA = { id: 'a1', name: 'Ada Admin', email: 'ada@example.test', roleId: 'r-admin', role: 'Admin', status: 'active', lastActive: '2026-11-08T10:00:00Z', hasAvatar: false, lastAdmin: true, version: 3 };
const INA = { id: 'u2', name: 'Ina Invited', email: 'ina@example.test', roleId: 'r-viewer', role: 'Viewer', status: 'invited', lastActive: null, hasAvatar: false, lastAdmin: false, version: 1 };
const list = (...items: object[]) => ({ status: 200, body: { items, next: null, total: items.length, roles: ROLES } });

function mount(me = ADMIN) {
  window.location.hash = '#/settings/staff';
  return render(<Shell me={me} onExpired={vi.fn()} onSignOut={vi.fn()} />);
}
const calls = (method: string) => mocks.request.mock.calls.filter((c) => c[0] === method);

async function noViolations(container: HTMLElement) {
  const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.setDirty.mockResolvedValue(undefined);
});

describe('Settings frame', () => {
  it('hides the Staff tab without the staff permission', () => {
    mount(STAFF_ME);
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Staff' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Profile', selected: true })).toBeTruthy();
    expect(mocks.request.mock.calls.every((c) => String(c[1]).startsWith('/api/v1/me'))).toBe(true);
  });
});

describe('Staff table', () => {
  it('lists people with Role and Status pills, row actions by status, and passes axe', async () => {
    mocks.request.mockResolvedValue(list(ADA, INA));
    const { container } = mount();
    expect(screen.getByRole('button', { name: 'Staff', pressed: true })).toBeTruthy();
    await screen.findByText('Ina Invited');
    const rows = within(screen.getByRole('table', { name: 'Staff' })).getAllByRole('row');
    expect(within(rows[1]).getByText('Active')).toBeTruthy();
    expect(within(rows[2]).getByText('Invited')).toBeTruthy();
    expect(within(rows[2]).getByText('Viewer')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resend invite to Ina Invited' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Resend invite to Ada Admin' })).toBeNull();
    expect(screen.queryByText('No staff yet')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Staff (2)' })).toBeTruthy();
    await noViolations(container);
  });

  it('shows skeleton rows while loading', () => {
    mocks.request.mockReturnValue(new Promise(() => {}));
    const { container } = mount();
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
  });

  it('shows an error block and Retry loads again', async () => {
    mocks.request.mockResolvedValueOnce({ status: 500, body: null }).mockResolvedValue(list(ADA));
    mount();
    await screen.findByText("Couldn't load staff.");
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('table', { name: 'Staff' });
  });

  it('shows the empty state with the art and Invite staff when only the Admin exists', async () => {
    mocks.request.mockResolvedValue(list(ADA));
    const { container } = mount();
    await screen.findByText('Invite teammates so they can upload gowns and reply to clients.');
    expect(screen.getByRole('heading', { name: 'No staff yet' })).toBeTruthy();
    expect(container.querySelector('.empty img')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Invite staff' })).toBeTruthy();
  });

  it('disables Delete on the last Admin with the tooltip', async () => {
    mocks.request.mockResolvedValue(list(ADA, INA));
    mount();
    const del = await screen.findByRole('button', { name: 'Delete Ada Admin' });
    expect(del.getAttribute('aria-disabled')).toBe('true');
    expect(del.getAttribute('title')).toBe('A studio needs at least one admin.');
    await userEvent.click(del);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Invite and edit', () => {
  it('validates, then posts the invite, toasts and reloads', async () => {
    mocks.request.mockResolvedValueOnce(list(ADA)).mockResolvedValueOnce({ status: 201, body: {} }).mockResolvedValue(list(ADA, INA));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Invite staff' }));
    const dlg = screen.getByRole('dialog');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Send invite' }));
    expect(within(dlg).getByText('Enter a name of up to 100 characters.')).toBeTruthy();
    expect(within(dlg).getByText('Enter a valid email address.')).toBeTruthy();
    expect(calls('POST')).toHaveLength(0);

    await userEvent.type(within(dlg).getByLabelText('Name'), ' Ina Invited ');
    await userEvent.type(within(dlg).getByLabelText('Email'), 'ina@example.test');
    await userEvent.selectOptions(within(dlg).getByLabelText('Role'), 'Viewer');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Send invite' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls('POST')[0].slice(1, 3)).toEqual(['/api/v1/admin/users', { name: 'Ina Invited', email: 'ina@example.test', roleId: 'r-viewer' }]);
    expect(screen.getByRole('status').textContent).toContain('Invite sent to ina@example.test');
    await screen.findByText('Ina Invited');
  });

  it('says so when the email is taken', async () => {
    mocks.request.mockResolvedValueOnce(list(ADA)).mockResolvedValueOnce({ status: 409, body: null });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Invite staff' }));
    const dlg = screen.getByRole('dialog');
    await userEvent.type(within(dlg).getByLabelText('Name'), 'Ina');
    await userEvent.type(within(dlg).getByLabelText('Email'), 'ada@example.test');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Send invite' }));
    await within(dlg).findByText('Someone already has that email.');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('sends only the changed fields with the row version as If-Match', async () => {
    mocks.request.mockResolvedValueOnce(list(ADA, INA)).mockResolvedValueOnce({ status: 200, body: {} }).mockResolvedValue(list(ADA, INA));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Ina Invited' }));
    const dlg = screen.getByRole('dialog');
    expect(dlg.textContent).toContain('Changing the email or role sends a new invite.');
    expect(within(dlg).getByRole('heading').textContent).toBe('Edit staff member');
    const name = within(dlg).getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Ina Renamed');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls('PATCH')[0]).toEqual(['PATCH', '/api/v1/admin/users/u2', { name: 'Ina Renamed' }, 1, undefined]);
    expect(screen.getByRole('status').textContent).toContain('Changes saved');
  });

  it('closes with a message when the row changed under the editor', async () => {
    const newer = { ...INA, name: 'Ina Elsewhere', version: 2 };
    mocks.request.mockResolvedValueOnce(list(ADA, INA)).mockResolvedValueOnce({ status: 409, body: null }).mockResolvedValue(list(ADA, newer));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Ina Invited' }));
    const dlg = screen.getByRole('dialog');
    await userEvent.type(within(dlg).getByLabelText('Name'), '!');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('alert').textContent).toContain('Someone else changed this person.');
    await screen.findByText('Ina Elsewhere');
  });

  it('pins the Role of the last Admin', async () => {
    mocks.request.mockResolvedValue(list(ADA, INA));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Ada Admin' }));
    const role = within(screen.getByRole('dialog')).getByLabelText('Role') as HTMLSelectElement;
    expect(role.disabled).toBe(true);
    expect(screen.getByRole('dialog').textContent).toContain('A studio needs at least one admin.');
  });
});

describe('Two-factor reset', () => {
  const IVY = { ...INA, id: 'u3', name: 'Ivy Secure', email: 'ivy@example.test', status: 'active', twoFactor: true };

  it('offers Reset two-factor only for a person who has it, posts, toasts and reloads', async () => {
    mocks.request.mockResolvedValueOnce(list(ADA, IVY)).mockResolvedValueOnce({ status: 204, body: null }).mockResolvedValue(list(ADA, { ...IVY, twoFactor: false }));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Ada Admin' }));
    expect(screen.queryByRole('button', { name: 'Reset two-factor' })).toBeNull();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit Ivy Secure' }));
    const dlg = screen.getByRole('dialog');
    expect(dlg.textContent).toContain('Two-factor sign-in is on for this person.');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Reset two-factor' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls('POST')[0][1]).toBe('/api/v1/admin/users/u3/2fa/reset');
    expect(screen.getByRole('status').textContent).toContain('Two-factor reset for Ivy Secure');
    await userEvent.click(screen.getByRole('button', { name: 'Edit Ivy Secure' }));
    expect(screen.queryByRole('button', { name: 'Reset two-factor' })).toBeNull();
  });

  it('says so when it was already off (409)', async () => {
    mocks.request.mockResolvedValueOnce(list(ADA, IVY)).mockResolvedValueOnce({ status: 409, body: null }).mockResolvedValue(list(ADA, { ...IVY, twoFactor: false }));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Ivy Secure' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reset two-factor' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('alert').textContent).toContain('Two-factor is already off for this person.');
  });
});

describe('Resend and delete', () => {
  it('toasts "Invite re-sent to {email}"', async () => {
    mocks.request.mockResolvedValueOnce(list(ADA, INA)).mockResolvedValueOnce({ status: 204, body: null });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Resend invite to Ina Invited' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Invite re-sent to ina@example.test×'));
    expect(calls('POST')[0][1]).toBe('/api/v1/admin/users/u2/resend');
  });

  it('confirms with Cancel focused, then deletes and reloads', async () => {
    mocks.request.mockResolvedValueOnce(list(ADA, INA)).mockResolvedValueOnce({ status: 204, body: null }).mockResolvedValue(list(ADA));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Ina Invited' }));
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).getByRole('heading').textContent).toBe('Delete Ina Invited?');
    expect(dlg.textContent).toContain('Ina Invited will lose access immediately. Their uploads and replies stay in the workspace. This can’t be undone.');
    expect(document.activeElement).toBe(within(dlg).getByRole('button', { name: 'Cancel' }));
    await userEvent.click(within(dlg).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('Ina Invited')).toBeNull());
    expect(calls('DELETE')[0][1]).toBe('/api/v1/admin/users/u2');
  });

  it('keeps the row and says why when the server refuses the last Admin', async () => {
    const other = { ...INA, lastAdmin: false };
    mocks.request.mockResolvedValueOnce(list(ADA, other)).mockResolvedValueOnce({ status: 409, body: null }).mockResolvedValue(list(ADA, other));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Ina Invited' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await screen.findByText('A studio needs at least one admin.');
    expect(screen.getByText('Ina Invited')).toBeTruthy();
  });
});
