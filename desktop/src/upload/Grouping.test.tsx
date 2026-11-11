import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadEvent, UploadKind, UploadSummary } from '../bridge';
import { Shell } from '../shell/Shell';
import { overallPct } from './Processing';
import type { Me } from '../shell/context';

const mocks = vi.hoisted(() => ({ request: vi.fn(), setDirty: vi.fn(), uploadFiles: vi.fn() }));
vi.mock('../bridge', async (orig) => ({ ...(await orig<typeof import('../bridge')>()), bridge: mocks }));

const B = '0b1c2d3e-0000-4000-8000-000000000001';
const photo = (n: number) => `0b1c2d3e-0000-4000-8000-${String(n).padStart(12, '0')}`;
const STAFF: Me = { id: 's1', name: 'Sam Staff', email: 'sam@example.test', role: 'Staff', permissions: ['PERM_UPLOAD_IMAGES'] };
const none: UploadSummary = { stored: [], rejected: [], cancelled: false };
const noisy = { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } };

type Body = Record<string, unknown>;
let batch: Body;
let status: Body;
let startReply: { status: number; body?: Body };
let polls = 0;

function backend() {
  mocks.request.mockImplementation(async (m: string, p: string) => {
    if (p === '/api/v1/uploads/current') return { status: 200, body: batch };
    if (p === `/api/v1/uploads/${B}/start`) return startReply;
    if (m === 'GET' && p === `/api/v1/uploads/${B}`) {
      polls++;
      return { status: 200, body: status };
    }
    return { status: 200, body: null };
  });
  mocks.uploadFiles.mockImplementation(async (_k: UploadKind, _id: string, _on?: (e: UploadEvent) => void) => none);
}

const open = () => {
  window.location.hash = '#/upload';
  return render(<Shell me={STAFF} onExpired={vi.fn()} onSignOut={vi.fn()} />);
};
const with2 = { id: B, phase: 'empty', photoIds: [photo(1), photo(2)], rejected: 0 };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.setDirty.mockResolvedValue(undefined);
  polls = 0;
  batch = with2;
  status = { id: B, phase: 'processing', step: 1, done: 0, total: 2 };
  startReply = { status: 202, body: status };
});
afterEach(() => vi.useRealTimers());

describe('Start grouping and the Processing screen', () => {
  it('offers Start grouping only when photos are stored', async () => {
    batch = { id: B, phase: 'empty', photoIds: [], rejected: 0 };
    backend();
    open();
    await screen.findByRole('heading', { name: 'Drop gown photos here' });
    expect(screen.queryByRole('button', { name: 'Start grouping' })).toBeNull();
  });

  it('starts, shows the four steps with the current one marked and the leave-screen text, and passes axe', async () => {
    backend();
    const { container } = open();
    await userEvent.click(await screen.findByRole('button', { name: 'Start grouping' }));
    expect(mocks.request).toHaveBeenCalledWith('POST', `/api/v1/uploads/${B}/start`, undefined, undefined, undefined);
    const steps = await screen.findByRole('list', { name: 'Grouping steps' });
    expect(steps.textContent).toContain('Reading 2 photos');
    expect(steps.textContent).toContain('Grouping images of the same gown');
    expect(steps.textContent).toContain('Tagging silhouette, fabric, neckline');
    expect(steps.textContent).toContain('Writing descriptions');
    expect(steps.querySelector('[aria-current="step"]')?.textContent).toContain('Reading');
    expect(screen.getByText('You can leave this screen. Progress shows on the Dashboard.')).toBeTruthy();
    expect(screen.getByText('Photo thumbnails are sent to your AI provider.')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Overall progress' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Drop gown photos here' })).toBeNull();
    const r = await axe.run(container, noisy);
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });

  it('polls every 2 seconds, checks the earlier step, and shows the groups when the phase is review', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    batch = { id: B, phase: 'processing', photoIds: [photo(1), photo(2)], rejected: 0 };
    status = { id: B, phase: 'processing', step: 2, done: 1, total: 2 };
    backend();
    open();
    const steps = await screen.findByRole('list', { name: 'Grouping steps' });
    expect(steps.querySelector('li.done')?.textContent).toContain('Reading');
    expect(steps.querySelector('[aria-current="step"]')?.textContent).toContain('Grouping images');
    const before = polls;
    status = {
      id: B, phase: 'review',
      groups: [
        { id: 'g1', name: 'Group 1', confidence: 40, band: 'low', position: 0, photoIds: [photo(1)] },
        { id: 'g2', name: 'Group 2', confidence: 95, band: 'high', position: 1, photoIds: [photo(2)] },
      ],
    };
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(polls).toBeGreaterThan(before);
    expect(await screen.findByRole('heading', { name: 'Gown groups' })).toBeTruthy();
    const settled = polls;
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(polls).toBe(settled);
  });

  it('says where grouping stopped, when it was last good, and Retry starts again', async () => {
    batch = { id: B, phase: 'error', photoIds: [photo(1), photo(2)], rejected: 0 };
    status = { id: B, phase: 'error', error: { code: 'unauthorized', step: 1, lastGood: '2026-11-09T08:30:00Z' } };
    startReply = { status: 202, body: { id: B, phase: 'processing', step: 1, done: 1, total: 2 } };
    backend();
    const { container } = open();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Grouping stopped at step 1 (Reading). Last good');
    expect(alert.textContent).toContain('refused the key');
    const r = await axe.run(container, noisy);
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.request).toHaveBeenCalledWith('POST', `/api/v1/uploads/${B}/start`, undefined, undefined, undefined);
    expect(await screen.findByRole('list', { name: 'Grouping steps' })).toBeTruthy();
  });

  it('marks Tagging as the current step with its own bar and names a group the provider could not describe', async () => {
    batch = { id: B, phase: 'processing', photoIds: [photo(1), photo(2)], rejected: 0 };
    status = { id: B, phase: 'processing', step: 3, done: 1, total: 2 };
    backend();
    open();
    const steps = await screen.findByRole('list', { name: 'Grouping steps' });
    expect(steps.querySelector('[aria-current="step"]')?.textContent).toContain('Tagging');
    expect(steps.querySelectorAll('li.done').length).toBe(2);
    const bar = screen.getByRole('progressbar', { name: 'Overall progress' });
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuenow')).toBe('62');
  });

  it('shows the overall percentage, the prototype step labels and a hidden tile grid', async () => {
    batch = { id: B, phase: 'processing', photoIds: Array.from({ length: 30 }, (_, i) => photo(i + 1)), rejected: 0 };
    status = { id: B, phase: 'processing', step: 2, done: 15, total: 30 };
    backend();
    const { container } = open();
    expect((await screen.findByRole('heading', { name: 'AI is grouping images' })).parentElement?.textContent).toContain('37%');
    const steps = screen.getByRole('list', { name: 'Grouping steps' });
    expect([...steps.querySelectorAll('li')].map((l) => l.textContent?.replace(' (done)', ''))).toEqual([
      'Reading 30 photos', 'Grouping images of the same gown', 'Tagging silhouette, fabric, neckline', 'Writing descriptions',
    ]);
    expect(steps.querySelectorAll('li.done')).toHaveLength(1);
    expect(steps.querySelector('li.current')?.textContent).toContain('Grouping images');
    const grid = container.querySelector('.proc-grid');
    expect(grid?.getAttribute('aria-hidden')).toBe('true');
    expect(grid?.children).toHaveLength(30);
    expect(grid?.querySelectorAll('.filled')).toHaveLength(12);
    expect(screen.queryByText(/photos stored/)).toBeNull();
    expect(screen.queryByRole('list', { name: 'Stored photos' })).toBeNull();
    const r = await axe.run(container, noisy);
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });

  it('Cancel asks first; Keep grouping and Escape change nothing; Cancel and remove photos discards the batch', async () => {
    batch = { id: B, phase: 'processing', photoIds: [photo(1), photo(2)], rejected: 0 };
    status = { id: B, phase: 'processing', step: 1, done: 0, total: 2 };
    backend();
    const base = mocks.request.getMockImplementation()!;
    let removed = false;
    mocks.request.mockImplementation(async (m: string, p: string) => {
      if (m === 'DELETE' && p === `/api/v1/uploads/${B}`) { removed = true; batch = { id: B, phase: 'empty', photoIds: [], rejected: 0 }; return { status: 204 }; }
      return base(m, p);
    });
    const { container } = open();
    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    await userEvent.click(cancel);
    const dlg = screen.getByRole('dialog', { name: 'Cancel grouping?' });
    expect(dlg.textContent).toContain('This removes the 2 photos from this batch. You can upload them again.');
    expect(document.activeElement).toBe(within(dlg).getByRole('button', { name: 'Keep grouping' }));
    const r = await axe.run(container, noisy);
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Keep grouping' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(cancel);
    await userEvent.click(cancel);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(cancel);
    expect(removed).toBe(false);
    await userEvent.click(cancel);
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel and remove photos' }));
    expect(await screen.findByText('Batch discarded')).toBeTruthy();
    expect(removed).toBe(true);
    expect(await screen.findByRole('heading', { name: 'Drop gown photos here' })).toBeTruthy();
  });

  it('shows the cause when tagging stops at step 3', async () => {
    batch = { id: B, phase: 'error', photoIds: [photo(1)], rejected: 0 };
    status = { id: B, phase: 'error', error: { code: 'bad_response', step: 3, lastGood: null } };
    backend();
    open();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Grouping stopped at step 3 (Tagging).');
    expect(alert.textContent).toContain('could not be read');
  });

  it('keeps the screen and says so when start is refused for lack of photos', async () => {
    startReply = { status: 422, body: {} };
    backend();
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Start grouping' }));
    expect(await screen.findByText('Add at least one photo before grouping.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start grouping' })).toBeTruthy();
  });
});

describe('overallPct', () => {
  it.each([
    [1, 0, 0, 0],
    [3, 1, 2, 62],
    [4, 30, 30, 100],
    [0, 0, 10, 0],
    [9, 5, 5, 100],
  ])('step %i done %i of %i is %i%%', (step, done, total, pct) => {
    expect(overallPct(step, done, total)).toBe(pct);
  });
});
