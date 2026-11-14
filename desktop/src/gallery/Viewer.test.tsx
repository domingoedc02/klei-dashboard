import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from '../shell/Shell';
import type { Me } from '../shell/context';
import { forgetGallery, recall, remember, NONE } from './memory';

const mocks = vi.hoisted(() => ({ request: vi.fn(), setDirty: vi.fn(), exportGowns: vi.fn() }));
vi.mock('../bridge', async (orig) => ({ ...(await orig<typeof import('../bridge')>()), bridge: mocks }));

const id = (n: number) => `0b1c2d3e-0000-4000-8000-${String(n).padStart(12, '0')}`;
const VIEWER: Me = { id: 'v1', name: 'Vic Viewer', email: 'vic@example.test', role: 'Viewer', permissions: ['PERM_VIEW_GALLERY'] };
const ADMIN: Me = { id: 'a1', name: 'Ada Admin', email: 'ada@example.test', role: 'Admin', permissions: ['PERM_VIEW_GALLERY', 'PERM_EDIT_GOWN', 'PERM_DELETE_GOWN'] };
const STAFF: Me = { id: 's1', name: 'Sam Staff', email: 'sam@example.test', role: 'Staff', permissions: ['PERM_VIEW_GALLERY', 'PERM_EDIT_GOWN'] };
const TAXONOMY = {
  groups: [
    { type: 'silhouette', values: [{ id: 't1', value: 'A-line' }, { id: 't2', value: 'Mermaid' }] },
    { type: 'fabric', values: [{ id: 't3', value: 'Lace' }, { id: 't4', value: 'Tulle' }, { id: 't5', value: 'Satin' }] },
  ],
};
const noisy = { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } };

const detail = (over: Record<string, unknown> = {}) => ({
  id: id(1), name: 'Willow', description: 'A fitted lace gown.', confidence: 92, band: 'high', photoCount: 3, version: 0,
  addedAt: '2026-11-01T10:00:00Z',
  photos: [{ id: id(11), size: 10 }, { id: id(12), size: 10 }, { id: id(13), size: 10 }],
  attributes: [{ type: 'silhouette', values: ['A-line'] }, { type: 'fabric', values: ['Lace', 'Tulle'] }],
  ...over,
});

let answer: () => { status: number; body?: unknown };
let patched: () => { status: number; body?: unknown };

beforeEach(() => {
  vi.resetAllMocks();
  forgetGallery();
  answer = () => ({ status: 200, body: detail() });
  patched = () => ({ status: 200, body: detail({ name: 'Willow Rose', version: 1 }) });
  mocks.setDirty.mockResolvedValue(undefined);
  mocks.request.mockImplementation(async (m: string, p: string) => {
    if (p === `/api/v1/gowns/${id(1)}`) return m === 'GET' ? answer() : patched();
    if (p === '/api/v1/taxonomy') return { status: 200, body: TAXONOMY };
    return { status: 200, body: null };
  });
});

const open = async (to = id(1), me: Me = VIEWER) => {
  window.location.hash = `#/gallery/${to}`;
  return render(<Shell me={me} onExpired={vi.fn()} onSignOut={vi.fn()} />);
};
const patches = () => mocks.request.mock.calls.filter((c) => c[0] === 'PATCH');
const stage = () => document.querySelector<HTMLImageElement>('.stage img');

describe('Gown viewer', () => {
  it('shows the name, tags by type, counts, confidence and the first photo at full size', async () => {
    await open();
    expect(await screen.findByRole('heading', { level: 1, name: 'Willow' })).toBeTruthy();
    const side = within(screen.getByRole('complementary', { name: 'Details' }));
    expect(side.getByText('Silhouette')).toBeTruthy();
    expect(side.getByText('A-line')).toBeTruthy();
    expect(side.getByText('Lace, Tulle')).toBeTruthy();
    expect(side.getByText('92%')).toBeTruthy();
    expect(side.getByText('High')).toBeTruthy();
    expect(side.getByText('A fitted lace gown.')).toBeTruthy();
    expect(screen.getByText('1 of 3')).toBeTruthy();
    expect(stage()!.src).toContain(`/g/${id(1)}/${id(11)}/full`);
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'Gallery' }).getAttribute('href')).toBe('#/gallery');
    expect(screen.queryByRole('button', { name: /edit|delete/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy description' })).toBeTruthy();
    expect(side.getByText('Neckline').nextElementSibling!.textContent).toBe('None');
    expect(side.getByText('Train').nextElementSibling!.textContent).toBe('None');
    expect(side.getByText('Fabric').nextElementSibling!.textContent).toBe('Lace, Tulle');
    expect(side.getByRole('heading', { level: 2, name: 'Description' })).toBeTruthy();
    expect(document.querySelector('.crumb')!.textContent).toContain('Gallery');
    expect(screen.getByRole('button', { name: 'Download .zip' })).toBeTruthy();
  });

  it('steps with the buttons, the strip and the arrow keys, and stops at both ends', async () => {
    const user = userEvent.setup();
    await open();
    await screen.findByText('1 of 3');
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('2 of 3')).toBeTruthy();
    expect(stage()!.src).toContain(id(12));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByText('3 of 3')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
    await user.keyboard('{ArrowRight}');
    expect(screen.getByText('3 of 3')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Show photo 1 of 3' }));
    expect(screen.getByText('1 of 3')).toBeTruthy();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByText('1 of 3')).toBeTruthy();
  });

  it('copies the description and says so', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await open();
    await user.click(await screen.findByRole('button', { name: 'Copy description' }));
    expect(writeText).toHaveBeenCalledWith('A fitted lace gown.');
    expect(await screen.findByText('Description copied')).toBeTruthy();
  });

  it('a photo that will not load offers Retry that asks again', async () => {
    const user = userEvent.setup();
    await open();
    await screen.findByText('1 of 3');
    stage()!.dispatchEvent(new Event('error'));
    expect(await screen.findByText("This photo couldn't be loaded.")).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(stage()!.src).toContain('r=1'));
  });

  it('shows a grey tile and skeleton details while loading', async () => {
    let release: (v: unknown) => void = () => undefined;
    const held = new Promise((r) => { release = r; });
    answer = (() => held) as never;
    mocks.request.mockImplementation(async (_m: string, p: string) => (p === `/api/v1/gowns/${id(1)}` ? held : { status: 200, body: { groups: [] } }));
    await open();
    expect(document.querySelector('.stage.skeleton')).toBeTruthy();
    expect(document.querySelector('.details.skeleton')).toBeTruthy();
    release({ status: 200, body: detail() });
    expect(await screen.findByRole('heading', { level: 1, name: 'Willow' })).toBeTruthy();
  });

  it('a failed read keeps the breadcrumb and retries; a missing Gown says so', async () => {
    const user = userEvent.setup();
    answer = () => ({ status: 500 });
    await open();
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
    answer = () => ({ status: 200, body: detail() });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Willow' })).toBeTruthy();
    mocks.request.mockImplementation(async () => ({ status: 404 }));
    window.location.hash = `#/gallery/${id(9)}`;
    expect(await screen.findByText('This gown no longer exists')).toBeTruthy();
  });

  it('a Gown without photos or description says so, with no stage controls', async () => {
    answer = () => ({ status: 200, body: detail({ photos: [], photoCount: 0, description: null, attributes: [] }) });
    await open();
    expect(await screen.findByText('This gown has no photos.')).toBeTruthy();
    expect(screen.getByText('No description yet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy description' })).toBeNull();
  });

  it('Full view opens a lightbox on the same photo; arrows step it, Esc closes it and returns focus, the route stays', async () => {
    const user = userEvent.setup();
    const { container } = await open();
    await screen.findByText('1 of 3');
    const opener = screen.getByRole('button', { name: 'Full view' });
    await user.click(opener);
    const box = screen.getByRole('dialog', { name: 'Photo 1 of 3' });
    expect(document.activeElement).toBe(within(box).getByRole('button', { name: 'Close' }));
    expect((within(box).getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true);
    const r = await axe.run(container, noisy);
    expect(r.violations.map((v) => v.id)).toEqual([]);
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('dialog', { name: 'Photo 2 of 3' })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(window.location.hash).toBe(`#/gallery/${id(1)}`);
    expect(screen.getByText('2 of 3')).toBeTruthy();
  });

  it('has no accessibility violations', async () => {
    const { container } = await open();
    await screen.findByRole('heading', { level: 1, name: 'Willow' });
    const r = await axe.run(container, noisy);
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });
});

describe('Download a gown', () => {
  it('starts the shell download for this one gown and says so when it is saved', async () => {
    const user = userEvent.setup();
    mocks.exportGowns.mockResolvedValue({ gowns: 1, photos: 3, cancelled: false });
    await open();
    await user.click(await screen.findByRole('button', { name: 'Download .zip' }));
    expect(mocks.exportGowns).toHaveBeenCalledWith('start', [id(1)], expect.any(Function));
    expect(await screen.findByText('Download saved')).toBeTruthy();
  });

  it('a dismissed save dialog says nothing; a failure says to try again', async () => {
    const user = userEvent.setup();
    mocks.exportGowns.mockResolvedValueOnce({ gowns: 0, photos: 0, cancelled: true });
    await open();
    await user.click(await screen.findByRole('button', { name: 'Download .zip' }));
    await waitFor(() => expect(mocks.exportGowns).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Download saved')).toBeNull();
    mocks.exportGowns.mockRejectedValueOnce({ kind: 'failed', message: 'x' });
    await user.click(screen.getByRole('button', { name: 'Download .zip' }));
    expect(await screen.findByText('Download failed. Try again.')).toBeTruthy();
  });

  it('shows progress with Cancel while it runs, and Cancel asks the shell to stop', async () => {
    const user = userEvent.setup();
    let finish: (v: unknown) => void = () => undefined;
    mocks.exportGowns.mockImplementation((kind: string, _ids: string[], on?: (e: unknown) => void) => {
      if (kind === 'cancel') return Promise.resolve({ gowns: 0, photos: 0, cancelled: true });
      on?.({ done: 0, total: 1 });
      return new Promise((r) => { finish = r; });
    });
    await open();
    await user.click(await screen.findByRole('button', { name: 'Download .zip' }));
    expect(await screen.findByRole('progressbar', { name: 'Download progress' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Download .zip' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Cancel download' }));
    expect(mocks.exportGowns).toHaveBeenCalledWith('cancel', []);
    finish({ gowns: 0, photos: 0, cancelled: true });
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
  });
});

describe('Edit a gown', () => {
  const dialog = () => screen.findByRole('dialog', { name: 'Edit gown' });

  it('offers Edit only to someone who may edit gowns', async () => {
    await open(id(1), STAFF);
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeTruthy();
  });

  it('opens with the current values, saves name, tags and description with the version, and updates the details without reloading', async () => {
    const user = userEvent.setup();
    remember('s1', NONE, { items: [], next: null, total: 0, matching: 0 });
    await open(id(1), STAFF);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const d = within(await dialog());
    expect((d.getByLabelText('Name') as HTMLInputElement).value).toBe('Willow');
    expect((d.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('A fitted lace gown.');
    expect(d.getByRole('list', { name: 'Fabric tags' }).textContent).toContain('Tulle');
    await user.clear(d.getByLabelText('Name'));
    await user.type(d.getByLabelText('Name'), 'Willow Rose');
    await user.click(d.getByRole('button', { name: 'Remove Tulle from Fabric' }));
    await user.selectOptions(d.getByLabelText('Fabric'), 'Satin');
    await user.click(d.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Gown updated')).toBeTruthy();
    expect(patches()).toHaveLength(1);
    const [, path, body, version] = patches()[0];
    expect(path).toBe(`/api/v1/gowns/${id(1)}`);
    expect(version).toBe(0);
    expect(body).toEqual({
      name: 'Willow Rose', description: 'A fitted lace gown.',
      attributes: expect.arrayContaining([{ type: 'silhouette', value: 'A-line' }, { type: 'fabric', value: 'Lace' }, { type: 'fabric', value: 'Satin' }]),
    });
    expect((body as { attributes: unknown[] }).attributes).toHaveLength(3);
    expect(await screen.findByRole('heading', { level: 1, name: 'Willow Rose' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.request.mock.calls.filter((c) => c[0] === 'GET' && c[1] === `/api/v1/gowns/${id(1)}`)).toHaveLength(1);
    expect(recall('s1')).toBeNull();
  });

  it('refuses an empty name without calling the server', async () => {
    const user = userEvent.setup();
    await open(id(1), STAFF);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const d = within(await dialog());
    await user.clear(d.getByLabelText('Name'));
    await user.click(d.getByRole('button', { name: 'Save changes' }));
    expect(d.getByText('Name is required')).toBeTruthy();
    expect(patches()).toHaveLength(0);
  });

  it('names a field the server rejects and keeps the dialog open', async () => {
    const user = userEvent.setup();
    patched = () => ({ status: 422, body: { fields: [{ field: 'attributes', code: 'invalid' }] } });
    await open(id(1), STAFF);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const d = within(await dialog());
    await user.type(d.getByLabelText('Name'), '!');
    await user.click(d.getByRole('button', { name: 'Save changes' }));
    expect(await d.findByText('A tag is no longer in the tag taxonomy. Remove it to save.')).toBeTruthy();
    expect((d.getByLabelText('Name') as HTMLInputElement).value).toBe('Willow!');
  });

  it('a conflict keeps the typed text, offers Reload, and Reload reads the Gown again', async () => {
    const user = userEvent.setup();
    patched = () => ({ status: 409 });
    await open(id(1), STAFF);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const d = within(await dialog());
    await user.type(d.getByLabelText('Description'), ' More.');
    await user.click(d.getByRole('button', { name: 'Save changes' }));
    expect(await d.findByText(/This gown changed while you were editing\. Reload to see the latest\./)).toBeTruthy();
    expect((d.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('A fitted lace gown. More.');
    expect((d.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true);
    answer = () => ({ status: 200, body: detail({ name: 'Elsewhere', version: 3 }) });
    await user.click(d.getByRole('button', { name: 'Reload' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Elsewhere' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a failed save keeps the text here and lets the person try again', async () => {
    const user = userEvent.setup();
    patched = () => ({ status: 500 });
    await open(id(1), STAFF);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const d = within(await dialog());
    await user.type(d.getByLabelText('Name'), '!');
    await user.click(d.getByRole('button', { name: 'Save changes' }));
    expect(await d.findByText("Couldn't save. Your changes are kept here.")).toBeTruthy();
    patched = () => ({ status: 200, body: detail({ name: 'Willow!', version: 1 }) });
    await user.click(d.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Gown updated')).toBeTruthy();
  });

  it('Esc or Cancel with no changes closes at once; with changes it asks, and Keep editing keeps them', async () => {
    const user = userEvent.setup();
    await open(id(1), STAFF);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await dialog();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const d = within(await dialog());
    await user.type(d.getByLabelText('Name'), '!');
    expect(mocks.setDirty).toHaveBeenLastCalledWith(true);
    await user.keyboard('{Escape}');
    expect(await d.findByText('Discard changes?')).toBeTruthy();
    await user.click(d.getByRole('button', { name: 'Keep editing' }));
    expect((d.getByLabelText('Name') as HTMLInputElement).value).toBe('Willow!');
    await user.click(d.getByRole('button', { name: 'Cancel' }));
    await user.click(d.getByRole('button', { name: 'Discard' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.setDirty).toHaveBeenLastCalledWith(false);
    expect(patches()).toHaveLength(0);
    expect(screen.getByRole('heading', { level: 1, name: 'Willow' })).toBeTruthy();
  });

  it('the dialog has no accessibility violations', async () => {
    const user = userEvent.setup();
    await open(id(1), STAFF);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const d = await dialog();
    await within(d).findByLabelText('Silhouette');
    const r = await axe.run(d, noisy);
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });
});

describe('Delete a gown', () => {
  const deletes = () => mocks.request.mock.calls.filter((c) => c[0] === 'POST' && c[1] === '/api/v1/gowns/delete');

  it('offers Delete only to someone who may delete gowns', async () => {
    await open(id(1), STAFF);
    await screen.findByRole('button', { name: 'Edit' });
    expect(screen.queryByRole('button', { name: 'Delete folder' })).toBeNull();
  });

  it('asks first, then deletes this gown, forgets the gallery and goes back to it', async () => {
    const user = userEvent.setup();
    remember('a1', NONE, { items: [], next: null, total: 1, matching: 1 });
    mocks.request.mockImplementation(async (_m: string, p: string) => {
      if (p === '/api/v1/gowns/delete') return { status: 200, body: { deleted: 1, missing: [] } };
      return p === `/api/v1/gowns/${id(1)}` ? answer() : { status: 200, body: p === '/api/v1/taxonomy' ? TAXONOMY : null };
    });
    await open(id(1), ADMIN);
    await user.click(await screen.findByRole('button', { name: 'Delete folder' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete “Willow”?' });
    expect(within(dialog).getByText('This removes the folder and its 3 photos from Gallery. This can’t be undone.')).toBeTruthy();
    expect(deletes()).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Delete folder' }));
    expect(await screen.findByText('Folder deleted')).toBeTruthy();
    expect(deletes()[0][2]).toEqual({ ids: [id(1)] });
    expect(window.location.hash).toBe('#/gallery');
    expect(recall('a1')).toBeNull();
  });

  it('a failure says to try again and stays on the gown', async () => {
    const user = userEvent.setup();
    mocks.request.mockImplementation(async (_m: string, p: string) => {
      if (p === '/api/v1/gowns/delete') return { status: 500, body: null };
      return p === `/api/v1/gowns/${id(1)}` ? answer() : { status: 200, body: null };
    });
    await open(id(1), ADMIN);
    await user.click(await screen.findByRole('button', { name: 'Delete folder' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Delete “Willow”?' })).getByRole('button', { name: 'Delete folder' }));
    expect(await screen.findByText("Couldn't delete the gowns. Try again.")).toBeTruthy();
    expect(window.location.hash).toBe(`#/gallery/${id(1)}`);
  });
});

