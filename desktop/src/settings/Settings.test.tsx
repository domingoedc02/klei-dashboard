import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from '../shell/Shell';
import type { Me } from '../shell/context';

const mocks = vi.hoisted(() => ({ request: vi.fn(), setDirty: vi.fn() }));
vi.mock('../bridge', async (orig) => ({ ...(await orig<typeof import('../bridge')>()), bridge: (await import('../shell/quietBell')).quietBell(mocks) }));

const ALL = ['PERM_MANAGE_STAFF', 'PERM_AI_SETTINGS', 'PERM_KEY_ROTATE', 'PERM_VIEW_AUDIT', 'PERM_AWAY', 'PERM_VIEW_GALLERY'];
const ADMIN: Me = { id: 'a1', name: 'Ada Admin', email: 'ada@example.test', role: 'Admin', permissions: ALL };
const STAFF: Me = { ...ADMIN, name: 'Sam Staff', role: 'Staff', permissions: ['PERM_VIEW_GALLERY'] };

function mount(me: Me, hash = '#/settings') {
  window.location.hash = hash;
  return render(<Shell me={me} onExpired={vi.fn()} onSignOut={vi.fn()} />);
}
const tabs = () => within(screen.getByRole('tablist', { name: 'Settings sections' })).getAllByRole('tab').map((t) => t.textContent);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.setDirty.mockResolvedValue(undefined);
  mocks.request.mockResolvedValue({ status: 200, body: null });
});

describe('Settings frame', () => {
  it('shows four personal tabs with icons, and no Admin tab or workspace line for Staff', () => {
    const { container } = mount(STAFF);
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByText('Manage your account.')).toBeTruthy();
    expect(tabs()).toEqual(['Profile', 'Signature', 'Preferences', 'Notifications']);
    expect(container.querySelectorAll('[role="tab"] svg.icon').length).toBe(4);
    expect(screen.getByRole('tab', { name: 'Profile', selected: true })).toBeTruthy();
  });

  it('adds the Admin tab with its badge and the workspace line for permitted users', () => {
    mount(ADMIN);
    expect(screen.getByText('Manage your account and workspace.')).toBeTruthy();
    expect(tabs()).toEqual(['Profile', 'Signature', 'Preferences', 'Notifications', 'AdminAdmin only']);
    expect(screen.getByRole('tab', { name: /^Admin/, selected: false })).toBeTruthy();
  });

  it('opens Profile by default for an Admin and shows the Admin sections in order on click', async () => {
    mount(ADMIN);
    expect(screen.getByRole('tab', { name: 'Profile', selected: true })).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: /^Admin/ }));
    const group = screen.getByRole('group', { name: 'Admin sections' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Staff', 'Roles & permissions', 'AI settings', 'AI usage', 'Keys', 'Away message', 'Audit log']);
    expect(within(group).getByRole('button', { name: 'Staff' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(group).getByRole('button', { name: 'Keys' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('lists only the sub-tabs the user may open', async () => {
    mount({ ...ADMIN, permissions: ['PERM_VIEW_AUDIT'] }, '#/settings/admin');
    const group = screen.getByRole('group', { name: 'Admin sections' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Audit log']);
  });

  it('keeps the old deep links: #/settings/staff opens Admin, Staff for an Admin and Profile for Staff', () => {
    const { unmount } = mount(ADMIN, '#/settings/keys');
    expect(screen.getByRole('tab', { name: /^Admin/, selected: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keys', pressed: true })).toBeTruthy();
    unmount();
    mount(STAFF, '#/settings/staff');
    expect(screen.getByRole('tab', { name: 'Profile', selected: true })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Admin sections' })).toBeNull();
  });

  it('moves focus and selection with the arrow keys, Home and End; only the selected tab is tabbable', async () => {
    mount(ADMIN);
    const u = userEvent.setup();
    const tab = (n: string) => screen.getByRole('tab', { name: new RegExp(`^${n}`) });
    const stops = () => screen.getAllByRole('tab').filter((t) => t.tabIndex === 0).map((t) => t.id);
    expect(stops()).toEqual(['tab-profile']);
    tab('Profile').focus();
    await u.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(tab('Signature'));
    expect(tab('Signature').getAttribute('aria-selected')).toBe('true');
    expect(stops()).toEqual(['tab-signature']);
    await u.keyboard('{End}');
    expect(document.activeElement).toBe(tab('Admin'));
    await u.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(tab('Profile'));
    await u.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(tab('Admin'));
    await u.keyboard('{Home}');
    expect(document.activeElement).toBe(tab('Profile'));
    expect(stops()).toEqual(['tab-profile']);
  });

  it('passes axe on every tab and sub-tab', async () => {
    const { container } = mount(ADMIN);
    const u = userEvent.setup();
    const clean = async () => {
      const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
      expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    };
    for (const t of ['Profile', 'Signature', 'Preferences', 'Notifications']) {
      await u.click(screen.getByRole('tab', { name: new RegExp(`^${t}`) }));
      await clean();
    }
    await u.click(screen.getByRole('tab', { name: /^Admin/ }));
    for (const s of ['Staff', 'Roles & permissions', 'AI settings', 'AI usage', 'Keys', 'Away message', 'Audit log']) {
      await u.click(screen.getByRole('button', { name: s }));
      await clean();
    }
  });
});
