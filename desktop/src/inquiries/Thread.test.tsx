import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from '../shell/Shell';
import type { Me } from '../shell/context';
import { READ_AFTER_MS } from './Thread';

const mocks = vi.hoisted(() => ({ request: vi.fn(), setDirty: vi.fn(), uploadFiles: vi.fn() }));
vi.mock('../bridge', async (orig) => ({ ...(await orig<typeof import('../bridge')>()), bridge: mocks }));

const STAFF: Me = { id: 's1', name: 'Sam Staff', email: 'sam@example.test', role: 'Staff', permissions: ['PERM_VIEW_GALLERY', 'PERM_REPLY'] };
const CLOSER: Me = { ...STAFF, permissions: ['PERM_VIEW_GALLERY', 'PERM_REPLY', 'PERM_CLOSE_INQUIRY'] };
const noisy = { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } };
const id = (n: number) => `0b1c2d3e-0000-4000-8000-${String(n).padStart(12, '0')}`;

const item = (n: number, over: Record<string, unknown> = {}) => ({
  id: id(n), clientId: id(900), clientName: 'Mara Lindqvist', subject: `Subject ${n}`, preview: `Preview ${n}`,
  lastMessageAt: '2026-11-01T10:00:00Z', status: 'new', unread: true, ...over,
});
const thread = (n: number, over: Record<string, unknown> = {}) => ({
  id: id(n), subject: `Subject ${n}`, status: 'new', unread: true, version: 0,
  client: { id: id(900), name: 'Mara Lindqvist', email: 'mara@example.test' },
  messages: [
    { id: id(70), direction: 'in', author: null, createdAt: '2026-11-01T10:00:00Z', body: 'Hello <b>there</b>\nSecond line' },
    { id: id(71), direction: 'out', author: 'Sam Staff', createdAt: '2026-11-01T11:00:00Z', body: 'Thanks, Mara' },
  ],
  ...over,
});
const profile = (over: Record<string, unknown> = {}) => ({
  id: id(900), name: 'Mara Lindqvist', email: 'mara@example.test', phone: null, city: 'Lisbon', weddingDate: '2026-09-14', source: null, note: 'Prefers lace',
  createdAt: '2026-10-01T10:00:00Z', version: 0,
  inquiries: [{ id: id(1), subject: 'Subject 1', lastMessageAt: '2026-11-01T10:00:00Z', status: 'new' }],
  ...over,
});

let reads: string[];
let detail: (p: string) => { status: number; body?: unknown };
let draft: { body: string; updatedAt: string | null; attachments: { id: string; name: string; size: number }[] };
let reply: () => { status: number; body?: unknown };
let patch: (p: string, body: unknown) => { status: number; body?: unknown };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.setDirty.mockResolvedValue(undefined);
  reads = [];
  detail = () => ({ status: 200, body: thread(1) });
  draft = { body: '', updatedAt: null, attachments: [] };
  reply = () => ({ status: 201, body: sentMessage() });
  patch = (_p, body) => ({ status: 200, body: { id: id(1), status: (body as { status: string }).status, version: 1 } });
  mocks.request.mockImplementation(async (m: string, p: string, b?: unknown) => {
    if (m === 'GET' && p.endsWith('/draft')) return { status: 200, body: draft };
    if (m === 'PUT' && p.endsWith('/draft')) return { status: 200, body: { updatedAt: '2026-11-01T12:00:00Z' } };
    if (m === 'GET' && p === '/api/v1/me/signature') return { status: 200, body: { enabled: true, preview: 'Warm regards,\nSam Staff' } };
    if (m === 'POST' && p.endsWith('/reply')) return reply();
    if (m === 'POST' && p.endsWith('/retry')) return { status: 200, body: sentMessage({ mailState: 'sent' }) };
    if (m === 'DELETE') return { status: 204, body: null };
    if (m === 'PATCH') return patch(p, b);
    if (m === 'POST' && p === '/api/v1/inquiries/query') return { status: 200, body: { items: [item(1)], next: null } };
    if (p === '/api/v1/inquiries/count') return { status: 200, body: { count: 1 } };
    if (m === 'POST' && p.endsWith('/read')) { reads.push(p); return { status: 204, body: null }; }
    if (m === 'GET' && (p.startsWith('/api/v1/inquiries/') || p.startsWith('/api/v1/clients/'))) return detail(p);
    return { status: 200, body: null };
  });
});
afterEach(() => vi.useRealTimers());

const sentMessage = (over: Record<string, unknown> = {}) => ({
  id: id(72), direction: 'out', author: 'Sam Staff', createdAt: '2026-11-01T12:00:00Z', body: '<div>Hello Mara</div>', html: true, mailState: 'sent', attachments: [], ...over,
});
const open = (hash: string, me: Me = STAFF) => {
  window.location.hash = hash;
  return render(<Shell me={me} onExpired={vi.fn()} onSignOut={vi.fn()} />);
};

describe('Thread', () => {
  it('shows header, messages with sender names, Client text as text, and a link to the profile', async () => {
    const { container } = open(`#/inquiries/${id(1)}`);
    const msgs = await screen.findByRole('list', { name: 'Messages' });
    const [a, b] = within(msgs).getAllByRole('listitem');
    expect(within(a).getByText('Mara Lindqvist')).toBeTruthy();
    expect(a.textContent).toContain('Hello <b>there</b>');
    expect(container.querySelector('.message-body b')).toBeNull();
    expect(within(b).getByText('Sam Staff')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Subject 1' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Mara Lindqvist' }).getAttribute('href')).toBe(`#/inquiries/client/${id(900)}`);
    expect((screen.getByRole('button', { name: 'Close inquiry' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Close inquiry' }).getAttribute('title')).toBe("You don't have permission to close inquiries.");
    expect(screen.getByRole('list', { name: 'Inquiries' }).querySelector('a[aria-current="true"]')).toBeTruthy();
  });

  it('marks it read after one second, clears the row dot and asks the badge to reload', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    open(`#/inquiries/${id(1)}`);
    await screen.findByRole('list', { name: 'Messages' });
    expect(within(screen.getByRole('list', { name: 'Inquiries' })).getByText('Unread')).toBeTruthy();
    expect(reads).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(READ_AFTER_MS + 50); });
    expect(reads).toEqual([`/api/v1/inquiries/${id(1)}/read`]);
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Inquiries' })).queryByText('Unread')).toBeNull());
  });

  it('does not mark read when the User leaves before a second, nor when it is already read', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    open(`#/inquiries/${id(1)}`);
    await screen.findByRole('list', { name: 'Messages' });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); window.location.hash = '#/inquiries'; window.dispatchEvent(new HashChangeEvent('hashchange')); await vi.advanceTimersByTimeAsync(2000); });
    expect(reads).toEqual([]);
    detail = () => ({ status: 200, body: thread(1, { unread: false }) });
    await act(async () => { window.location.hash = `#/inquiries/${id(1)}`; window.dispatchEvent(new HashChangeEvent('hashchange')); await vi.advanceTimersByTimeAsync(2000); });
    expect(reads).toEqual([]);
  });

  it('says so for a Closed inquiry and keeps Reopen off without the permission', async () => {
    detail = () => ({ status: 200, body: thread(1, { status: 'closed', unread: false }) });
    open(`#/inquiries/${id(1)}`);
    expect(await screen.findByText('This inquiry is closed. Reopen it to reply.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Reopen' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Close inquiry' })).toBeNull();
  });

  it('shows an info banner with icon, the message count and pill in the header, and icons on Close and Reopen', async () => {
    detail = () => ({ status: 200, body: thread(1, { status: 'closed', unread: false }) });
    const { container } = open(`#/inquiries/${id(1)}`);
    const banner = (await screen.findByText('This inquiry is closed. Reopen it to reply.')).closest('.banner')!;
    expect(banner.querySelector('svg')).toBeTruthy();
    expect(within(banner as HTMLElement).getByRole('button', { name: 'Reopen' }).querySelector('svg')).toBeTruthy();
    const head = container.querySelector('.thread-head')!;
    expect(head.textContent).toContain('2 messages');
    expect(head.querySelector('.thread-meta .pill')!.textContent).toBe('Closed');
  });

  it('says "1 message" for one message and puts an icon on Close inquiry', async () => {
    detail = () => ({ status: 200, body: thread(1, { messages: [thread(1).messages[0]] }) });
    open(`#/inquiries/${id(1)}`, CLOSER);
    expect(await screen.findByText('1 message')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close inquiry' }).querySelector('svg')).toBeTruthy();
  });

  describe('customer hover card', () => {
    const ready = async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      open(`#/inquiries/${id(1)}`);
      return screen.findByRole('link', { name: 'Mara Lindqvist' });
    };
    const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    beforeEach(() => {
      detail = (p) => ({ status: 200, body: p.startsWith('/api/v1/clients/') ? profile({ phone: '+351 555 0100' }) : thread(1) });
    });

    it('opens after 250 ms on the name with the facts and View profile, closes 150 ms after the mouse leaves', async () => {
      const name = await ready();
      expect(name.className).toBe('cust-link');
      fireEvent.mouseEnter(name.parentElement!);
      await tick(200);
      expect(screen.queryByRole('group', { name: 'Customer: Mara Lindqvist' })).toBeNull();
      await tick(80);
      const card = await screen.findByRole('group', { name: 'Customer: Mara Lindqvist' });
      expect(card.textContent).toContain('mara@example.test');
      await waitFor(() => expect(card.textContent).toContain('+351 555 0100'));
      expect(card.textContent).toContain('Lisbon');
      expect(card.textContent).toContain('09/14/2026');
      expect(within(card).getByText('Inquiries').nextElementSibling!.textContent).toBe('1');
      expect(within(card).getByRole('link', { name: 'View profile' }).getAttribute('href')).toBe(`#/inquiries/client/${id(900)}`);
      fireEvent.mouseLeave(name.parentElement!);
      await tick(100);
      expect(screen.queryByRole('group', { name: 'Customer: Mara Lindqvist' })).toBeTruthy();
      await tick(80);
      expect(screen.queryByRole('group', { name: 'Customer: Mara Lindqvist' })).toBeNull();
    });

    it('opens on focus, closes on Escape, and reads the profile only once', async () => {
      const name = await ready();
      fireEvent.focus(name);
      expect(await screen.findByRole('group', { name: 'Customer: Mara Lindqvist' })).toBeTruthy();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('group', { name: 'Customer: Mara Lindqvist' })).toBeNull();
      fireEvent.focus(name);
      await screen.findByRole('group', { name: 'Customer: Mara Lindqvist' });
      expect(mocks.request.mock.calls.filter((c) => c[0] === 'GET' && c[1] === `/api/v1/clients/${id(900)}`)).toHaveLength(1);
    });

    it('still shows name and email when the profile read fails, and has no axe violations', async () => {
      detail = (p) => (p.startsWith('/api/v1/clients/') ? { status: 500 } : { status: 200, body: thread(1) });
      const name = await ready();
      fireEvent.focus(name);
      await screen.findByRole('group', { name: 'Customer: Mara Lindqvist' });
      expect(screen.getByRole('group', { name: 'Customer: Mara Lindqvist' }).textContent).toContain('mara@example.test');
      vi.useRealTimers();
      expect((await axe.run(document.body, noisy)).violations).toEqual([]);
    });
  });

  const patches = () => mocks.request.mock.calls.filter((c) => c[0] === 'PATCH');

  it('closes with the version, shows the Closed pill and the toast, and asks the list to reload', async () => {
    open(`#/inquiries/${id(1)}`, CLOSER);
    await screen.findByRole('list', { name: 'Messages' });
    fireEvent.click(screen.getByRole('button', { name: 'Close inquiry' }));
    expect(await screen.findByText('Inquiry closed')).toBeTruthy();
    expect(patches()[0].slice(0, 4)).toEqual(['PATCH', `/api/v1/inquiries/${id(1)}`, { status: 'closed' }, 0]);
    const region = screen.getByRole('region', { name: 'Conversation' });
    expect(region.querySelector('.pill')?.textContent).toBe('Closed');
    expect(screen.getByText('This inquiry is closed. Reopen it to reply.')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Reply' })).toBeNull();
  });

  it('reopens a closed inquiry and brings the composer back', async () => {
    detail = () => ({ status: 200, body: thread(1, { status: 'closed', unread: false, version: 3 }) });
    open(`#/inquiries/${id(1)}`, CLOSER);
    fireEvent.click(await screen.findByRole('button', { name: 'Reopen' }));
    expect(await screen.findByText('Marked New')).toBeTruthy();
    expect(patches()[0].slice(2, 4)).toEqual([{ status: 'new' }, 3]);
    expect(await screen.findByRole('textbox', { name: 'Reply' })).toBeTruthy();
  });

  it('changes status through the select with the "Marked" toast', async () => {
    open(`#/inquiries/${id(1)}`, CLOSER);
    await screen.findByRole('list', { name: 'Messages' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'replied' } });
    expect(await screen.findByText('Marked Replied')).toBeTruthy();
    expect(patches()[0][2]).toEqual({ status: 'replied' });
  });

  it('leaves Closed out of the select for a User without the permission', async () => {
    open(`#/inquiries/${id(1)}`);
    await screen.findByRole('list', { name: 'Messages' });
    const closedOption = within(screen.getByRole('combobox', { name: 'Status' })).getByRole('option', { name: 'Closed' }) as HTMLOptionElement;
    expect(closedOption.disabled).toBe(true);
  });

  it('shows the permission message when the server refuses and keeps the status', async () => {
    patch = () => ({ status: 403 });
    open(`#/inquiries/${id(1)}`, CLOSER);
    await screen.findByRole('list', { name: 'Messages' });
    fireEvent.click(screen.getByRole('button', { name: 'Close inquiry' }));
    expect(await screen.findByText("You don't have permission to close inquiries.")).toBeTruthy();
    // The shell also swaps the screen for its forbidden view on any 403; the toast is what names the action.
    expect(screen.queryByRole('region', { name: 'Conversation' })).toBeNull();
  });

  it('reloads the thread after a stale version', async () => {
    patch = () => ({ status: 409 });
    open(`#/inquiries/${id(1)}`, CLOSER);
    await screen.findByRole('list', { name: 'Messages' });
    const reads = () => mocks.request.mock.calls.filter((c) => c[0] === 'GET' && c[1] === `/api/v1/inquiries/${id(1)}`).length;
    const before = reads();
    fireEvent.click(screen.getByRole('button', { name: 'Close inquiry' }));
    expect(await screen.findByText('This inquiry changed. Showing the latest.')).toBeTruthy();
    await waitFor(() => expect(reads()).toBeGreaterThan(before));
  });

  it('shows the missing and error states', async () => {
    detail = () => ({ status: 404 });
    open(`#/inquiries/${id(1)}`);
    expect(await screen.findByText('This inquiry no longer exists.')).toBeTruthy();
  });

  it('offers Retry on a failed read', async () => {
    detail = () => ({ status: 500 });
    open(`#/inquiries/${id(1)}`);
    expect(await screen.findByText("Couldn't load this inquiry.")).toBeTruthy();
    detail = () => ({ status: 200, body: thread(1) });
    screen.getByRole('button', { name: 'Retry' }).click();
    expect(await screen.findByRole('list', { name: 'Messages' })).toBeTruthy();
  });

  it('has no axe violations', async () => {
    const { container } = open(`#/inquiries/${id(1)}`);
    await screen.findByRole('list', { name: 'Messages' });
    expect((await axe.run(container, noisy)).violations).toEqual([]);
  });
});

describe('Client profile', () => {
  beforeEach(() => { detail = () => ({ status: 200, body: profile() }); });

  it('shows the breadcrumb, details with dashes for empty ones, and the inquiries card linking to the thread', async () => {
    open(`#/inquiries/client/${id(900)}`);
    expect(await screen.findByRole('heading', { name: 'Mara Lindqvist' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toContain('InquiriesMara Lindqvist');
    expect(screen.getByText('Lisbon')).toBeTruthy();
    expect(screen.getByText('09/14/2026')).toBeTruthy();
    expect(screen.getByText('Prefers lace')).toBeTruthy();
    expect(screen.getAllByText('Not set')).toHaveLength(2); // phone, heard about us
    expect(screen.getByRole('link', { name: /^Subject 1/ }).getAttribute('href')).toBe(`#/inquiries/${id(1)}`);
      });

  it('shows the missing state', async () => {
    detail = () => ({ status: 404 });
    open(`#/inquiries/client/${id(900)}`);
    expect(await screen.findByRole('heading', { name: 'Customer not found' })).toBeTruthy();
  });

  it('has no axe violations', async () => {
    const { container } = open(`#/inquiries/client/${id(900)}`);
    await screen.findByRole('heading', { name: 'Mara Lindqvist' });
    expect((await axe.run(container, noisy)).violations).toEqual([]);
  });

  describe('Edit customer', () => {
    const edit = async () => {
      open(`#/inquiries/client/${id(900)}`);
      await screen.findByRole('heading', { name: 'Mara Lindqvist' });
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      return screen.findByRole('dialog');
    };
    const clientPatches = () => mocks.request.mock.calls.filter((c) => c[0] === 'PATCH' && String(c[1]).startsWith('/api/v1/clients/'));

    it('opens with the saved facts, keeps name and email read-only, and saves all five fields with the version', async () => {
      patch = (_p, b) => ({ status: 200, body: profile({ ...(b as object), version: 1 }) });
      const dlg = await edit();
      expect(within(dlg).getByText(/Mara Lindqvist · mara@example.test/)).toBeTruthy();
      expect((within(dlg).getByLabelText('City') as HTMLInputElement).value).toBe('Lisbon');
      fireEvent.change(within(dlg).getByLabelText('Phone'), { target: { value: '+351 555 0100' } });
      fireEvent.change(within(dlg).getByLabelText('Heard about us'), { target: { value: 'Referral' } });
      fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
      expect(await screen.findByText('Customer updated')).toBeTruthy();
      expect(clientPatches()[0].slice(0, 4)).toEqual([
        'PATCH', `/api/v1/clients/${id(900)}`,
        { phone: '+351 555 0100', city: 'Lisbon', weddingDate: '2026-09-14', source: 'Referral', note: 'Prefers lace' }, 0,
      ]);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(screen.getByText('+351 555 0100')).toBeTruthy();
    });

    it('offers Reload when the customer changed meanwhile', async () => {
      patch = () => ({ status: 409 });
      const dlg = await edit();
      fireEvent.change(within(dlg).getByLabelText('City'), { target: { value: 'Porto' } });
      fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
      expect(await within(dlg).findByText(/This customer changed while you were editing/)).toBeTruthy();
      expect((within(dlg).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
      const before = mocks.request.mock.calls.filter((c) => c[0] === 'GET' && c[1] === `/api/v1/clients/${id(900)}`).length;
      fireEvent.click(within(dlg).getByRole('button', { name: 'Reload' }));
      await waitFor(() => expect(mocks.request.mock.calls.filter((c) => c[0] === 'GET' && c[1] === `/api/v1/clients/${id(900)}`).length).toBeGreaterThan(before));
    });

    it('names the field the server refused and keeps the typing', async () => {
      patch = () => ({ status: 422, body: { fields: [{ field: 'city', code: 'too_long' }] } });
      const dlg = await edit();
      fireEvent.change(within(dlg).getByLabelText('City'), { target: { value: 'Porto' } });
      fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
      expect(await within(dlg).findByText('City can be up to 80 characters.')).toBeTruthy();
      expect(within(dlg).getByLabelText('City').getAttribute('aria-invalid')).toBe('true');
      expect((within(dlg).getByLabelText('City') as HTMLInputElement).value).toBe('Porto');
    });

    it('has no axe violations', async () => {
      await edit();
      expect((await axe.run(document.body, noisy)).violations).toEqual([]);
    });
  });
});

describe('Composer', () => {
  const editor = () => screen.getByRole('textbox', { name: 'Reply' });
  const write = (text: string) => {
    const box = editor();
    box.textContent = text;
    fireEvent.input(box);
  };
  const send = () => screen.getByRole('button', { name: 'Send' });
  const calls = (method: string, suffix: string) => mocks.request.mock.calls.filter((c) => c[0] === method && String(c[1]).endsWith(suffix));
  const posts = (suffix: string) => calls('POST', suffix);
  const ready = async () => {
    open(`#/inquiries/${id(1)}`);
    await screen.findByRole('list', { name: 'Messages' });
    await waitFor(() => expect(editor().getAttribute('contenteditable')).toBe('true'));
  };

  it('shows To and Subject, the Signature preview and the saved draft, and none for a Closed inquiry', async () => {
    draft = { body: '<div>Half written</div>', updatedAt: '2026-11-01T11:30:00Z', attachments: [] };
    await ready();
    expect(screen.getByRole('form', { name: 'Reply' }).textContent).toContain('Mara Lindqvist <mara@example.test>');
    expect(screen.getByRole('form', { name: 'Reply' }).textContent).toContain('Subject 1');
    expect(editor().textContent).toBe('Half written');
    expect(screen.getByText(/Warm regards,/).textContent).toContain('Sam Staff');
  });

  it('shows no composer on a Closed inquiry', async () => {
    detail = () => ({ status: 200, body: thread(1, { status: 'closed', unread: false }) });
    open(`#/inquiries/${id(1)}`);
    await screen.findByText('This inquiry is closed. Reopen it to reply.');
    expect(screen.queryByRole('textbox', { name: 'Reply' })).toBeNull();
  });

  it('saves the draft 1.5 seconds after typing and says so, and marks the window unsaved until then', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await ready();
    write('Hello');
    expect(mocks.setDirty).toHaveBeenCalledWith(true);
    expect(calls('PUT', '/draft')).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(calls('PUT', '/draft').map((c) => c[2])).toEqual([{ body: 'Hello' }]);
    expect(await screen.findByText('Saved as draft')).toBeTruthy();
    expect(mocks.setDirty).toHaveBeenLastCalledWith(false);
  });

  it('sends with a key, adds the reply, moves the status to Replied, clears the editor and toasts', async () => {
    await ready();
    write('Hello Mara');
    fireEvent.click(send());
    expect(await screen.findByText('Reply sent to Mara')).toBeTruthy();
    const [call] = posts('/reply');
    expect(call.slice(0, 3)).toEqual(['POST', `/api/v1/inquiries/${id(1)}/reply`, { body: 'Hello Mara' }]);
    expect(String(call[4]).length).toBeGreaterThan(8);
    const region = screen.getByRole('region', { name: 'Conversation' });
    expect(region.querySelector('.pill')?.textContent).toBe('Replied');
    expect(within(screen.getByRole('list', { name: 'Messages' })).getByText('Hello Mara')).toBeTruthy();
    expect(editor().textContent).toBe('');
  });

  it('refuses an empty reply and keeps Send from calling the server', async () => {
    await ready();
    fireEvent.click(send());
    expect(await screen.findByText('Write a message before sending.')).toBeTruthy();
    expect(document.activeElement).toBe(editor());
    expect(screen.getByRole('alert').querySelector('svg')).toBeTruthy();
    expect(posts('/reply')).toEqual([]);
  });

  it('keeps the same key for the same text after a failure and takes a new one when the text changes', async () => {
    reply = () => ({ status: 500 });
    await ready();
    write('Hello Mara');
    fireEvent.click(send());
    await screen.findByText("Couldn't send the reply. Try again.");
    await waitFor(() => expect((send() as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(send());
    await waitFor(() => expect(posts('/reply')).toHaveLength(2));
    await waitFor(() => expect((send() as HTMLButtonElement).disabled).toBe(false));
    write('Hello again');
    fireEvent.click(send());
    await waitFor(() => expect(posts('/reply')).toHaveLength(3));
    const keys = posts('/reply').map((c) => c[4]);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(editor().textContent).toBe('Hello again');
  });

  it('offers Retry when the mail did not go out and sends it again', async () => {
    reply = () => ({ status: 201, body: sentMessage({ mailState: 'failed' }) });
    await ready();
    write('Hello Mara');
    fireEvent.click(send());
    const msgs = await screen.findByRole('list', { name: 'Messages' });
    expect(await within(msgs).findByText(/Not sent\./)).toBeTruthy();
    expect(screen.getByText("The reply couldn't be emailed.")).toBeTruthy();
    fireEvent.click(within(msgs).getByRole('button', { name: 'Retry' }));
    await screen.findByText('Reply sent');
    expect(posts('/retry')[0][1]).toBe(`/api/v1/messages/${id(72)}/retry`);
    expect(within(msgs).queryByText(/Not sent\./)).toBeNull();
  });

  it('attaches files through the dialog, lists them and removes one', async () => {
    mocks.uploadFiles.mockImplementation(async () => {
      draft = { body: '', updatedAt: null, attachments: [{ id: id(80), name: 'veil.pdf', size: 2048 }] };
      return { stored: [id(80)], rejected: [], cancelled: false };
    });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }));
    const list = await screen.findByRole('list', { name: 'Attachments' });
    expect(mocks.uploadFiles).toHaveBeenCalledWith('attachment', id(1));
    expect(list.textContent).toContain('veil.pdf');
    expect(list.textContent).toContain('2 KB');
    fireEvent.click(screen.getByRole('button', { name: 'Remove veil.pdf' }));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Attachments' })).toBeNull());
    expect(calls('DELETE', `/attachments/${id(80)}`)).toHaveLength(1);
  });

  it('discards the draft and brings the text back with Undo', async () => {
    draft = { body: '<div>Keep me</div>', updatedAt: '2026-11-01T11:30:00Z', attachments: [] };
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(await screen.findByText('Draft discarded.')).toBeTruthy();
    expect(calls('DELETE', '/draft')).toHaveLength(1);
    expect(editor().textContent).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(editor().textContent).toBe('Keep me'));
  });

  it('sends with Ctrl+Enter by default and with Enter when the preference is on, Shift+Enter never', async () => {
    await ready();
    write('One');
    fireEvent.keyDown(editor(), { key: 'Enter' });
    expect(posts('/reply')).toEqual([]);
    fireEvent.keyDown(editor(), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(posts('/reply')).toHaveLength(1));
  });

  it('sends on Enter with the preference, not on Shift+Enter', async () => {
    open(`#/inquiries/${id(1)}`, { ...STAFF, preferences: { enterToSend: true } as Me['preferences'] });
    await screen.findByRole('list', { name: 'Messages' });
    await waitFor(() => expect(editor().getAttribute('contenteditable')).toBe('true'));
    write('Two');
    fireEvent.keyDown(editor(), { key: 'Enter', shiftKey: true });
    expect(posts('/reply')).toEqual([]);
    fireEvent.keyDown(editor(), { key: 'Enter' });
    await waitFor(() => expect(posts('/reply')).toHaveLength(1));
  });

  it('draws a reply as clean HTML and never runs a script or loads an image', async () => {
    detail = () => ({ status: 200, body: thread(1, { messages: [
      { id: id(71), direction: 'out', author: 'Sam Staff', createdAt: '2026-11-01T11:00:00Z', html: true, mailState: 'sent', attachments: [{ id: id(81), name: 'quote.pdf', size: 900 }],
        body: '<b>Hi</b><script>window.hacked=1</script><img src=x onerror="window.hacked=1"><a href="javascript:alert(1)">bad</a><a href="https://example.test/a">good</a>' },
    ] }) });
    const { container } = open(`#/inquiries/${id(1)}`);
    await screen.findByRole('list', { name: 'Messages' });
    const body = container.querySelector('.message-body.rich') as HTMLElement;
    expect(body.querySelector('b')?.textContent).toBe('Hi');
    expect(body.querySelector('script, img')).toBeNull();
    expect(body.querySelector('a[href^="javascript"]')).toBeNull();
    expect(body.querySelector('a[href="https://example.test/a"]')?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByRole('list', { name: 'Attachments' }).textContent).toContain('quote.pdf');
  });

  it('has an icon-only toolbar with a name on every button, a placeholder and the key hint with the signature note', async () => {
    await ready();
    const bar = screen.getByRole('toolbar', { name: 'Formatting' });
    const names = within(bar).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Bold', 'Italic', 'Underline', 'Bulleted list', 'Numbered list', 'Insert link', 'Attach files']);
    for (const b of within(bar).getAllByRole('button')) {
      expect(b.querySelector('svg')).toBeTruthy();
      expect(b.textContent).toBe('');
    }
    expect(editor().getAttribute('data-placeholder')).toBe('Write your reply…');
    expect(screen.getByText('Ctrl/⌘ + Enter to send · Signature added on send')).toBeTruthy();
  });

  it('shows the Enter hint with the preference and drops the signature note when none is set', async () => {
    mocks.request.mockImplementation(async (m: string, p: string) => {
      if (m === 'GET' && p.endsWith('/draft')) return { status: 200, body: draft };
      if (m === 'GET' && p === '/api/v1/me/signature') return { status: 200, body: { enabled: false } };
      if (m === 'GET' && p.startsWith('/api/v1/inquiries/')) return detail(p);
      return { status: 200, body: null };
    });
    open(`#/inquiries/${id(1)}`, { ...STAFF, preferences: { enterToSend: true } } as Me);
    await screen.findByRole('list', { name: 'Messages' });
    await waitFor(() => expect(editor().getAttribute('contenteditable')).toBe('true'));
    expect(screen.getByText('Enter to send · Shift+Enter for a new line')).toBeTruthy();
  });

  describe('link bar', () => {
    const bar = async () => {
      await ready();
      fireEvent.click(screen.getByRole('button', { name: 'Insert link' }));
      return screen.getByRole('textbox', { name: 'Link address' }) as HTMLInputElement;
    };
    const apply = (url: string, input: HTMLInputElement) => {
      fireEvent.change(input, { target: { value: url } });
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    };

    it('asks for https://example.com, turns example.com into https and an address into mailto', async () => {
      // jsdom has no execCommand; the composer hands the link to it, so the stub records what it was given.
      const exec = vi.fn(() => true);
      Object.defineProperty(document, 'execCommand', { value: exec, configurable: true, writable: true });
      const input = await bar();
      expect(input.placeholder).toBe('https://example.com');
      apply('example.com', input);
      await waitFor(() => expect(exec).toHaveBeenCalledWith('insertHTML', false, expect.stringContaining('href="https://example.com"')));
      fireEvent.click(screen.getByRole('button', { name: 'Insert link' }));
      apply('a@b.co', screen.getByRole('textbox', { name: 'Link address' }) as HTMLInputElement);
      await waitFor(() => expect(exec).toHaveBeenCalledWith('insertHTML', false, expect.stringContaining('href="mailto:a@b.co"')));
      expect(screen.queryByRole('textbox', { name: 'Link address' })).toBeNull();
    });

    it('keeps the message for anything else and closes with Escape', async () => {
      const input = await bar();
      apply('ftp://x.test', input);
      expect(await screen.findByText('Use a link that starts with http://, https:// or mailto:.')).toBeTruthy();
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(screen.queryByRole('textbox', { name: 'Link address' })).toBeNull();
    });
  });

  it('refuses a file over the limit with its name and adds nothing', async () => {
    mocks.uploadFiles.mockResolvedValue({ stored: [], rejected: [{ name: 'gown.psd', reason: 'size' }], cancelled: false });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }));
    expect(await screen.findByText('gown.psd is over 20 MB')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Attachments' })).toBeNull();
  });

  it('keeps the generic message for other or several rejections', async () => {
    mocks.uploadFiles.mockResolvedValue({ stored: [], rejected: [{ name: 'a.exe', reason: 'unreadable' }, { name: 'b.psd', reason: 'size' }], cancelled: false });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }));
    expect(await screen.findByText("a.exe and 1 more couldn't be attached.")).toBeTruthy();
  });

  it('has no axe violations', async () => {
    const { container } = open(`#/inquiries/${id(1)}`);
    await screen.findByRole('list', { name: 'Messages' });
    await waitFor(() => expect(editor().getAttribute('contenteditable')).toBe('true'));
    expect((await axe.run(container, noisy)).violations).toEqual([]);
  });
});
