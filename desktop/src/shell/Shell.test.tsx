import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from './Shell';
import { useShell, type Me } from './context';
import { PING_MS } from './connection';

const mocks = vi.hoisted(() => ({ request: vi.fn(), setDirty: vi.fn(), uploadFiles: vi.fn() }));
vi.mock('../bridge', async (orig) => ({ ...(await orig<typeof import('../bridge')>()), bridge: (await import('./quietBell')).quietBell(mocks) }));

const ADMIN: Me = {
  id: 'b5c1c8f0-0000-4000-8000-000000000001', name: 'Ada Admin', email: 'ada@example.test', role: 'Admin',
  permissions: ['PERM_VIEW_GALLERY', 'PERM_UPLOAD_IMAGES', 'PERM_REPLY', 'PERM_CLOSE_INQUIRY'],
};
const VIEWER: Me = { ...ADMIN, name: 'Vera Viewer', role: 'Viewer', permissions: ['PERM_VIEW_GALLERY'] };
const NO_GALLERY: Me = { ...VIEWER, permissions: ['PERM_EDIT_GOWN'] };

let api: ReturnType<typeof useShell>;
function Probe() {
  api = useShell();
  return null;
}
function mount(me: Me, onExpired = vi.fn(), onSignOut = vi.fn()) {
  return render(<Shell me={me} onExpired={onExpired} onSignOut={onSignOut}><Probe /></Shell>);
}

async function noViolations(container: HTMLElement) {
  const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
}

beforeEach(() => {
  vi.resetAllMocks();
  window.location.hash = '#/dashboard';
  mocks.setDirty.mockResolvedValue(undefined);
  mocks.uploadFiles.mockResolvedValue({ stored: [], rejected: [], cancelled: false });
});
afterEach(() => vi.useRealTimers());

describe('frame', () => {
  it('shows the Admin sidebar, wordmark, search, bell and profile menu', async () => {
    const { container } = mount(ADMIN);
    expect(screen.getByText('Klei Bridal')).toBeTruthy();
    expect(screen.getByText('K').getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('Workspace')).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect([...nav.querySelectorAll('a')].map((a) => a.textContent)).toEqual(['Dashboard', 'AI Upload', 'Gallery', 'Inquiries', 'Settings']);
    expect([...nav.querySelectorAll('a')].every((a) => a.querySelector('svg.icon.lg[aria-hidden="true"]'))).toBe(true);
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('Dashboard');
    expect(screen.getByRole('searchbox')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'AI Assistant' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Ada Admin' }));
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Profile settings', 'Sign out']);
    expect(screen.getByRole('menu').textContent).toContain('Admin');
    await noViolations(container);
  });

  it('the skip link is the first focusable element and moves focus to #view', async () => {
    mount(ADMIN);
    await userEvent.tab();
    const skip = screen.getByRole('link', { name: 'Skip to main content' });
    expect(document.activeElement).toBe(skip);
    await userEvent.keyboard('{Enter}');
    expect(document.activeElement).toBe(document.getElementById('view'));
    expect(document.getElementById('view')?.tagName).toBe('MAIN');
  });

  it('the profile menu shows name, role, Profile settings and Sign out behind a pill trigger with an avatar', async () => {
    mount(ADMIN);
    const trigger = screen.getByRole('button', { name: 'Ada Admin' });
    expect(trigger.className).toContain('profile-btn');
    expect(trigger.querySelector('.avatar.small')?.textContent).toBe('AA');
    expect(trigger.querySelector('svg')).toBeTruthy();
    await userEvent.click(trigger);
    const menu = screen.getByRole('menu');
    expect(menu.textContent).toContain('Ada Admin');
    expect(menu.textContent).toContain('Admin');
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Profile settings', 'Sign out']);
  });

  it('a default Viewer sees Dashboard, Gallery, Settings; no Inquiries, AI Upload or Assistant', () => {
    mount(VIEWER);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect([...nav.querySelectorAll('a')].map((a) => a.textContent)).toEqual(['Dashboard', 'Gallery', 'Settings']);
    expect(screen.queryByRole('button', { name: 'AI Assistant' })).toBeNull();
  });

  it('Gallery drops from the sidebar when the Role lacks PERM_VIEW_GALLERY', () => {
    mount(NO_GALLERY);
    expect(screen.queryByRole('link', { name: 'Gallery' })).toBeNull();
  });

  it('a route the User cannot open shows the forbidden view without a request', () => {
    window.location.hash = '#/inquiries';
    mount(VIEWER);
    expect(screen.getByRole('heading', { name: "You don't have access" })).toBeTruthy();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('a 403 from the server shows the forbidden view', async () => {
    mocks.request.mockResolvedValue({ status: 403, body: null });
    mount(ADMIN);
    await act(async () => { await api.request('GET', '/api/v1/gowns'); });
    expect(await screen.findByRole('heading', { name: "You don't have access" })).toBeTruthy();
  });

  it('Sign out in the profile menu calls the handler', async () => {
    const onSignOut = vi.fn();
    mount(ADMIN, vi.fn(), onSignOut);
    await userEvent.click(screen.getByRole('button', { name: 'Ada Admin' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('an expired session from any request hands over to the expired screen', async () => {
    mocks.request.mockRejectedValue({ kind: 'session_expired', message: 'x' });
    const onExpired = vi.fn();
    mount(ADMIN, onExpired);
    await act(async () => { await api.request('GET', '/api/v1/gowns').catch(() => {}); });
    expect(onExpired).toHaveBeenCalledTimes(1);
  });
});

describe('changed Permissions', () => {
  it('a refreshed response reloads /me: the sidebar drops AI Upload and its route turns forbidden', async () => {
    window.location.hash = '#/upload';
    const reduced: Me = { ...ADMIN, permissions: ['PERM_VIEW_GALLERY'] };
    mocks.request.mockImplementation(async (_m: string, path: string) =>
      path === '/api/v1/me' ? { status: 200, body: reduced } : { status: 200, body: null, refreshed: true });
    mount(ADMIN);
    expect(screen.getByRole('link', { name: 'AI Upload' })).toBeTruthy();
    await act(async () => { await api.request('GET', '/api/v1/gowns'); });
    await waitFor(() => expect(screen.queryByRole('link', { name: 'AI Upload' })).toBeNull());
    expect(screen.getByRole('heading', { name: "You don't have access" })).toBeTruthy();
    expect(mocks.request.mock.calls.filter((c) => c[1] === '/api/v1/me')).toHaveLength(1);
  });

  it('a plain response does not reload /me', async () => {
    mocks.request.mockResolvedValue({ status: 200, body: null, refreshed: false });
    mount(ADMIN);
    await act(async () => { await api.request('GET', '/api/v1/gowns'); });
    expect(mocks.request.mock.calls.filter((c) => c[1] === '/api/v1/me')).toHaveLength(0);
  });

  it('a Viewer granted PERM_REPLY gets Inquiries and the Assistant', () => {
    mount({ ...VIEWER, permissions: ['PERM_VIEW_GALLERY', 'PERM_REPLY'] });
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect([...nav.querySelectorAll('a')].map((a) => a.textContent)).toEqual(['Dashboard', 'Gallery', 'Inquiries', 'Settings']);
    expect(screen.getByRole('button', { name: 'AI Assistant' })).toBeTruthy();
  });

  it('a no-access refresh hands over with the no-access flag', async () => {
    mocks.request.mockRejectedValue({ kind: 'no_access', message: 'x' });
    const onExpired = vi.fn();
    mount(ADMIN, onExpired);
    await act(async () => { await api.request('GET', '/api/v1/gowns').catch(() => {}); });
    expect(onExpired).toHaveBeenCalledWith(true);
  });
});

describe('toasts, dialog, drawer', () => {
  it('shows at most three toasts; errors persist and are not the ones dropped', async () => {
    mount(ADMIN);
    act(() => { api.toast('Saved'); api.toast('Boom', 'error'); api.toast('Two'); api.toast('Three'); });
    const shown = [...document.querySelectorAll('.toast')].map((e) => e.textContent?.replace('×', ''));
    expect(shown).toEqual(['Boom', 'Two', 'Three']);
  });

  it('a success toast sits in a status region, carries a check icon and clears after 3200 ms; an error does not', async () => {
    vi.useFakeTimers();
    mount(ADMIN);
    act(() => { api.toast('Saved'); api.toast('Boom', 'error'); });
    const saved = screen.getByText('Saved').closest('.toast')!;
    expect(saved.closest('[role="status"]')?.className).toBe('toasts');
    expect(saved.querySelector('svg.icon')).toBeTruthy();
    expect(screen.getByText('Boom').closest('.toast')?.querySelector('svg')).toBeNull();
    act(() => { vi.advanceTimersByTime(3199); });
    expect(screen.queryByText('Saved')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByText('Saved')).toBeNull();
    expect(screen.getByText('Boom')).toBeTruthy();
  });

  it('an info toast clears itself, an error stays until dismissed', async () => {
    vi.useFakeTimers();
    mount(ADMIN);
    act(() => { api.toast('Saved'); api.toast('Boom', 'error'); });
    act(() => { vi.advanceTimersByTime(6000); });
    expect(screen.queryByText('Saved')).toBeNull();
    expect(screen.getByText('Boom')).toBeTruthy();
    vi.useRealTimers();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Boom')).toBeNull();
  });

  it('opens one dialog at a time; a destructive dialog focuses Cancel; Esc closes it', async () => {
    mount(ADMIN);
    const run = vi.fn();
    act(() => {
      api.openDialog({ title: 'Delete gown', body: 'This cannot be undone.', confirm: { label: 'Delete', danger: true, run } });
      api.openDialog({ title: 'Second', body: 'never', confirm: { label: 'No', run: vi.fn() } });
    });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Delete gown' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('a safe dialog focuses its confirm button; Esc closes it and focus returns to the opener', async () => {
    mount(ADMIN);
    const opener = screen.getByRole('button', { name: 'AI Assistant' });
    opener.focus();
    act(() => api.openDialog({ title: 'Keep going?', body: 'Nothing is lost.', confirm: { label: 'Continue', run: vi.fn() } }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('dialog confirm closes then runs; Tab stays inside', async () => {
    mount(ADMIN);
    const run = vi.fn();
    act(() => api.openDialog({ title: 'Close inquiry', body: 'Close it?', confirm: { label: 'Close inquiry', run } }));
    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Close inquiry' }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Esc closes the menu first, then the dialog, then the drawer', async () => {
    mount(ADMIN);
    act(() => { api.openDrawer('Panel', <p>drawer body</p>); });
    act(() => api.openDialog({ title: 'Sure?', body: 'x', confirm: { label: 'Yes', run: vi.fn() } }));
    await userEvent.click(screen.getByRole('button', { name: 'Ada Admin' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('drawer body')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText('drawer body')).toBeNull();
  });

  it('the Assistant button opens the drawer', async () => {
    mount(ADMIN);
    await userEvent.click(screen.getByRole('button', { name: 'AI Assistant' }));
    expect(screen.getByRole('complementary', { name: 'AI Assistant' })).toBeTruthy();
  });
});

describe('keyboard', () => {
  it('"/" and Cmd+K focus search outside inputs, but "/" is typed inside one', async () => {
    mount(ADMIN);
    const box = screen.getByRole('searchbox');
    await userEvent.keyboard('/');
    expect(document.activeElement).toBe(box);
    await userEvent.keyboard('a/b');
    expect((box as HTMLInputElement).value).toBe('a/b');
    (box as HTMLInputElement).blur();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    expect(document.activeElement).toBe(box);
  });
});

describe('connection loss', () => {
  const down = { kind: 'offline', message: 'offline' };

  it('shows the banner, pings every 5 s, then clears with a toast', async () => {
    vi.useFakeTimers();
    mount(ADMIN);
    mocks.request.mockRejectedValue(down);
    await act(async () => { await api.request('GET', '/api/v1/gowns').catch(() => {}); });
    expect(screen.getByRole('status').textContent).toBe('Offline. Reconnecting…');
    expect(api.offline).toBe(true);

    mocks.request.mockClear();
    mocks.request.mockResolvedValue({ status: 503, body: null });
    await act(async () => { await vi.advanceTimersByTimeAsync(PING_MS); });
    expect(mocks.request).toHaveBeenCalledWith('GET', '/health/ready');
    expect(screen.getByText('Offline. Reconnecting…')).toBeTruthy();

    mocks.request.mockResolvedValue({ status: 200, body: null });
    await act(async () => { await vi.advanceTimersByTimeAsync(PING_MS); });
    expect(screen.queryByText('Offline. Reconnecting…')).toBeNull();
    expect(screen.getByText('Back online')).toBeTruthy();
    expect(api.offline).toBe(false);

    mocks.request.mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(PING_MS * 3); });
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each([['timeout'], ['offline']])('a %s raises the banner', async (kind) => {
    mount(ADMIN);
    mocks.request.mockRejectedValue({ kind, message: kind });
    await act(async () => { await api.request('GET', '/api/v1/gowns').catch(() => {}); });
    expect(screen.getByText('Offline. Reconnecting…')).toBeTruthy();
  });

  it.each([[502], [503]])('a %i response raises the banner', async (status) => {
    mount(ADMIN);
    mocks.request.mockResolvedValue({ status, body: null });
    await act(async () => { await api.request('GET', '/api/v1/gowns'); });
    expect(screen.getByText('Offline. Reconnecting…')).toBeTruthy();
  });

  it('a 500 does not', async () => {
    mount(ADMIN);
    mocks.request.mockResolvedValue({ status: 500, body: null });
    await act(async () => { await api.request('GET', '/api/v1/gowns'); });
    expect(screen.queryByText('Offline. Reconnecting…')).toBeNull();
  });
});

describe('dirty state', () => {
  it('setDirty reaches the shell command', async () => {
    mount(ADMIN);
    act(() => api.setDirty(true));
    await waitFor(() => expect(mocks.setDirty).toHaveBeenCalledWith(true));
  });
});
