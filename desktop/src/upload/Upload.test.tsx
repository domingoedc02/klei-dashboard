import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadEvent, UploadKind, UploadSummary } from '../bridge';
import { thumbUrl } from '../platform';
import { Shell } from '../shell/Shell';
import type { Me } from '../shell/context';

const mocks = vi.hoisted(() => ({ request: vi.fn(), setDirty: vi.fn(), uploadFiles: vi.fn() }));
vi.mock('../bridge', async (orig) => ({ ...(await orig<typeof import('../bridge')>()), bridge: mocks }));

const B = '0b1c2d3e-0000-4000-8000-000000000001';
const photo = (n: number) => `0b1c2d3e-0000-4000-8000-${String(n).padStart(12, '0')}`;
const STAFF: Me = { id: 's1', name: 'Sam Staff', email: 'sam@example.test', role: 'Staff', permissions: ['PERM_UPLOAD_IMAGES'] };
const VIEWER: Me = { id: 'v1', name: 'Vi Viewer', email: 'vi@example.test', role: 'Viewer', permissions: ['PERM_VIEW_GALLERY'] };
const summary = (over: Partial<UploadSummary> = {}): UploadSummary => ({ stored: [], rejected: [], cancelled: false, ...over });

let watcher: ((e: UploadEvent) => void) | undefined;
let runs: ((kind: UploadKind, onEvent?: (e: UploadEvent) => void) => Promise<UploadSummary>) | undefined;

function backend(current: { status: number; body?: unknown } = { status: 200, body: { id: B, phase: 'empty', photoIds: [], rejected: 0 } }) {
  mocks.request.mockImplementation(async (m: string, p: string) => {
    if (p === '/api/v1/uploads/current') return current;
    if (m === 'POST' && p === '/api/v1/uploads') return { status: 200, body: { id: B, phase: 'empty', photoIds: [], rejected: 0 } };
    if (m === 'DELETE' && p.includes('/photos/')) return { status: 204 };
    return { status: 200, body: null };
  });
  mocks.uploadFiles.mockImplementation(async (kind: UploadKind, _id: string, onEvent?: (e: UploadEvent) => void) => {
    if (kind === 'watch') watcher = onEvent;
    if (kind === 'photo' || kind === 'dropped') return runs ? runs(kind, onEvent) : summary();
    return summary();
  });
}

async function open(me = STAFF) {
  window.location.hash = '#/upload';
  const v = render(<Shell me={me} onExpired={vi.fn()} onSignOut={vi.fn()} />);
  return v;
}

const noisy = { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.setDirty.mockResolvedValue(undefined);
  watcher = undefined;
  runs = undefined;
});

describe('Upload screen', () => {
  it('shows the drop zone with the rule text and passes axe', async () => {
    backend();
    const { container } = await open();
    expect(await screen.findByRole('heading', { name: 'Drop gown photos here' })).toBeTruthy();
    expect(screen.getByText('JPG, PNG or WebP up to 25 MB each. Upload up to 200 at once and AI groups them.')).toBeTruthy();
    expect(document.querySelector('.dropzone img.illo')).toBeTruthy();
    expect(screen.getByText('Drop photos. AI groups the same gown, tags it, and drafts a description.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose photos' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /start grouping/i })).toBeNull();
    const r = await axe.run(container, noisy);
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });

  it('creates the batch when there is none', async () => {
    backend({ status: 404 });
    await open();
    await screen.findByRole('heading', { name: 'Drop gown photos here' });
    expect(mocks.request).toHaveBeenCalledWith('POST', '/api/v1/uploads', undefined, undefined, undefined);
  });

  it('restores stored photos as a count and a thumbnail strip', async () => {
    backend({ status: 200, body: { id: B, phase: 'empty', photoIds: [photo(1), photo(2)], rejected: 0 } });
    const { container } = await open();
    expect(await screen.findByText('2 of 200 photos stored')).toBeTruthy();
    const strip = screen.getByRole('list', { name: 'Stored photos' });
    const imgs = within(strip).getAllByRole('img');
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual([thumbUrl(B, photo(1)), thumbUrl(B, photo(2))]);
    expect(imgs[0].getAttribute('alt')).toBe('Photo 1');
    const r = await axe.run(container, noisy);
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });

  it('removes one stored photo with its close button', async () => {
    backend({ status: 200, body: { id: B, phase: 'empty', photoIds: [photo(1), photo(2)], rejected: 0 } });
    await open();
    await screen.findByText('2 of 200 photos stored');
    await userEvent.click(screen.getByRole('button', { name: 'Remove photo 1' }));
    expect(mocks.request).toHaveBeenCalledWith('DELETE', `/api/v1/uploads/${B}/photos/${photo(1)}`, undefined, undefined, undefined);
    expect(await screen.findByText('1 of 200 photos stored')).toBeTruthy();
    const imgs = within(screen.getByRole('list', { name: 'Stored photos' })).getAllByRole('img');
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual([thumbUrl(B, photo(2))]);
  });

  it('keeps the photo and says why when removal is refused', async () => {
    backend({ status: 200, body: { id: B, phase: 'empty', photoIds: [photo(1)], rejected: 0 } });
    const base = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (m: string, p: string, ...rest: unknown[]) =>
      m === 'DELETE' ? { status: 409 } : base(m, p, ...rest));
    await open();
    await screen.findByText('1 of 200 photos stored');
    await userEvent.click(screen.getByRole('button', { name: 'Remove photo 1' }));
    expect(await screen.findByText('1 of 200 photos stored')).toBeTruthy();
    expect(mocks.request.mock.calls.filter(([m]) => m === 'DELETE')).toHaveLength(1);
  });

  it('shows progress, then the stored photos and one line per rejected file', async () => {
    backend();
    let finish!: (s: UploadSummary) => void;
    runs = (_k, onEvent) => {
      onEvent?.({ type: 'progress', done: 1, total: 3, waiting: false, photoId: photo(7) });
      return new Promise((res) => { finish = res; });
    };
    await open();
    await userEvent.click(await screen.findByRole('button', { name: 'Choose photos' }));
    expect(await screen.findByText('Uploading 1 of 3')).toBeTruthy();
    expect(mocks.setDirty).toHaveBeenCalledWith(true);
    expect((screen.getByRole('button', { name: 'Choose photos' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('progressbar', { name: 'Upload progress' })).toBeTruthy();

    await act(async () => finish(summary({
      stored: [photo(7), photo(8)],
      rejected: [
        { name: 'a.gif', reason: 'type' }, { name: 'b.png', reason: 'size' }, { name: 'c.jpg', reason: 'full' },
        { name: 'd.jpg', reason: 'dimensions' }, { name: 'e.jpg', reason: 'unreadable' },
      ],
    })));
    const list = await screen.findByRole('list', { name: 'Files not uploaded' });
    const lines = within(list).getAllByRole('listitem').map((l) => l.textContent);
    expect(lines).toEqual([
      'a.gif Not a JPEG, PNG or WebP',
      'b.png Over 25 MB',
      'c.jpg Batch is full: 200 photos',
      'd.jpg Image is too large: over 40 megapixels',
      "e.jpg Couldn't read the file",
    ]);
    expect(screen.getByText('2 of 200 photos stored')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('5 files couldn’t be uploaded.');
    expect(mocks.setDirty).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Retry upload' }));
    expect(screen.queryByRole('list', { name: 'Files not uploaded' })).toBeNull();
  });

  it('summarises three rejections, passes axe, and Retry upload clears the list and opens the picker', async () => {
    backend();
    const rejected = [{ name: 'a.gif', reason: 'type' }, { name: 'b.png', reason: 'size' }, { name: 'e.jpg', reason: 'unreadable' }] as const;
    runs = (_k) => Promise.resolve(summary({ rejected: [...rejected] }));
    const { container } = await open();
    await userEvent.click(await screen.findByRole('button', { name: 'Choose photos' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('3 files couldn’t be uploaded.');
    expect(alert.textContent).toContain('Remove them or convert to JPG or PNG, then retry.');
    expect(alert.compareDocumentPosition(container.querySelector('.dropzone')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Files not uploaded' })).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    const r = await axe.run(container, noisy);
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    runs = () => Promise.resolve(summary());
    const picks = mocks.uploadFiles.mock.calls.filter((c) => c[0] === 'photo').length;
    await userEvent.click(screen.getByRole('button', { name: 'Retry upload' }));
    expect(mocks.uploadFiles.mock.calls.filter((c) => c[0] === 'photo')).toHaveLength(picks + 1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says "1 file" and offers no Retry upload when the only rejection is a full batch', async () => {
    backend();
    runs = () => Promise.resolve(summary({ rejected: [{ name: 'c.jpg', reason: 'full' }] }));
    await open();
    await userEvent.click(await screen.findByRole('button', { name: 'Choose photos' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('1 file couldn’t be uploaded.');
    expect(alert.textContent).not.toContain('Remove them or convert');
    expect(screen.queryByRole('button', { name: 'Retry upload' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Choose photos' })).toBeTruthy();
  });

  it('Cancel asks the shell to stop and the stored photos stay', async () => {
    backend();
    let finish!: (s: UploadSummary) => void;
    runs = (_k, onEvent) => {
      onEvent?.({ type: 'progress', done: 1, total: 4, waiting: false, photoId: photo(3) });
      return new Promise((res) => { finish = res; });
    };
    await open();
    await userEvent.click(await screen.findByRole('button', { name: 'Choose photos' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(mocks.uploadFiles).toHaveBeenCalledWith('cancel', B);
    await act(async () => finish(summary({ stored: [photo(3)], cancelled: true })));
    expect(await screen.findByText('1 of 200 photos stored')).toBeTruthy();
    expect(screen.getByText('Cancelled. 1 stored photo is kept.')).toBeTruthy();
  });

  it('says it is waiting while the connection is down', async () => {
    backend();
    let finish!: (s: UploadSummary) => void;
    runs = (_k, onEvent) => {
      onEvent?.({ type: 'progress', done: 0, total: 2, waiting: true, photoId: null });
      return new Promise((res) => { finish = res; });
    };
    await open();
    await userEvent.click(await screen.findByRole('button', { name: 'Choose photos' }));
    expect((await screen.findByRole('status', { name: '' })).textContent).toContain('Waiting for the connection');
    await act(async () => finish(summary()));
  });

  it('highlights the zone while files are dragged over and sends a drop', async () => {
    backend();
    runs = async () => summary({ stored: [photo(9)] });
    await open();
    await screen.findByRole('heading', { name: 'Drop gown photos here' });
    await act(async () => watcher?.({ type: 'drag', over: true }));
    expect(document.querySelector('.dropzone.over')).not.toBeNull();
    await act(async () => watcher?.({ type: 'dropped', count: 1 }));
    expect(document.querySelector('.dropzone.over')).toBeNull();
    expect(await screen.findByText('1 of 200 photos stored')).toBeTruthy();
    expect(mocks.uploadFiles).toHaveBeenCalledWith('dropped', B, expect.any(Function));
  });

  it('stops listening for drops when the screen is left', async () => {
    backend();
    const { unmount } = await open();
    await screen.findByRole('heading', { name: 'Drop gown photos here' });
    unmount();
    expect(mocks.uploadFiles.mock.calls.map((c) => c[0])).toContain('unwatch');
  });

  it('keeps stored photos and says so when the run fails', async () => {
    backend();
    runs = async () => { throw { kind: 'failed', message: 'x' }; };
    await open();
    await userEvent.click(await screen.findByRole('button', { name: 'Choose photos' }));
    expect(await screen.findByText('Upload stopped. Photos already stored are kept.')).toBeTruthy();
    expect(mocks.setDirty).toHaveBeenLastCalledWith(false);
  });

  it('offers Retry when the batch cannot be loaded', async () => {
    mocks.request.mockResolvedValue({ status: 500, body: null });
    mocks.uploadFiles.mockResolvedValue(summary());
    await open();
    expect(await screen.findByText("Couldn't load the upload batch.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('shows the forbidden view to a Viewer', async () => {
    backend();
    await open(VIEWER);
    expect(await screen.findByRole('heading', { name: "You don't have access" })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Drop gown photos here' })).toBeNull();
  });
});

describe('thumbUrl', () => {
  it('uses the localhost host name on Windows only', () => {
    expect(thumbUrl('b', 'p', 'Mozilla/5.0 (Windows NT 10.0)')).toBe('http://klei-img.localhost/b/p');
    expect(thumbUrl('b', 'p', 'Mozilla/5.0 (Macintosh)')).toBe('klei-img://localhost/b/p');
  });
});
