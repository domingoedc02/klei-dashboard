import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from '../shell/Shell';
import type { Me } from '../shell/context';

const mocks = vi.hoisted(() => ({ request: vi.fn(), setDirty: vi.fn(), uploadFiles: vi.fn() }));
vi.mock('../bridge', async (orig) => ({ ...(await orig<typeof import('../bridge')>()), bridge: mocks }));

const VIEWER: Me = { id: 'v1', name: 'Vic Viewer', email: 'vic@example.test', role: 'Viewer', permissions: ['PERM_VIEW_GALLERY'] };
const ADMIN: Me = { id: 'a1', name: 'Ada Admin', email: 'ada@example.test', role: 'Admin', permissions: ['PERM_VIEW_GALLERY', 'PERM_MANAGE_STAFF'] };
const noisy = { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } };
const STUDIO = { name: 'Klei Bridal', address: '12 Rose Lane\nPortland' };
const sig = (over: Record<string, unknown> = {}) => ({
  enabled: true, signoff: 'Warm regards,', name: 'Vic Viewer', title: 'Consultant', phone: '+1 555 0100', studio: STUDIO,
  preview: 'unused', version: 1, ...over,
});
const workspace = (over: Record<string, unknown> = {}) => ({ studioName: 'Klei Bridal', studioAddress: '12 Rose Lane\nPortland', version: 2, ...over });

type Out = { status: number; body?: unknown };
let readSig: () => Out;
let putSig: () => Out;
let readWs: () => Out;
let putWs: () => Out;
const calls = (m: string, p: string) => mocks.request.mock.calls.filter((c) => c[0] === m && c[1] === p);

beforeEach(() => {
  vi.resetAllMocks();
  readSig = () => ({ status: 200, body: sig() });
  putSig = () => ({ status: 200, body: sig({ version: 2 }) });
  readWs = () => ({ status: 200, body: workspace() });
  putWs = () => ({ status: 200, body: workspace({ version: 3 }) });
  mocks.setDirty.mockResolvedValue(undefined);
  mocks.request.mockImplementation(async (m: string, p: string) => {
    if (p === '/api/v1/me/signature') return m === 'GET' ? readSig() : putSig();
    if (p === '/api/v1/admin/workspace') return m === 'GET' ? readWs() : putWs();
    if (p === '/api/v1/me/profile') return { status: 200, body: { name: 'x', email: 'x', avatar: null, version: 0 } };
    return { status: 200, body: null };
  });
});

const open = async (me: Me = VIEWER) => {
  window.location.hash = '#/settings/profile';
  const r = render(<Shell me={me} onExpired={vi.fn()} onSignOut={vi.fn()} />);
  await userEvent.setup().click(await screen.findByRole('tab', { name: 'Signature' }));
  await screen.findByLabelText('Sign-off');
  return r;
};
const preview = () => screen.getByRole('region', { name: 'Preview' });

describe('Signature tab', () => {
  it('opens for a Viewer with the saved lines, a live preview and no Studio block', async () => {
    await open();
    expect((screen.getByRole('switch', { name: 'Add my signature to replies' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Vic Viewer');
    expect(preview().textContent).toContain('Warm regards,');
    expect(preview().textContent).toContain('Klei Bridal · +1 555 0100');
    expect(preview().textContent).toContain('12 Rose Lane');
    expect(screen.queryByLabelText('Studio name')).toBeNull();
    expect(calls('GET', '/api/v1/admin/workspace')).toHaveLength(0);
    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('follows each keystroke in the preview and says so when the signature is off', async () => {
    const user = userEvent.setup();
    await open();
    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'Owner');
    expect(preview().textContent).toContain('Owner');
    expect(preview().textContent).not.toContain('Consultant');
    await user.click(screen.getByRole('switch', { name: 'Add my signature to replies' }));
    expect(preview().textContent).toContain('Signature is off. Replies will end without one.');
    expect(mocks.setDirty).toHaveBeenLastCalledWith(true);
  });

  it('saves with the version it read and shows the toast', async () => {
    const user = userEvent.setup();
    await open();
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), '  Mara  ');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls('PUT', '/api/v1/me/signature')).toHaveLength(1));
    const c = calls('PUT', '/api/v1/me/signature')[0];
    expect(c[2]).toEqual({ enabled: true, signoff: 'Warm regards,', name: 'Mara', title: 'Consultant', phone: '+1 555 0100' });
    expect(c[3]).toBe(1);
    expect(calls('PUT', '/api/v1/admin/workspace')).toHaveLength(0);
    expect(await screen.findByText('Changes saved')).toBeTruthy();
  });

  it('refuses a line over 80 characters before sending', async () => {
    const user = userEvent.setup();
    await open();
    await user.clear(screen.getByLabelText('Phone'));
    await user.type(screen.getByLabelText('Phone'), 'p'.repeat(81));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((await screen.findByText('Use 80 characters or fewer.'))).toBeTruthy();
    expect(screen.getByLabelText('Phone').getAttribute('aria-invalid')).toBe('true');
    expect(calls('PUT', '/api/v1/me/signature')).toHaveLength(0);
  });

  it('offers Reload when another window saved first, and keeps what was typed until then', async () => {
    const user = userEvent.setup();
    await open();
    putSig = () => ({ status: 409 });
    await user.type(screen.getByLabelText('Title'), '!');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((await screen.findByRole('alert')).textContent).toContain('changed in another window');
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Consultant!');
    readSig = () => ({ status: 200, body: sig({ title: 'Boss', version: 5 }) });
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Boss'));
  });

  it('names the field when the server refuses it', async () => {
    const user = userEvent.setup();
    await open();
    putSig = () => ({ status: 422, body: { fields: [{ field: 'name', code: 'invalid' }] } });
    await user.type(screen.getByLabelText('Name'), 'x');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Use one line only.')).toBeTruthy();
  });

  it('shows a Retry when the read fails', async () => {
    const user = userEvent.setup();
    readSig = () => ({ status: 500 });
    window.location.hash = '#/settings/profile';
    render(<Shell me={VIEWER} onExpired={vi.fn()} onSignOut={vi.fn()} />);
    await user.click(await screen.findByRole('tab', { name: 'Signature' }));
    const retry = await screen.findByRole('button', { name: /retry/i });
    readSig = () => ({ status: 200, body: sig() });
    await user.click(retry);
    expect(await screen.findByLabelText('Sign-off')).toBeTruthy();
  });

  it('gives an Admin the Studio block under the signature and saves both with their own versions', async () => {
    const user = userEvent.setup();
    await open(ADMIN);
    expect((screen.getByLabelText('Studio name') as HTMLInputElement).value).toBe('Klei Bridal');
    expect((screen.getByLabelText('Studio address') as HTMLTextAreaElement).value).toBe('12 Rose Lane\nPortland');
    await user.clear(screen.getByLabelText('Studio name'));
    await user.type(screen.getByLabelText('Studio name'), 'Klei Atelier');
    expect(preview().textContent).toContain('Klei Atelier · +1 555 0100');
    await user.type(screen.getByLabelText('Name'), '!');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls('PUT', '/api/v1/admin/workspace')).toHaveLength(1));
    expect(calls('PUT', '/api/v1/me/signature')[0][3]).toBe(1);
    const w = calls('PUT', '/api/v1/admin/workspace')[0];
    expect(w[2]).toEqual({ studioName: 'Klei Atelier', studioAddress: '12 Rose Lane\nPortland' });
    expect(w[3]).toBe(2);
  });

  it('refuses a fifth address line before sending', async () => {
    const user = userEvent.setup();
    await open(ADMIN);
    await user.clear(screen.getByLabelText('Studio address'));
    await user.type(screen.getByLabelText('Studio address'), '1{Enter}2{Enter}3{Enter}4{Enter}5');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Use up to 4 lines.')).toBeTruthy();
    expect(calls('PUT', '/api/v1/admin/workspace')).toHaveLength(0);
  });

  it('has no accessibility violations for a Viewer or an Admin', async () => {
    const a = await open();
    expect((await axe.run(a.container, noisy)).violations).toEqual([]);
    a.unmount();
    const b = await open(ADMIN);
    expect((await axe.run(b.container, noisy)).violations).toEqual([]);
  });
});
