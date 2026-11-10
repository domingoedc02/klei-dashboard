import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setFormatPrefs, type Prefs } from '../format';
import { Shell } from '../shell/Shell';
import type { Me } from '../shell/context';
import { startRoute } from '../shell/permissions';

const mocks = vi.hoisted(() => ({ request: vi.fn(), setDirty: vi.fn(), uploadFiles: vi.fn() }));
vi.mock('../bridge', async (orig) => ({ ...(await orig<typeof import('../bridge')>()), bridge: mocks }));

const noisy = { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } };
const PREFS: Prefs = { timezone: null, dateFormat: 'MM/DD/YYYY', startPage: 'dashboard', enterToSend: false, newInquiry: true, aiFinished: true, teamActivity: true, emailNewInquiry: false, emailAiFinished: false, emailTeamActivity: false, digest: 'never', version: 0 };
const VIEWER: Me = { id: 'v1', name: 'Vic Viewer', email: 'vic@example.test', role: 'Viewer', permissions: ['PERM_VIEW_GALLERY'], preferences: PREFS };
const STAFF: Me = { ...VIEWER, id: 's1', role: 'Staff', permissions: ['PERM_VIEW_GALLERY', 'PERM_UPLOAD_IMAGES', 'PERM_REPLY'] };

type Out = { status: number; body?: unknown };
let put: (body: Record<string, unknown>) => Out;
const puts = () => mocks.request.mock.calls.filter((c) => c[0] === 'PUT' && c[1] === '/api/v1/me/preferences');

beforeEach(() => {
  vi.resetAllMocks();
  setFormatPrefs(null);
  mocks.setDirty.mockResolvedValue(undefined);
  put = (b) => ({ status: 200, body: { ...b, version: 1 } });
  mocks.request.mockImplementation(async (m: string, p: string, body: Record<string, unknown>) => {
    if (m === 'PUT' && p === '/api/v1/me/preferences') return put(body);
    return { status: 200, body: null };
  });
});

const open = async (tab: string, me: Me = STAFF) => {
  window.location.hash = '#/settings/profile';
  const r = render(<Shell me={me} onExpired={vi.fn()} onSignOut={vi.fn()} />);
  await userEvent.setup().click(await screen.findByRole('tab', { name: tab }));
  return r;
};

describe('Preferences tab', () => {
  it('shows the defaults, a disabled language, and only the start pages the User can open', async () => {
    await open('Preferences', VIEWER);
    expect((await screen.findByLabelText('Date format') as HTMLSelectElement).value).toBe('MM/DD/YYYY');
    expect((screen.getByLabelText('Language') as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByText('More languages are not available yet.')).toBeTruthy();
    expect(Array.from((screen.getByLabelText('Start page') as HTMLSelectElement).options).map((o) => o.text)).toEqual(['Dashboard', 'Gallery']);
    expect((screen.getByRole('switch', { name: 'Press Enter to send' }) as HTMLInputElement).checked).toBe(false);
  });

  it('saves a change at once with the version it read, and takes the answer', async () => {
    await open('Preferences');
    await userEvent.setup().selectOptions(await screen.findByLabelText('Date format'), 'YYYY-MM-DD');
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0][2]).toMatchObject({ dateFormat: 'YYYY-MM-DD', startPage: 'dashboard', timezone: null });
    expect(puts()[0][2]).not.toHaveProperty('version');
    expect(puts()[0][3]).toBe(0);
    expect(await screen.findByText('Preference saved')).toBeTruthy();
    expect((screen.getByLabelText('Date format') as HTMLSelectElement).value).toBe('YYYY-MM-DD');
  });

  it('keeps the old value and says so when the save fails', async () => {
    put = () => ({ status: 500 });
    await open('Preferences');
    await userEvent.setup().click(await screen.findByRole('switch', { name: 'Press Enter to send' }));
    expect(await screen.findByText("Couldn't save. Try again.")).toBeTruthy();
    expect((screen.getByRole('switch', { name: 'Press Enter to send' }) as HTMLInputElement).checked).toBe(false);
  });

  it('asks for a reload when another window saved first', async () => {
    put = () => ({ status: 409 });
    await open('Preferences');
    await userEvent.setup().selectOptions(await screen.findByLabelText('Start page'), 'gallery');
    expect(await screen.findByText(/changed in another window/)).toBeTruthy();
  });

  it('has no axe violations', async () => {
    const { container } = await open('Preferences');
    await screen.findByLabelText('Timezone');
    expect((await axe.run(container, noisy)).violations).toEqual([]);
  });
});

describe('Notifications tab', () => {
  it('lists the events with their help text, Email and In-app columns, hiding New inquiry from a User who cannot reply', async () => {
    await open('Notifications');
    const table = await screen.findByRole('table', { name: 'Notification events' });
    expect([...table.querySelectorAll('th[scope="col"]')].map((h) => h.textContent)).toEqual(['Event', 'Email', 'In-app']);
    expect([...table.querySelectorAll('th[scope="row"]')].map((h) => h.textContent)).toEqual([
      'New inquiryWhen a client submits the website form', 'AI finishedWhen a batch is ready to review', 'Team activityInvites accepted and role changes',
    ]);
    expect(screen.getAllByRole('switch').map((s) => s.getAttribute('aria-label'))).toEqual([
      'New inquiry by email', 'New inquiry in-app', 'AI finished by email', 'AI finished in-app', 'Team activity by email', 'Team activity in-app',
    ]);
    cleanup();
    await open('Notifications', VIEWER);
    expect(await screen.findByRole('switch', { name: 'AI finished in-app' })).toBeTruthy();
    expect(screen.queryByRole('switch', { name: /New inquiry/ })).toBeNull();
  });

  it('sends the whole set for an in-app switch (the old toggle, new name) and for an email switch, each with "Preference saved"', async () => {
    await open('Notifications');
    await userEvent.setup().click(await screen.findByRole('switch', { name: 'New inquiry in-app' }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0][2]).toMatchObject({ newInquiry: false, aiFinished: true, teamActivity: true, emailNewInquiry: false, digest: 'never' });
    expect(await screen.findByText('Preference saved')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('switch', { name: 'Team activity by email' }));
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts()[1][2]).toMatchObject({ emailTeamActivity: true, digest: 'never' });
    expect(puts()[1][3]).toBe(1);
  });

  it('sets the digest and says so; the select shows Never by default', async () => {
    await open('Notifications');
    const select = (await screen.findByLabelText('Email digest', { selector: 'select' })) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['Real-time', 'Hourly', 'Daily', 'Weekly', 'Never']);
    expect(select.value).toBe('never');
    await userEvent.setup().selectOptions(select, 'Daily');
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0][2]).toMatchObject({ digest: 'daily' });
    expect(await screen.findByText('Digest set to Daily')).toBeTruthy();
  });

  it('keeps the controls as they were when the save fails', async () => {
    put = () => ({ status: 500 });
    await open('Notifications');
    await userEvent.setup().click(await screen.findByRole('switch', { name: 'AI finished by email' }));
    expect(await screen.findByText("Couldn't save. Try again.")).toBeTruthy();
    expect((screen.getByRole('switch', { name: 'AI finished by email' }) as HTMLInputElement).checked).toBe(false);
  });

  it('has no axe violations', async () => {
    const { container } = await open('Notifications');
    await screen.findByRole('switch', { name: 'AI finished by email' });
    expect((await axe.run(container, noisy)).violations).toEqual([]);
  });
});

describe('start page', () => {
  it('opens the chosen page after sign-in when the hash is empty', async () => {
    window.location.hash = '';
    render(<Shell me={{ ...STAFF, preferences: { ...PREFS, startPage: 'gallery' } }} onExpired={vi.fn()} onSignOut={vi.fn()} />);
    await waitFor(() => expect(window.location.hash).toBe('#/gallery'));
  });

  it('leaves a hash the User already has alone', async () => {
    window.location.hash = '#/settings';
    render(<Shell me={{ ...STAFF, preferences: { ...PREFS, startPage: 'gallery' } }} onExpired={vi.fn()} onSignOut={vi.fn()} />);
    await screen.findByRole('tablist', { name: 'Settings sections' });
    expect(window.location.hash).toBe('#/settings');
  });

  it('falls back to the Dashboard when the User lost the Permission', () => {
    expect(startRoute('inquiries', ['PERM_VIEW_GALLERY'])).toBe('dashboard');
    expect(startRoute('inquiries', ['PERM_REPLY'])).toBe('inquiries');
    expect(startRoute('nonsense', ['PERM_REPLY'])).toBe('dashboard');
    expect(startRoute(undefined, [])).toBe('dashboard');
  });
});
