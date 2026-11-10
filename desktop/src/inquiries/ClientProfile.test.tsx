import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from '../shell/Shell';
import type { Me } from '../shell/context';

const mocks = vi.hoisted(() => ({ request: vi.fn(), setDirty: vi.fn() }));
vi.mock('../bridge', async (orig) => ({ ...(await orig<typeof import('../bridge')>()), bridge: mocks }));

const STAFF: Me = { id: 's1', name: 'Sam Staff', email: 'sam@example.test', role: 'Staff', permissions: ['PERM_VIEW_GALLERY', 'PERM_REPLY'] };
const noisy = { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } };
const id = (n: number) => `0b1c2d3e-0000-4000-8000-${String(n).padStart(12, '0')}`;

const full = {
  id: id(900), name: 'Mara Lindqvist', email: 'mara@example.test', phone: '+351 555 0100', city: 'Lisbon', weddingDate: '2026-09-14', source: 'Instagram', note: 'Prefers lace',
  createdAt: '2026-10-01T10:00:00Z', version: 0,
  inquiries: [
    { id: id(1), subject: 'Fitting in June', preview: 'Can we book a fitting?', lastMessageAt: '2026-11-01T10:00:00Z', status: 'new' },
    { id: id(2), subject: 'Veil question', preview: 'Which veil goes with lace?', lastMessageAt: '2026-10-20T10:00:00Z', status: 'closed' },
  ],
};
let answer: { status: number; body?: unknown };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.setDirty.mockResolvedValue(undefined);
  answer = { status: 200, body: full };
  mocks.request.mockImplementation(async (m: string, p: string) => {
    if (m === 'GET' && p.startsWith('/api/v1/clients/')) return answer;
    if (p === '/api/v1/inquiries/count') return { status: 200, body: { count: 0 } };
    return { status: 200, body: null };
  });
});

const open = () => {
  window.location.hash = `#/inquiries/client/${id(900)}`;
  return render(<Shell me={STAFF} onExpired={vi.fn()} onSignOut={vi.fn()} />);
};

describe('Customer profile', () => {
  it('shows a chevron breadcrumb with the name as the current page, and the header with city, wedding, Email and Edit', async () => {
    open();
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Mara Lindqvist' });
    const crumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumb).getByRole('link', { name: 'Inquiries' }).getAttribute('href')).toBe('#/inquiries');
    expect(crumb.querySelector('svg')).toBeTruthy();
    expect(crumb.textContent).not.toContain('/');
    expect(crumb.querySelector('[aria-current="page"]')!.textContent).toBe('Mara Lindqvist');
    expect(h1.closest('header')!.textContent).toContain('Lisbon · Wedding 09/14/2026');
    expect(h1.closest('header')!.querySelector('.avatar.large')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Email Mara' }).getAttribute('href')).toBe('mailto:mara@example.test');
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
  });

  it('lists Personal details in the prototype order with "—" and "Not set" for missing values', async () => {
    answer = { status: 200, body: { ...full, phone: null, source: null, note: null } };
    open();
    await screen.findByRole('heading', { name: 'Personal details' });
    const card = screen.getByRole('heading', { name: 'Personal details' }).closest('section')!;
    expect([...card.querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['Full name', 'Email', 'Phone', 'City', 'Wedding date', 'Heard about us', 'Customer since', 'Notes']);
    const dd = [...card.querySelectorAll('dd')];
    expect(dd[0].textContent).toBe('Mara Lindqvist');
    expect(dd[1].textContent).toBe('mara@example.test');
    expect(dd[2].textContent).toBe('—Not set');
    expect(dd[3].textContent).toBe('Lisbon');
    expect(dd[5].textContent).toBe('—Not set');
    expect(dd[6].textContent).toBe('10/01/2026');
    expect(dd[7].textContent).toBe('—Not set');
  });

  it('shows "All inquiries (n)" with subject, preview, time and status on rows that open the thread', async () => {
    open();
    const h = await screen.findByRole('heading', { name: /All inquiries/ });
    expect(h.textContent).toBe('All inquiries (2)');
    const rows = within(h.closest('section')!).getAllByRole('link');
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute('href')).toBe(`#/inquiries/${id(1)}`);
    expect(rows[0].textContent).toContain('Fitting in June');
    expect(rows[0].textContent).toContain('Can we book a fitting?');
    expect(rows[0].textContent).toContain('11/01/2026');
    expect(rows[0].querySelector('.pill')!.textContent).toBe('New');
    expect(rows[1].querySelector('.pill')!.textContent).toBe('Closed');
  });

  it('says "Customer not found" under the same breadcrumb', async () => {
    answer = { status: 404 };
    open();
    expect(await screen.findByRole('heading', { level: 1, name: 'Customer not found' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toContain('Unknown customer');
  });

  it('uses the word Customer, never Client, in the Edit dialog', async () => {
    open();
    await screen.findByRole('heading', { level: 1, name: 'Mara Lindqvist' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText('Edit customer')).toBeTruthy();
    await waitFor(() => expect(dlg.textContent).not.toMatch(/\bclient\b/i));
  });

  it('has no axe violations', async () => {
    const { container } = open();
    await screen.findByRole('heading', { level: 1, name: 'Mara Lindqvist' });
    expect((await axe.run(container, noisy)).violations).toEqual([]);
  });
});
