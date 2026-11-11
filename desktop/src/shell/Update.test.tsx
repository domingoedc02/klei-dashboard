import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from './Shell';
import type { Me } from './context';

const mocks = vi.hoisted(() => ({
  request: vi.fn(), setDirty: vi.fn(), uploadFiles: vi.fn(), checkUpdate: vi.fn(), installUpdate: vi.fn(),
}));
vi.mock('../bridge', async (orig) => ({ ...(await orig<typeof import('../bridge')>()), bridge: (await import('./quietBell')).quietBell(mocks) }));

const ME: Me = { id: 'a1', name: 'Ada Admin', email: 'ada@example.test', role: 'Admin', permissions: ['PERM_VIEW_GALLERY'] };
const mount = () => render(<Shell me={ME} onExpired={vi.fn()} onSignOut={vi.fn()} />);
const banner = () => screen.findByText('Version 2.0.0 is ready.');
const err = (kind: string, message = 'x') => Object.assign(new Error(message), { kind, message });

beforeEach(() => {
  vi.resetAllMocks();
  window.location.hash = '#/dashboard';
  mocks.setDirty.mockResolvedValue(undefined);
  mocks.request.mockResolvedValue({ status: 200, body: null });
  mocks.checkUpdate.mockResolvedValue({ status: 'none' });
});

describe('update banner', () => {
  it('stays away when there is nothing newer, and asks once on start', async () => {
    mount();
    await waitFor(() => expect(mocks.checkUpdate).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/is ready/)).toBeNull();
  });

  it('a failed look on start is silent', async () => {
    mocks.checkUpdate.mockRejectedValue(err('offline'));
    mount();
    await waitFor(() => expect(mocks.checkUpdate).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('names the version with Install and restart and Later, and axe finds nothing', async () => {
    mocks.checkUpdate.mockResolvedValue({ status: 'available', version: '2.0.0' });
    const { container } = mount();
    const text = await banner();
    const bar = text.closest('.banner') as HTMLElement;
    expect(within(bar).getByRole('button', { name: 'Install and restart' })).toBeTruthy();
    expect(within(bar).getByRole('button', { name: 'Later' })).toBeTruthy();
    const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });

  it('Later hides it until the next look finds it again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mocks.checkUpdate.mockResolvedValue({ status: 'available', version: '2.0.0' });
      mount();
      await banner();
      await userEvent.click(screen.getByRole('button', { name: 'Later' }));
      expect(screen.queryByText('Version 2.0.0 is ready.')).toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 + 1000); });
      expect(await banner()).toBeTruthy();
      expect(mocks.checkUpdate).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Install and restart asks the shell to install', async () => {
    mocks.checkUpdate.mockResolvedValue({ status: 'available', version: '2.0.0' });
    mocks.installUpdate.mockReturnValue(new Promise(() => {}));
    mount();
    await banner();
    await userEvent.click(screen.getByRole('button', { name: 'Install and restart' }));
    expect(mocks.installUpdate).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: 'Install and restart' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('unsent work shows the dialog and the banner stays', async () => {
    mocks.checkUpdate.mockResolvedValue({ status: 'available', version: '2.0.0' });
    mocks.installUpdate.mockRejectedValue(err('update_refused'));
    mount();
    await banner();
    await userEvent.click(screen.getByRole('button', { name: 'Install and restart' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText('You have unsent work. Finish or discard it first.')).toBeTruthy();
    await userEvent.click(within(dlg).getByRole('button', { name: 'OK' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Version 2.0.0 is ready.')).toBeTruthy();
  });

  it('an unverified package shows the fixed message and nothing else changes', async () => {
    mocks.checkUpdate.mockResolvedValue({ status: 'available', version: '2.0.0' });
    mocks.installUpdate.mockRejectedValue(err('update_unverified', 'https://secret.example/feed'));
    mount();
    await banner();
    await userEvent.click(screen.getByRole('button', { name: 'Install and restart' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe("The update couldn't be verified. Nothing was changed.");
    expect(alert.className).toContain('bad');
    expect(screen.getByRole('button', { name: 'Install and restart' })).toBeTruthy();
  });

  it('any other install failure is a toast, not a dialog', async () => {
    mocks.checkUpdate.mockResolvedValue({ status: 'available', version: '2.0.0' });
    mocks.installUpdate.mockRejectedValue(err('failed'));
    mount();
    await banner();
    await userEvent.click(screen.getByRole('button', { name: 'Install and restart' }));
    expect(await screen.findByText("Couldn't install the update. Try again later.")).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Check for updates button', () => {
  const open = async () => {
    window.location.hash = '#/settings/profile';
    mount();
    await userEvent.click(await screen.findByRole('tab', { name: 'Preferences' }));
    return screen.findByRole('button', { name: 'Check for updates' });
  };

  it('says so when the app is current', async () => {
    await userEvent.click(await open());
    expect(await screen.findByText("You're on the latest version.")).toBeTruthy();
  });

  it('says so when the look failed, because the User asked', async () => {
    const b = await open();
    mocks.checkUpdate.mockRejectedValue(err('offline'));
    await userEvent.click(b);
    expect(await screen.findByText("Couldn't check for updates. Try again later.")).toBeTruthy();
  });

  it('shows the banner when a version waits', async () => {
    const b = await open();
    mocks.checkUpdate.mockResolvedValue({ status: 'available', version: '2.0.0' });
    await userEvent.click(b);
    expect(await banner()).toBeTruthy();
  });
});
