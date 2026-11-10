import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { keychainLabel } from './platform';

const mocks = vi.hoisted(() => ({ request: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), sessionOnly: vi.fn(), setDirty: vi.fn() }));
vi.mock('./bridge', async (orig) => ({ ...(await orig<typeof import('./bridge')>()), bridge: (await import('./shell/quietBell')).quietBell(mocks) }));

const ME = { id: 'b5c1c8f0-0000-4000-8000-000000000001', name: 'Ada Admin', email: 'ada@example.test', role: 'Admin', permissions: ['PERM_VIEW_GALLERY'] };
const err = (kind: string) => ({ kind, message: kind });

async function noViolations(container: HTMLElement) {
  // jsdom has no layout, so contrast is checked by infra/ci/axe.mjs in a real browser instead.
  const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.signOut.mockResolvedValue(undefined);
  mocks.sessionOnly.mockResolvedValue(undefined);
  mocks.setDirty.mockResolvedValue(undefined);
});

describe('signed out', () => {
  beforeEach(() => {
    mocks.request.mockRejectedValue(err('signed_out'));
  });

  it('shows the card with the K mark, the welcome and one Sign in action', async () => {
    const { container } = render(<App />);
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeTruthy();
    expect(screen.getByText('Sign in to manage gowns and inquiries.')).toBeTruthy();
    expect(container.querySelector('.auth-card')).toBeTruthy();
    expect(container.querySelector('.auth-brand .brand-mark')?.textContent).toBe('K');
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Sign in']);
    await noViolations(container);
  });

  it('waits for the browser, then shows the signed-in view from GET /me', async () => {
    let finish!: () => void;
    mocks.signIn.mockReturnValue(new Promise<void>((r) => (finish = r)));
    const { container } = render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Finish signing in in your browser')).toBeTruthy();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Open browser again', 'Cancel']);
    await noViolations(container);

    mocks.request.mockResolvedValue({ status: 200, body: ME });
    finish();
    expect(await screen.findByText('Ada Admin')).toBeTruthy();
    expect(mocks.request).toHaveBeenLastCalledWith('GET', '/api/v1/me');
    await noViolations(container);
  });

  it('Open browser again restarts sign-in and the stale wait cannot overwrite it', async () => {
    const calls: Array<(e?: unknown) => void> = [];
    mocks.signIn.mockImplementation(() => new Promise((_, rej) => calls.push(rej)));
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Open browser again' }));
    expect(mocks.signIn).toHaveBeenCalledTimes(2);
    calls[0](err('cancelled'));
    await Promise.resolve();
    expect(screen.getByText('Finish signing in in your browser')).toBeTruthy();
  });

  it('Cancel returns to the signed-out screen', async () => {
    mocks.signIn.mockReturnValue(new Promise(() => {}));
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Sign in to manage gowns and inquiries.')).toBeTruthy();
    expect(mocks.signOut).toHaveBeenCalled();
  });

  it.each(['failed', 'timeout'])('%s shows the retry screen', async (kind) => {
    mocks.signIn.mockRejectedValue(err(kind));
    const { container } = render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toBe("Sign-in didn't finish. Try again.");
    await noViolations(container);
    mocks.signIn.mockReturnValue(new Promise(() => {}));
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Finish signing in in your browser')).toBeTruthy();
  });
});

describe('keychain unavailable', () => {
  it('Continue without saving switches to a memory session, then signs in', async () => {
    mocks.request.mockRejectedValueOnce(err('keychain_unavailable'));
    mocks.signIn.mockReturnValue(new Promise(() => {}));
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Continue without saving' }));
    expect(mocks.sessionOnly).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Finish signing in in your browser')).toBeTruthy();
    expect(mocks.signIn).toHaveBeenCalledTimes(1);
  });

  it('fails closed with Try again, and names the OS store only in the hint', async () => {
    mocks.request.mockRejectedValueOnce(err('keychain_unavailable'));
    const { container } = render(<App />);
    expect((await screen.findByRole('alert')).textContent).toBe(
      "Can't reach your system keychain. Klei Bridal needs it to keep you signed in.",
    );
    expect(screen.getByText(`Check that ${keychainLabel()} is unlocked.`)).toBeTruthy();
    await noViolations(container);

    mocks.request.mockResolvedValue({ status: 200, body: ME });
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Ada Admin')).toBeTruthy();
  });

  it('labels the credential store per OS', () => {
    expect(keychainLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('Keychain');
    expect(keychainLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Credential Manager');
    expect(keychainLabel('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Secret Service');
  });
});

describe('signed in', () => {
  beforeEach(() => {
    mocks.request.mockResolvedValue({ status: 200, body: ME });
  });

  it('Sign out calls the shell and shows the signed-out screen', async () => {
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Ada Admin' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(await screen.findByText('Sign in to manage gowns and inquiries.')).toBeTruthy();
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it('session expiry shows one Sign in action in an accessible dialog', async () => {
    mocks.request.mockReset();
    mocks.request.mockRejectedValue(err('session_expired'));
    const { container } = render(<App />);
    const dialog = await screen.findByRole('alertdialog', { name: 'Session expired' });
    expect(dialog.textContent).toContain("You've been signed out. Sign in to continue.");
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Sign in']);
    await noViolations(container);
  });

  it('a Role with no Permission shows the no-access screen with one Sign in again action', async () => {
    mocks.request.mockResolvedValue({ status: 200, body: { ...ME, permissions: ['PERM_MANAGE_STAFF'] } });
    const { container } = render(<App />);
    await screen.findByRole('button', { name: 'Ada Admin' });
    mocks.request.mockReset();
    mocks.request.mockRejectedValue(err('no_access'));
    await userEvent.click(screen.getByRole('link', { name: 'Settings' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Your account has no access yet. Ask an admin.');
    expect(screen.getByRole('heading', { name: 'Klei Bridal' })).toBeTruthy();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Sign in again']);
    await noViolations(container);
  });

  it('an unreachable server offers Try again', async () => {
    mocks.request.mockReset();
    mocks.request.mockRejectedValue(err('offline'));
    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy());
  });
});
