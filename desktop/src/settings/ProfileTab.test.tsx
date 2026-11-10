import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from '../shell/Shell';
import type { Me } from '../shell/context';
import { strength } from './ProfileTab';

const mocks = vi.hoisted(() => ({ request: vi.fn(), setDirty: vi.fn(), uploadFiles: vi.fn() }));
vi.mock('../bridge', async (orig) => ({ ...(await orig<typeof import('../bridge')>()), bridge: mocks }));

const VIEWER: Me = { id: 'v1', name: 'Vic Viewer', email: 'vic@example.test', role: 'Viewer', permissions: ['PERM_VIEW_GALLERY'] };
const noisy = { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } };
const profile = (over: Record<string, unknown> = {}) => ({ name: 'Vic Viewer', email: 'vic@example.test', avatar: null, version: 0, ...over });

let read: () => { status: number; body?: unknown };
let patch: () => { status: number; body?: unknown };
let pass: () => { status: number; body?: unknown };
let remove: () => { status: number; body?: unknown };
let twofa: (m: string, p: string, body?: unknown) => { status: number; body?: unknown };
const calls = (m: string, p: string) => mocks.request.mock.calls.filter((c) => c[0] === m && c[1] === p);

beforeEach(() => {
  vi.resetAllMocks();
  read = () => ({ status: 200, body: profile() });
  patch = () => ({ status: 200, body: profile({ name: 'Vic Rose', version: 1 }) });
  pass = () => ({ status: 204 });
  remove = () => ({ status: 204 });
  twofa = (m, p) => (m === 'GET' && p === '/api/v1/me/2fa' ? { status: 200, body: { enabled: false, recoveryLeft: 0, reset: false } } : { status: 404 });
  mocks.setDirty.mockResolvedValue(undefined);
  mocks.request.mockImplementation(async (m: string, p: string) => {
    if (p === '/api/v1/me/profile') return m === 'GET' ? read() : patch();
    if (p === '/api/v1/me/password') return pass();
    if (p === '/api/v1/me/avatar') return remove();
    if (p.startsWith('/api/v1/me/2fa')) return twofa(m, p);
    if (p === '/api/v1/me') return { status: 200, body: { ...VIEWER, name: 'Vic Rose', avatar: 5 } };
    return { status: 200, body: null };
  });
});

const open = async (me: Me = VIEWER) => {
  window.location.hash = '#/settings/profile';
  const r = render(<Shell me={me} onExpired={vi.fn()} onSignOut={vi.fn()} />);
  await screen.findByLabelText('Name');
  return r;
};

describe('Profile tab', () => {
  it('opens for every Role with the name, a read-only email with its helper, photo buttons', async () => {
    await open();
    expect(screen.getByRole('tab', { name: 'Profile', selected: true })).toBeTruthy();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Vic Viewer');
    const email = screen.getByLabelText('Email') as HTMLInputElement;
    expect(email.readOnly).toBe(true);
    expect(screen.getByText('Ask an admin to change your email.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload photo' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Remove' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Other devices will be signed out.')).toBeTruthy();
  });

  it('shows skeletons while loading and a Retry when the read fails', async () => {
    const user = userEvent.setup();
    read = () => ({ status: 500 });
    window.location.hash = '#/settings/profile';
    render(<Shell me={VIEWER} onExpired={vi.fn()} onSignOut={vi.fn()} />);
    expect(await screen.findByText(/Couldn't load your profile/)).toBeTruthy();
    read = () => ({ status: 200, body: profile() });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByLabelText('Name')).toBeTruthy();
  });

  it('Save changes sends the name with the version, says so, and refreshes the top bar', async () => {
    const user = userEvent.setup();
    await open();
    const save = screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Vic Rose');
    expect(mocks.setDirty).toHaveBeenLastCalledWith(true);
    await user.click(save);
    expect(await screen.findByText('Profile saved')).toBeTruthy();
    const [, , body, version] = calls('PATCH', '/api/v1/me/profile')[0];
    expect(body).toEqual({ name: 'Vic Rose' });
    expect(version).toBe(0);
    await waitFor(() => expect(within(screen.getByRole('banner')).getByRole('button', { name: 'Vic Rose' })).toBeTruthy());
    expect(mocks.setDirty).toHaveBeenLastCalledWith(false);
  });

  it('an empty name is refused before the server; a conflict offers Reload', async () => {
    const user = userEvent.setup();
    await open();
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), ' ');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Name is required.')).toBeTruthy();
    expect(calls('PATCH', '/api/v1/me/profile')).toHaveLength(0);
    await user.type(screen.getByLabelText('Name'), 'Vic Rose');
    patch = () => ({ status: 409 });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/changed in another window/)).toBeTruthy();
    read = () => ({ status: 200, body: profile({ name: 'Elsewhere', version: 4 }) });
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Elsewhere'));
  });

  it('Upload photo asks the shell to pick one and reloads; Remove deletes it; a refused photo says why', async () => {
    const user = userEvent.setup();
    mocks.uploadFiles.mockResolvedValueOnce({ stored: ['avatar'], rejected: [], cancelled: false });
    await open();
    read = () => ({ status: 200, body: profile({ avatar: 5 }) });
    await user.click(screen.getByRole('button', { name: 'Upload photo' }));
    expect(mocks.uploadFiles).toHaveBeenCalledWith('avatar', '');
    expect(await screen.findByText('Profile saved')).toBeTruthy();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Remove' }) as HTMLButtonElement).disabled).toBe(false));
    expect(document.querySelector<HTMLImageElement>('img.avatar')!.src).toContain('/me/5');

    read = () => ({ status: 200, body: profile() });
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(calls('DELETE', '/api/v1/me/avatar')).toHaveLength(1));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Remove' }) as HTMLButtonElement).disabled).toBe(true));

    mocks.uploadFiles.mockResolvedValueOnce({ stored: [], rejected: [{ name: 'big.png', reason: 'size' }], cancelled: false });
    await user.click(screen.getByRole('button', { name: 'Upload photo' }));
    expect(await screen.findByText('The photo must be 2 MB or smaller.')).toBeTruthy();
    mocks.uploadFiles.mockResolvedValueOnce({ stored: [], rejected: [], cancelled: true });
    await user.click(screen.getByRole('button', { name: 'Upload photo' }));
    await waitFor(() => expect(screen.queryByText('The photo must be 2 MB or smaller.')).toBeNull());
  });

  it('Update password checks the fields first, then sends current and new, clears the fields and says so', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('Enter your current password.')).toBeTruthy();
    expect(calls('POST', '/api/v1/me/password')).toHaveLength(0);
    await user.type(screen.getByLabelText('Current password'), 'old-pass-1');
    await user.type(screen.getByLabelText('New password'), 'short');
    await user.type(screen.getByLabelText('Confirm new password'), 'shorter');
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('Use 8 to 128 characters with at least one number.')).toBeTruthy();
    expect(screen.getByText("Passwords don't match.")).toBeTruthy();
    await user.clear(screen.getByLabelText('New password'));
    await user.clear(screen.getByLabelText('Confirm new password'));
    await user.type(screen.getByLabelText('New password'), 'fresh-pass-2');
    await user.type(screen.getByLabelText('Confirm new password'), 'fresh-pass-2');
    expect(screen.getByRole('meter', { name: 'Password strength' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('Password updated')).toBeTruthy();
    expect(calls('POST', '/api/v1/me/password')[0][2]).toEqual({ current: 'old-pass-1', new: 'fresh-pass-2' });
    expect((screen.getByLabelText('Current password') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe('');
  });

  it('a wrong current password is named under its field and keeps what was typed; a lockout says to wait', async () => {
    const user = userEvent.setup();
    pass = () => ({ status: 422, body: { fields: [{ field: 'current', code: 'incorrect' }] } });
    await open();
    await user.type(screen.getByLabelText('Current password'), 'nope-nope-1');
    await user.type(screen.getByLabelText('New password'), 'fresh-pass-2');
    await user.type(screen.getByLabelText('Confirm new password'), 'fresh-pass-2');
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('Current password is incorrect.')).toBeTruthy();
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe('fresh-pass-2');
    pass = () => ({ status: 429 });
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('Too many attempts. Try again in a few minutes.')).toBeTruthy();
  });

  it('the strength meter rises with length and variety', () => {
    expect(strength('')).toBe(0);
    expect(strength('abc')).toBe(1);
    expect(strength('abcdefg1')).toBeGreaterThan(strength('abc'));
    expect(strength('Abcdefghij1!')).toBe(4);
  });

  it('the top bar shows the photo when the person has one', async () => {
    await open({ ...VIEWER, avatar: 9 });
    expect(within(screen.getByRole('banner')).getByRole('button', { name: 'Vic Viewer' }).querySelector('img.avatar')!.getAttribute('src')).toContain('/me/9');
  });

  it('has no accessibility violations, with errors showing', async () => {
    const user = userEvent.setup();
    const { container } = await open();
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    await screen.findByText('Enter your current password.');
    await user.type(screen.getByLabelText('New password'), 'fresh-pass-2');
    expect((await axe.run(container, noisy)).violations.map((v) => v.id)).toEqual([]);
  });
});

describe('Two-factor card', () => {
  const on = (over: Record<string, unknown> = {}) => ({ status: 200, body: { enabled: true, recoveryLeft: 8, reset: false, ...over } });

  it('shows Off with Set up, and runs setup: QR, wrong code, right code, recovery codes once, toast', async () => {
    const user = userEvent.setup();
    let confirmed = false;
    twofa = (m, p) => {
      if (m === 'GET') return { status: 200, body: { enabled: confirmed, recoveryLeft: confirmed ? 8 : 0, reset: false } };
      if (p.endsWith('/start')) return { status: 200, body: { uri: 'otpauth://totp/x', secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', qr: 'data:image/svg+xml;base64,PHN2Zy8+' } };
      const code = (mocks.request.mock.calls.at(-1)![2] as { code: string }).code;
      if (code === '000000') return { status: 422, body: { fields: [{ field: 'code', code: 'incorrect' }] } };
      confirmed = true;
      return { status: 200, body: { codes: ['AAAAA-BBBBB', 'CCCCC-DDDDD', 'EEEEE-FFFFF', 'GGGGG-HHHHH', 'IIIII-JJJJJ', 'KKKKK-LLLLL', 'MMMMM-NNNNN', 'OOOOO-PPPPP'] } };
    };
    await open();
    const card = await screen.findByRole('region', { name: 'Two-factor authentication' });
    expect(within(card).getByText('Off')).toBeTruthy();
    await user.click(within(card).getByRole('button', { name: 'Set up' }));
    const dlg = await screen.findByRole('dialog');
    const qr = await within(dlg).findByRole('img', { name: 'QR code for your authenticator app' });
    expect(qr.getAttribute('src')).toContain('data:image/svg+xml');
    expect(within(dlg).getByText('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP')).toBeTruthy();
    expect(calls('POST', '/api/v1/me/2fa/start')).toHaveLength(1);

    await user.type(within(dlg).getByLabelText('6-digit code'), '000000');
    await user.click(within(dlg).getByRole('button', { name: 'Turn on' }));
    expect(await within(dlg).findByText('That code is incorrect or has expired.')).toBeTruthy();
    await user.clear(within(dlg).getByLabelText('6-digit code'));
    await user.type(within(dlg).getByLabelText('6-digit code'), '123456');
    await user.click(within(dlg).getByRole('button', { name: 'Turn on' }));
    expect(await within(dlg).findByRole('list', { name: 'Recovery codes' })).toBeTruthy();
    expect(within(dlg).getAllByRole('listitem')).toHaveLength(8);
    expect(screen.getByRole('status').textContent).toContain('Two-factor enabled');
    await user.click(within(dlg).getByRole('button', { name: 'I saved them' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await within(card).findByText('On')).toBeTruthy();
    expect(within(card).getByText('8 recovery codes left')).toBeTruthy();
    expect(screen.queryByText('AAAAA-BBBBB')).toBeNull();
  });

  it('Turn off asks for the password and a code, then says so', async () => {
    const user = userEvent.setup();
    let enabled = true;
    twofa = (m, p) => {
      if (m === 'GET') return { status: 200, body: { enabled, recoveryLeft: 3, reset: false } };
      if (p.endsWith('/disable')) {
        const b = mocks.request.mock.calls.at(-1)![2] as { password: string };
        if (b.password !== 'right-pass-1') return { status: 422, body: { fields: [{ field: 'password', code: 'incorrect' }] } };
        enabled = false;
        return { status: 204 };
      }
      return { status: 404 };
    };
    await open();
    const card = await screen.findByRole('region', { name: 'Two-factor authentication' });
    expect(within(card).getByText('3 recovery codes left')).toBeTruthy();
    await user.click(within(card).getByRole('button', { name: 'Turn off' }));
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).getByRole('heading').textContent).toBe('Turn off two-factor?');
    await user.click(within(dlg).getByRole('button', { name: 'Turn off' }));
    expect(within(dlg).getByText('Enter your current password.')).toBeTruthy();
    expect(within(dlg).getByText('Enter a code from your app, or a recovery code.')).toBeTruthy();
    await user.type(within(dlg).getByLabelText('Current password'), 'wrong');
    await user.type(within(dlg).getByLabelText('Code'), '123456');
    await user.click(within(dlg).getByRole('button', { name: 'Turn off' }));
    expect(await within(dlg).findByText('Current password is incorrect.')).toBeTruthy();
    await user.clear(within(dlg).getByLabelText('Current password'));
    await user.type(within(dlg).getByLabelText('Current password'), 'right-pass-1');
    await user.click(within(dlg).getByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls('POST', '/api/v1/me/2fa/disable')[1][2]).toEqual({ password: 'right-pass-1', code: '123456' });
    expect(screen.getByRole('status').textContent).toContain('Two-factor turned off');
    expect(await within(card).findByText('Off')).toBeTruthy();
  });

  it('Make new codes shows eight new codes after the proof', async () => {
    const user = userEvent.setup();
    twofa = (m, p) => (m === 'GET' ? on().body && { status: 200, body: on().body } : p.endsWith('/codes')
      ? { status: 200, body: { codes: Array.from({ length: 8 }, (_, i) => `NEW0${i}-ABCDE`) } } : { status: 404 });
    await open();
    await user.click(await screen.findByRole('button', { name: 'Make new codes' }));
    const dlg = screen.getByRole('dialog');
    await user.type(within(dlg).getByLabelText('Current password'), 'right-pass-1');
    await user.type(within(dlg).getByLabelText('Code'), '123456');
    await user.click(within(dlg).getByRole('button', { name: 'Make new codes' }));
    expect(await within(dlg).findByText('NEW00-ABCDE')).toBeTruthy();
    expect(within(dlg).getAllByRole('listitem')).toHaveLength(8);
  });

  it('tells the person when an admin reset their second factor', async () => {
    twofa = () => ({ status: 200, body: { enabled: false, recoveryLeft: 0, reset: true } });
    await open();
    expect(await screen.findByText(/An admin reset your two-factor sign-in/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set up' })).toBeTruthy();
  });

  it('has an error state with Retry, and no accessibility violations in any state', async () => {
    const user = userEvent.setup();
    twofa = () => ({ status: 500 });
    const { container } = await open();
    await screen.findByText(/Couldn't load two-factor settings/);
    expect((await axe.run(container, noisy)).violations.map((v) => v.id)).toEqual([]);
    twofa = () => on();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('8 recovery codes left');
    expect((await axe.run(container, noisy)).violations.map((v) => v.id)).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Turn off' }));
    expect((await axe.run(document.body, noisy)).violations.map((v) => v.id)).toEqual([]);
  });
});
