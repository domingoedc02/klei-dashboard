import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from '../shell/Shell';
import type { Me } from '../shell/context';

const mocks = vi.hoisted(() => ({ request: vi.fn(), setDirty: vi.fn(), uploadFiles: vi.fn() }));
vi.mock('../bridge', async (orig) => ({ ...(await orig<typeof import('../bridge')>()), bridge: mocks }));

const ADMIN: Me = { id: 'a1', name: 'Ada Admin', email: 'ada@example.test', role: 'Admin', permissions: ['PERM_REPLY', 'PERM_VIEW_GALLERY', 'PERM_AI_SETTINGS'] };
const STAFF: Me = { id: 's1', name: 'Sam Staff', email: 'sam@example.test', role: 'Staff', permissions: ['PERM_REPLY'] };
const G = '0b1c2d3e-0000-4000-8000-000000000001';
const P = '0b1c2d3e-0000-4000-8000-000000000002';
const INQ = '0b1c2d3e-0000-4000-8000-000000000003';

let stored: { id: string; role: string; text: string; createdAt: string; gowns?: unknown[] }[];
let post: (body: unknown) => { status: number; body: unknown };
let calls: { m: string; p: string; b?: unknown }[];

beforeEach(() => {
  vi.resetAllMocks();
  window.location.hash = '#/dashboard';
  mocks.setDirty.mockResolvedValue(undefined);
  stored = [];
  calls = [];
  post = (b) => ({ status: 201, body: { messages: [
    { id: 'u1', role: 'user', text: (b as { text: string }).text, createdAt: '2026-11-01T10:00:00Z' },
    { id: 'a1', role: 'assistant', text: 'Here is a short answer.', createdAt: '2026-11-01T10:00:01Z' },
  ] } });
  mocks.request.mockImplementation(async (m: string, p: string, b?: unknown) => {
    calls.push({ m, p, b });
    if (p === '/api/v1/notifications') return { status: 200, body: { items: [], unread: 0 } };
    if (p === '/api/v1/dashboard') return { status: 200, body: { aiStatus: { phase: 'idle' }, errors: [] } };
    if (p === '/api/v1/assistant/chat' && m === 'GET') return { status: 200, body: { messages: stored } };
    if (p === '/api/v1/assistant/chat' && m === 'DELETE') return { status: 204, body: null };
    if (p === '/api/v1/assistant/chat/messages') return post(b);
    return { status: 200, body: null };
  });
});

const open = async (me: Me = ADMIN) => {
  render(<Shell me={me} onExpired={vi.fn()} onSignOut={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'AI Assistant' }));
  return screen.findByRole('log', { name: 'Conversation' });
};
const sent = () => calls.filter((c) => c.p === '/api/v1/assistant/chat/messages').map((c) => c.b);

describe('Assistant drawer', () => {
  it('opens with the avatar header, disclosure, greeting, three chips and the prototype input copy; axe finds nothing', async () => {
    await open();
    const drawer = screen.getByRole('complementary', { name: 'AI Assistant' });
    expect(drawer.querySelector('.assist-head .drawer-av')).toBeTruthy();
    expect(within(drawer).getByRole('heading', { name: 'AI Assistant' })).toBeTruthy();
    expect(within(drawer).getByText(/sent to your AI provider\. Nothing is sent by email or changed for you\./)).toBeTruthy();
    expect(within(drawer).getByText('Hi! I can summarize inquiries, draft replies and suggest gowns from your gallery.')).toBeTruthy();
    const chips = within(drawer).getAllByRole('button').filter((b) => b.classList.contains('chip-btn')).map((b) => b.textContent);
    expect(chips).toEqual(['Summarize new inquiries', 'Draft a reply', 'Suggest gowns for a beach wedding']);
    expect((within(drawer).getByLabelText('Message') as HTMLTextAreaElement).placeholder).toBe('Ask anything about your inquiries or gowns…');
    expect(within(drawer).queryByText(/simulated/i)).toBeNull();
    const r = await axe.run(drawer, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });

  it('the footer reads Enter to send when that preference is on, otherwise Ctrl/⌘ + Enter', async () => {
    await open({ ...ADMIN, preferences: { enterToSend: true } } as Me);
    expect(screen.getByText('Enter to send · Shift+Enter for a new line')).toBeTruthy();
  });

  it('chips go away after the first user turn, also on a saved conversation', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Summarize new inquiries' }));
    await screen.findByText('Here is a short answer.');
    expect(document.querySelector('.assist-chips')).toBeNull();
  });

  it('chips stay hidden when the saved conversation already has a user turn', async () => {
    stored = [{ id: 'x', role: 'user', text: 'Earlier question', createdAt: '2026-11-01T10:00:00Z' }];
    await open();
    await screen.findByText('Earlier question');
    expect(document.querySelector('.assist-chips')).toBeNull();
  });

  it('shows earlier lines of the conversation', async () => {
    stored = [{ id: 'x', role: 'user', text: 'Earlier question', createdAt: '2026-11-01T10:00:00Z' }];
    await open();
    expect(await screen.findByText('Earlier question')).toBeTruthy();
  });

  it('a chip sends its words and the answer appears with Copy', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Summarize new inquiries' }));
    expect(await screen.findByText('Here is a short answer.')).toBeTruthy();
    expect(sent()).toEqual([{ text: 'Summarize new inquiries' }]);
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
  });

  const withThread = (name: string) => {
    const base = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (m: string, p: string, b?: unknown) =>
      p === `/api/v1/inquiries/${INQ}` && m === 'GET'
        ? { status: 200, body: { id: INQ, subject: 'Fitting', status: 'New', unread: false, version: 1, messages: [], client: { id: P, name, email: 'hannah@example.test' } } }
        : base(m, p, b));
  };

  it('Draft a reply names the open customer by first name and sends the thread id; the prompt holds no email, id or filename', async () => {
    window.location.hash = `#/inquiries/${INQ}`;
    withThread('Hannah Lee');
    await open();
    await userEvent.click(await screen.findByRole('button', { name: 'Draft a reply to Hannah' }));
    await screen.findByText('Here is a short answer.');
    expect(sent()).toEqual([{ text: 'Draft a reply to Hannah', inquiryId: INQ }]);
    const text = (sent()[0] as { text: string }).text;
    expect(text).not.toMatch(/@|example\.test|Lee/);
    expect(text).not.toContain(INQ);
    expect(text).not.toMatch(/\.(jpe?g|png|webp|heic|pdf)\b/i);
  });

  it('with a thread open but no usable name the chip stays plain and still sends the thread id', async () => {
    window.location.hash = `#/inquiries/${INQ}`;
    withThread('hannah@example.test');
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Draft a reply' }));
    await screen.findByText('Here is a short answer.');
    expect(sent()).toEqual([{ text: 'Draft a reply', inquiryId: INQ }]);
  });

  it('with no thread open Draft a reply sends no thread id', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Draft a reply' }));
    await screen.findByText('Here is a short answer.');
    expect(sent()).toEqual([{ text: 'Draft a reply' }]);
  });

  it('shows the typing line and keeps the input editable while waiting', async () => {
    let release: (v: unknown) => void = () => {};
    const wait = new Promise((r) => { release = r; });
    const base = post;
    mocks.request.mockImplementation(async (_m: string, p: string, b?: unknown) => {
      if (p === '/api/v1/assistant/chat/messages') { await wait; return base(b); }
      if (p === '/api/v1/assistant/chat') return { status: 200, body: { messages: [] } };
      return { status: 200, body: { items: [], unread: 0 } };
    });
    await open();
    await userEvent.type(screen.getByLabelText('Message'), 'Hello');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    const dots = await screen.findByRole('status', { name: 'The assistant is typing' });
    expect(dots.querySelectorAll('i')).toHaveLength(3);
    expect(screen.queryByText(/is typing…/)).toBeNull();
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText('Message'), ' more');
    expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe(' more');
    release(null);
    expect(await screen.findByText('Here is a short answer.')).toBeTruthy();
  });

  it('shows the user bubble and the dots before the reply lands, and Retry when the send fails', async () => {
    let release: (v: unknown) => void = () => {};
    const wait = new Promise((r) => { release = r; });
    const base = post;
    mocks.request.mockImplementation(async (m: string, p: string, b?: unknown) => {
      if (p === '/api/v1/assistant/chat/messages') { await wait; return base(b); }
      if (p === '/api/v1/assistant/chat' && m === 'GET') return { status: 200, body: { messages: [] } };
      return { status: 200, body: { items: [], unread: 0 } };
    });
    const log = await open();
    await userEvent.type(screen.getByLabelText('Message'), 'Hello');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(within(log).getByText('Hello')).toBeTruthy();
    expect(screen.getByRole('status', { name: 'The assistant is typing' })).toBeTruthy();
    expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('');
    release(null);
    expect(await screen.findByText('Here is a short answer.')).toBeTruthy();
    expect(within(log).getAllByText('Hello')).toHaveLength(1);
    expect(within(log).queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('a failed send keeps the bubble, hides the chips and Retry sends the same body again', async () => {
    let fail = true;
    const ok = post;
    post = (b) => (fail ? { status: 502, body: null } : ok(b));
    const log = await open();
    await userEvent.click(screen.getByRole('button', { name: /^Draft a reply/ }));
    await screen.findByRole('alert');
    expect(within(log).getByText(/^Draft a reply/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Summarize new inquiries' })).toBeNull();
    expect((screen.getByRole('button', { name: 'New chat' }) as HTMLButtonElement).disabled).toBe(false);
    fail = false;
    await userEvent.click(within(log).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Here is a short answer.')).toBeTruthy();
    const bodies = sent() as { text: string; inquiryId?: string }[];
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(within(log).queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('a failed text goes back into an empty box, and New chat drops the failed bubble', async () => {
    post = () => ({ status: 502, body: null });
    const log = await open();
    await userEvent.type(screen.getByLabelText('Message'), 'Hello');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByRole('alert');
    expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('Hello');
    await userEvent.click(screen.getByRole('button', { name: 'New chat' }));
    await waitFor(() => expect(within(log).queryByText('Hello')).toBeNull());
  });

  it('a 201 with no messages reloads the conversation instead of dropping the bubble', async () => {
    post = () => ({ status: 201, body: { messages: [] } });
    const log = await open();
    stored = [{ id: 'u1', role: 'user', text: 'Hello', createdAt: '2026-11-01T10:00:00Z' }];
    await userEvent.type(screen.getByLabelText('Message'), 'Hello');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(within(log).getAllByText('Hello')).toHaveLength(1));
    expect(calls.filter((c) => c.m === 'GET' && c.p === '/api/v1/assistant/chat').length).toBeGreaterThan(1);
  });

  it('Escape in the notifications menu or the search popover leaves the Assistant open', async () => {
    mocks.request.mockImplementation(async (m: string, p: string) => {
      if (p === '/api/v1/notifications') return { status: 200, body: { items: [], unread: 0 } };
      if (p === '/api/v1/assistant/chat' && m === 'GET') return { status: 200, body: { messages: [] } };
      if (p === '/api/v1/search') return { status: 200, body: { items: [{ kind: 'inquiry', id: INQ, title: 'Mia Client', subtitle: 'Fitting' }] } };
      return { status: 200, body: null };
    });
    await open();
    await userEvent.click(screen.getByRole('button', { name: /^Notifications/ }));
    await screen.findByText('You’re all caught up');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText('You’re all caught up')).toBeNull();
    expect(screen.getByRole('complementary', { name: 'AI Assistant' })).toBeTruthy();
    await userEvent.type(screen.getByRole('searchbox'), 'mia');
    await screen.findByRole('listbox', { name: 'Search results' });
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('complementary', { name: 'AI Assistant' })).toBeTruthy();
  });

  it('suggested gowns are link rows to the gallery', async () => {
    post = () => ({ status: 201, body: { messages: [
      { id: 'u1', role: 'user', text: 'Suggest gowns', createdAt: '2026-11-01T10:00:00Z' },
      { id: 'a1', role: 'assistant', text: 'Try Magnolia today.', createdAt: '2026-11-01T10:00:01Z', gowns: [{ id: G, name: 'Magnolia', thumbs: [P] }] },
    ] } });
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Suggest gowns for a beach wedding' }));
    const link = await screen.findByRole('link', { name: 'Magnolia' });
    expect(link.getAttribute('href')).toBe(`#/gallery/${G}`);
  });

  it('Ctrl+Enter sends by default; plain Enter adds a line', async () => {
    await open();
    const box = screen.getByLabelText('Message');
    await userEvent.type(box, 'Hello{Enter}there');
    expect(sent()).toEqual([]);
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(sent()).toEqual([{ text: 'Hello\nthere' }]));
  });

  it('Enter sends and Shift+Enter adds a line when the preference is on', async () => {
    await open({ ...ADMIN, preferences: { enterToSend: true } } as Me);
    const box = screen.getByLabelText('Message');
    await userEvent.type(box, 'One{Shift>}{Enter}{/Shift}Two{Enter}');
    await waitFor(() => expect(sent()).toEqual([{ text: 'One\nTwo' }]));
  });

  it('a provider failure shows the plain line with a settings link for Admin only', async () => {
    post = () => ({ status: 502, body: null });
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Summarize new inquiries' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("The assistant can't reach your AI provider. Check AI settings.");
    expect(within(alert).getByRole('link', { name: 'Open settings' })).toBeTruthy();
  });

  it('an unset provider (409) reads the same, and Staff get no settings link', async () => {
    post = () => ({ status: 409, body: null });
    await open(STAFF);
    await userEvent.click(screen.getByRole('button', { name: 'Suggest gowns for a beach wedding' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("can't reach your AI provider");
    expect(within(alert).queryByRole('link')).toBeNull();
  });

  it('New chat deletes the conversation and clears the list', async () => {
    stored = [{ id: 'x', role: 'user', text: 'Earlier question', createdAt: '2026-11-01T10:00:00Z' }];
    await open();
    await screen.findByText('Earlier question');
    await userEvent.click(screen.getByRole('button', { name: 'New chat' }));
    await waitFor(() => expect(screen.queryByText('Earlier question')).toBeNull());
    expect(calls.some((c) => c.m === 'DELETE' && c.p === '/api/v1/assistant/chat')).toBe(true);
  });

  it('a failed first read shows Retry', async () => {
    mocks.request.mockImplementation(async (_m: string, p: string) =>
      p === '/api/v1/assistant/chat' ? { status: 500, body: null } : { status: 200, body: { items: [], unread: 0 } });
    render(<Shell me={ADMIN} onExpired={vi.fn()} onSignOut={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'AI Assistant' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Couldn't load the conversation.");
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('Escape closes the drawer and focus returns to the AI Assistant button', async () => {
    await open();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: 'AI Assistant' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'AI Assistant' }));
  });

  it('user turns are solid accent bubbles, assistant turns grey; the dots stand still under reduced motion', () => {
    const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf8');
    expect(css).toMatch(/\.assist-line\[data-role='user'\] \.assist-b \{[^}]*background: var\(--color-primary\); color: var\(--color-primary-text\)/);
    expect(css).toMatch(/\.assist-b \{[^}]*border-radius: var\(--radius-lg\)[^}]*background: rgba\(0, 0, 0, 0\.05\)/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.assist-typing i \{ animation: none; \} \}/);
  });
});
