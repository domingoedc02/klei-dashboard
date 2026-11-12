import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from '../shell/Shell';
import type { Me } from '../shell/context';

const mocks = vi.hoisted(() => ({ request: vi.fn(), setDirty: vi.fn(), uploadFiles: vi.fn() }));
vi.mock('../bridge', async (orig) => ({ ...(await orig<typeof import('../bridge')>()), bridge: mocks }));

const B = '0b1c2d3e-0000-4000-8000-000000000001';
const photo = (n: number) => `0b1c2d3e-0000-4000-8000-${String(n).padStart(12, '0')}`;
const STAFF: Me = { id: 's1', name: 'Sam Staff', email: 'sam@example.test', role: 'Staff', permissions: ['PERM_UPLOAD_IMAGES'] };
const noisy = { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } };
const TAX = {
  groups: [
    { type: 'silhouette', values: [{ id: 't1', value: 'A-line' }, { id: 't2', value: 'Mermaid' }] },
    { type: 'fabric', values: [{ id: 't3', value: 'Lace' }, { id: 't4', value: 'Mikado' }] },
  ],
};

type Reply = { status: number; body?: unknown };
type Sent = { method: string; path: string; body?: Record<string, unknown> };
// Every write (anything but GET). Staged edits must leave this empty.
let sent: Sent[];
let commitReply: () => Reply | Promise<Reply>;
let rewriteReply: () => Reply | Promise<Reply>;
let currentLoads: number;
let served: () => ReturnType<typeof groups>;

const groups = () => [
  { id: 'g1', name: 'Group 1', confidence: 40, band: 'low', position: 0, photoIds: [photo(1), photo(3)], tags: [], description: '', version: 3 },
  { id: 'g2', name: 'Group 2', confidence: 95, band: 'high', position: 1, photoIds: [photo(2)], tags: [{ type: 'fabric', value: 'Lace' }], description: 'A soft lace gown.', version: 5 },
];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.setDirty.mockResolvedValue(undefined);
  mocks.uploadFiles.mockResolvedValue({ stored: [], rejected: [], cancelled: false });
  sent = [];
  currentLoads = 0;
  served = groups;
  commitReply = () => ({ status: 200, body: { saved: 2 } });
  rewriteReply = () => ({ status: 200, body: { description: 'A fresh description.' } });
  mocks.request.mockImplementation(async (m: string, p: string, body?: Record<string, unknown>) => {
    if (p === '/api/v1/uploads/current') {
      currentLoads++;
      return { status: 200, body: { id: B, phase: 'review', photoIds: [photo(1), photo(2), photo(3)], rejected: 0 } };
    }
    if (m === 'GET' && p === `/api/v1/uploads/${B}`) return { status: 200, body: { id: B, phase: 'review', groups: served() } };
    if (p === '/api/v1/taxonomy') return { status: 200, body: TAX };
    if (m === 'GET') return { status: 200, body: null };
    sent.push({ method: m, path: p, body });
    if (m === 'POST' && p === `/api/v1/uploads/${B}/commit`) return commitReply();
    if (m === 'POST' && p.endsWith('/rewrite')) return rewriteReply();
    if (m === 'DELETE' && p === `/api/v1/uploads/${B}`) return { status: 204, body: null };
    return { status: 200, body: null };
  });
});

const open = async () => {
  window.location.hash = '#/upload';
  const view = render(<Shell me={STAFF} onExpired={vi.fn()} onSignOut={vi.fn()} />);
  await screen.findByRole('heading', { name: 'Gown groups' });
  await screen.findByRole('list', { name: 'Fabric tags' });
  return view;
};
const noViolations = async (container: HTMLElement) => {
  const r = await axe.run(container, noisy);
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
};
const pick = async (...n: number[]) => {
  for (const k of n) await userEvent.click(screen.getByRole('button', { name: `Photo ${k}` }));
};
const moveBtn = () => screen.getByRole('button', { name: /^Move( \d+)?$/ }) as HTMLButtonElement;
const mergeBtn = () => screen.getByRole('button', { name: 'Merge' }) as HTMLButtonElement;
const splitBtn = () => screen.getByRole('button', { name: 'Split into new gown' }) as HTMLButtonElement;
const discardBtn = () => screen.getByRole('button', { name: 'Discard selected' }) as HTMLButtonElement;
const moveTo = async (label: string) => {
  await userEvent.selectOptions(screen.getByLabelText('Move selected photos to'), label);
  await userEvent.click(moveBtn());
};
const mergeInto = async (label: string) => {
  await userEvent.selectOptions(screen.getByLabelText('Merge this whole gown into'), label);
  await userEvent.click(mergeBtn());
};
const names = () => [...document.querySelectorAll('.gl .name')].map((n) => n.textContent);
const undo = () => screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
const confirmButton = (n: number) => screen.getByRole('button', { name: `Confirm and save ${n} ${n === 1 ? 'gown' : 'gowns'}` });
const commits = () => sent.filter((s) => s.path.endsWith('/commit'));

describe('Review groups', () => {
  it('shows the banner, a pill and thumbnails per group, and the save bar', async () => {
    const { container } = await open();
    expect(screen.getByText(/3 photos → 2 gowns\./).closest('.banner')?.textContent).toContain('1 group with low confidence, worth a look. Nothing is saved until you confirm.');
    const rows = within(screen.getByRole('list', { name: 'Groups' })).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual(['Group 1Low · check2 photos', 'Group 2High1 photo · Lace']);
    expect(within(rows[0]).getByText('Low · check').getAttribute('title')).toBe('40% confidence');
    expect(within(rows[0]).getByText('Low · check').className).toContain('warn');
    expect(within(rows[1]).getByText('High').className).toContain('pos');
    expect(rows[0].querySelectorAll('.strip img').length).toBe(2);
    expect(rows[0].querySelector('button')?.getAttribute('aria-current')).toBe('true');
    expect(screen.getByText('2 gowns · 3 photos will be added to Gallery')).toBeTruthy();
    expect(confirmButton(2)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Discard batch' }) as HTMLButtonElement).disabled).toBe(false);
    expect(undo().disabled).toBe(true);
    await noViolations(container);
  });

  it('shows at most five thumbnails per group', async () => {
    const many = groups();
    many[0].photoIds = [1, 2, 3, 4, 5, 6, 7].map(photo);
    served = () => many;
    await open();
    expect(document.querySelectorAll('.rv-list li')[0].querySelectorAll('.strip img').length).toBe(5);
    expect(screen.getByText('7 photos')).toBeTruthy();
  });

  it('says all groups look confident when none is low', async () => {
    const g = groups();
    g[0].band = 'high';
    served = () => g;
    await open();
    expect(screen.getByText(/All groups look confident\. Nothing is saved until you confirm\./)).toBeTruthy();
  });

  it('shows the selected group in the editor', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: /Group 2/ }));
    expect((screen.getByLabelText(/^Gown name/) as HTMLInputElement).value).toBe('Group 2');
    expect((screen.getByLabelText('AI-written description') as HTMLTextAreaElement).value).toBe('A soft lace gown.');
    expect(within(await screen.findByRole('list', { name: 'Fabric tags' })).getByText('Lace')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Group 2/ }).getAttribute('aria-current')).toBe('true');
  });

  it('opens a photo large, says when it cannot be loaded, retries, and Esc returns focus', async () => {
    await open();
    const opener = screen.getByRole('button', { name: 'Open photo 2 of 2' });
    await userEvent.click(opener);
    const box = screen.getByRole('dialog', { name: 'Photo 2 of 2' });
    const img = within(box).getByAltText('Photo 2 of 2');
    expect(img.getAttribute('src')).toContain(`${B}/${photo(3)}/full`);
    fireEvent.error(img);
    expect((await within(box).findByRole('alert')).textContent).toContain("This photo couldn't be loaded.");
    await userEvent.click(within(box).getByRole('button', { name: 'Retry' }));
    expect(within(box).getByAltText('Photo 2 of 2').getAttribute('src')).toContain('?r=1');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Photo 2 of 2' })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('steps through the photos with Previous, Next and the arrow keys', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Open photo 1 of 2' }));
    const box = screen.getByRole('dialog', { name: 'Photo 1 of 2' });
    expect((within(box).getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(within(box).getByRole('button', { name: 'Next' }));
    expect(within(screen.getByRole('dialog', { name: 'Photo 2 of 2' })).getByAltText('Photo 2 of 2').getAttribute('src')).toContain(photo(3));
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('dialog', { name: 'Photo 1 of 2' })).toBeTruthy();
  });

  it('shows the description count and no missing-tag hint', async () => {
    await open();
    expect(screen.getByText('0 / 2,000')).toBeTruthy();
    expect(screen.getByText('Edit freely. Your changes are kept when you save.')).toBeTruthy();
    expect(screen.queryByText(/Missing a tag/)).toBeNull();
  });

  it('lists the photo count, silhouette and every fabric in the row meta', async () => {
    served = () => [{ ...groups()[1], photoIds: [photo(1), photo(2), photo(3)], tags: [{ type: 'silhouette', value: 'A-line' }, { type: 'fabric', value: 'Lace' }, { type: 'fabric', value: 'Mikado' }] }];
    await open();
    expect(within(screen.getByRole('list', { name: 'Groups' })).getByRole('listitem').textContent).toBe('Group 2High3 photos · A-line · Lace, Mikado');
  });
});

describe('Staged edits', () => {
  it('rename, retag and describe send nothing, mark the screen dirty, and Undo steps back one edit at a time', async () => {
    await open();
    expect(mocks.setDirty).not.toHaveBeenCalledWith(true);
    const name = screen.getByLabelText(/^Gown name/) as HTMLInputElement;
    await userEvent.clear(name);
    await userEvent.type(name, 'Ivory Lace');
    expect(name.value).toBe('Ivory Lace');
    await waitFor(() => expect(mocks.setDirty).toHaveBeenLastCalledWith(true));
    await userEvent.selectOptions(screen.getByLabelText('Silhouette'), 'Mermaid');
    expect(within(screen.getByRole('list', { name: 'Silhouette tags' })).getByText('Mermaid')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('AI-written description'), 'Soft.');
    expect(screen.getByText('5 / 2,000')).toBeTruthy();
    expect(names()).toEqual(['Ivory Lace', 'Group 2']);
    expect(sent).toEqual([]);

    await userEvent.click(undo());
    expect((screen.getByLabelText('AI-written description') as HTMLTextAreaElement).value).toBe('');
    await userEvent.click(undo());
    expect(within(screen.getByRole('list', { name: 'Silhouette tags' })).queryByText('Mermaid')).toBeNull();
    await userEvent.click(undo());
    expect((screen.getByLabelText(/^Gown name/) as HTMLInputElement).value).toBe('Group 1');
    expect(undo().disabled).toBe(true);
    await waitFor(() => expect(mocks.setDirty).toHaveBeenLastCalledWith(false));
    expect((await screen.findAllByText('Undone')).length).toBeGreaterThan(0);
    expect(sent).toEqual([]);
  });

  it('removes a tag; Undo puts it back', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: /Group 2/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Lace from Fabric' }));
    expect(screen.queryByRole('list', { name: 'Fabric tags' })?.textContent).toBe('');
    await userEvent.click(undo());
    expect(within(screen.getByRole('list', { name: 'Fabric tags' })).getByText('Lace')).toBeTruthy();
    expect(sent).toEqual([]);
  });

  it('toggles photos with a click or Space, shows a tick, and announces the count', async () => {
    await open();
    const one = screen.getByRole('button', { name: 'Photo 1' });
    expect(one.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(one);
    expect(one.getAttribute('aria-pressed')).toBe('true');
    expect(one.querySelector('.tick svg')).not.toBeNull();
    expect(screen.getByText('1 photo selected.')).toBeTruthy();
    one.focus();
    await userEvent.keyboard(' ');
    expect(one.getAttribute('aria-pressed')).toBe('false');
    expect(one.querySelector('.tick svg')).toBeNull();
    await pick(1, 2);
    expect(screen.getByText('2 photos selected.').getAttribute('aria-live')).toBe('polite');
    expect(screen.getByRole('heading', { name: 'Photos in this group (2)' })).toBeTruthy();
    expect(screen.getByText('Select photos to move or split')).toBeTruthy();
  });

  it('the corner button opens the photo without changing the selection', async () => {
    await open();
    await pick(1);
    await userEvent.click(screen.getByRole('button', { name: 'Open photo 1 of 2' }));
    expect(screen.getByRole('dialog', { name: 'Photo 1 of 2' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Photo 1' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Photo 2' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('after an action, focus parks on the photos heading and Undo returns to the group it came from', async () => {
    await open();
    await mergeInto('Group 2');
    await waitFor(() => expect(document.activeElement?.id).toBe('g-photos'));
    expect(screen.getByRole('heading', { name: 'Photos in this group (3)' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('heading', { name: 'Photos in this group (2)' })).toBeTruthy();
    expect((screen.getByLabelText('Gown name', { exact: false }) as HTMLInputElement).value).toBe('Group 1');
  });

  it('Move, Merge, Split and Discard enable by the same rules as the prototype, with its help copy', async () => {
    const { container } = await open();
    const org = screen.getByRole('group', { name: 'Organize this group' });
    expect([moveBtn(), mergeBtn(), splitBtn(), discardBtn()].map((b) => b.disabled)).toEqual([true, true, true, true]);
    expect(within(org).getByText('Select photos above first, then choose a gown.')).toBeTruthy();
    expect(within(org).getByText('Moves all 2 photos into the gown you pick and removes this group.')).toBeTruthy();
    expect(within(org).getByText('Select photos above first. They become a separate gown.')).toBeTruthy();
    expect([...(screen.getByLabelText('Move selected photos to') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['Choose a gown…', 'Group 2']);
    await noViolations(container);

    await pick(1);
    expect(within(org).getByText('1 photo selected. Choose a gown.')).toBeTruthy();
    expect(within(org).getByText('Creates “Group 1 II” from the 1 selected.')).toBeTruthy();
    expect(moveBtn().textContent).toBe('Move 1');
    expect([moveBtn(), splitBtn(), discardBtn()].map((b) => b.disabled)).toEqual([true, false, false]);
    await userEvent.selectOptions(screen.getByLabelText('Move selected photos to'), 'Group 2');
    expect(moveBtn().disabled).toBe(false);
    await noViolations(container);

    await pick(2);
    expect(within(org).getByText('Leave at least one photo in this gown.')).toBeTruthy();
    expect([splitBtn(), discardBtn()].map((b) => b.disabled)).toEqual([true, false]);

    await userEvent.selectOptions(screen.getByLabelText('Merge this whole gown into'), 'Group 2');
    expect(mergeBtn().disabled).toBe(false);
    await noViolations(container);
  });

  it('moves the selected photos with no request, then Undo moves them back', async () => {
    await open();
    await pick(1);
    await moveTo('Group 2');
    expect(await screen.findByText('Moved 1 photo to Group 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Group 2/ }).textContent).toContain('2 photos');
    expect(screen.getByText('2 gowns · 3 photos will be added to Gallery')).toBeTruthy();
    expect(moveBtn().textContent).toBe('Move');
    expect(moveBtn().disabled).toBe(true);
    expect(sent).toEqual([]);
    await userEvent.click(undo());
    expect(screen.getByRole('button', { name: /Group 2/ }).textContent).toContain('1 photo');
    expect(screen.getByRole('button', { name: /Group 1/ }).textContent).toContain('2 photos');
  });

  it('splits the selected photos into a new gown and says to check its tags; Undo merges it back', async () => {
    await open();
    await pick(2);
    await userEvent.click(splitBtn());
    expect(await screen.findByText('Split into a new gown. Check its tags.')).toBeTruthy();
    expect(names()).toEqual(['Group 1', 'Group 1 II', 'Group 2']);
    expect((screen.getByLabelText(/^Gown name/) as HTMLInputElement).value).toBe('Group 1 II');
    expect(screen.getByLabelText('Confidence', { exact: false, selector: '[role=img]' }).getAttribute('aria-label')).toBe('AI confidence 70 percent, Low · check');
    expect(sent).toEqual([]);
    await userEvent.click(undo());
    expect(names()).toEqual(['Group 1', 'Group 2']);
  });

  it('merges the group into another, the target keeps its name; Undo splits them out again', async () => {
    await open();
    await mergeInto('Group 2');
    expect(await screen.findByText('Merged into Group 2')).toBeTruthy();
    expect(names()).toEqual(['Group 2']);
    expect(screen.getByRole('button', { name: /Group 2/ }).textContent).toContain('3 photos');
    expect(screen.getByText('1 gown · 3 photos will be added to Gallery')).toBeTruthy();
    expect(sent).toEqual([]);
    await userEvent.click(undo());
    expect(names()).toEqual(['Group 1', 'Group 2']);
  });

  it('discards the selected photos with a plain toast; the last photo takes its group; Undo restores both', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: /Group 2/ }));
    await pick(1);
    await userEvent.click(discardBtn());
    expect(await screen.findByText('Photo discarded')).toBeTruthy();
    expect(document.querySelector('.toast button.link:not([aria-label])')).toBeNull();
    expect(names()).toEqual(['Group 1']);
    expect(screen.getByText('1 gown · 2 photos will be added to Gallery')).toBeTruthy();
    expect(sent).toEqual([]);
    await userEvent.click(undo());
    expect(names()).toEqual(['Group 1', 'Group 2']);
  });

  it('shows an empty state when every photo is discarded and Confirm is off', async () => {
    await open();
    await pick(1, 2);
    await userEvent.click(discardBtn());
    expect(await screen.findByText('2 photos discarded')).toBeTruthy();
    expect(names()).toEqual(['Group 2']);
    await pick(1);
    await userEvent.click(discardBtn());
    expect(screen.getByText('No photos left. Undo the last change or discard the batch.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Confirm and save 0 gowns' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows confidence as text, a 64px meter and a pill; the meter is an image with a spoken value', async () => {
    await open();
    expect(screen.getByText('Confidence 40%')).toBeTruthy();
    const meter = screen.getByRole('img', { name: 'AI confidence 40 percent, Low · check' });
    expect(meter.className).toBe('meter gray');
    expect((meter.firstElementChild as HTMLElement).style.width).toBe('40%');
    await userEvent.click(screen.getByRole('button', { name: /Group 2/ }));
    expect(screen.getByRole('img', { name: 'AI confidence 95 percent, High' }).className).toBe('meter');
  });

  it('says there are no other gowns and disables Move and Merge when the batch has one group', async () => {
    served = () => [groups()[0]];
    await open();
    for (const l of ['Move selected photos to', 'Merge this whole gown into']) {
      const sel = screen.getByLabelText(l) as HTMLSelectElement;
      expect(sel.disabled).toBe(true);
      expect(sel.options[0].textContent).toBe('No other gowns yet');
    }
  });
});

describe('Rewrite', () => {
  it('runs one call for the group, shows busy, and stages the new description; Undo restores the old one', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: /Group 2/ }));
    let release: (r: Reply) => void = () => {};
    rewriteReply = () => new Promise((res) => { release = res; });
    await userEvent.click(screen.getByRole('button', { name: 'Rewrite' }));
    const busy = await screen.findByRole('button', { name: 'Rewriting…' });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(sent).toEqual([{ method: 'POST', path: `/api/v1/uploads/${B}/groups/g2/rewrite`, body: { photoIds: [photo(2)] } }]);
    release({ status: 200, body: { description: 'A fresh description.' } });
    await waitFor(() => expect((screen.getByLabelText('AI-written description') as HTMLTextAreaElement).value).toBe('A fresh description.'));
    expect(screen.getByRole('button', { name: 'Rewrite' })).toBeTruthy();
    expect(commits()).toEqual([]);
    await userEvent.click(undo());
    expect((screen.getByLabelText('AI-written description') as HTMLTextAreaElement).value).toBe('A soft lace gown.');
  });

  it('says so and keeps the old text when the provider fails', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: /Group 2/ }));
    rewriteReply = () => ({ status: 502 });
    await userEvent.click(screen.getByRole('button', { name: 'Rewrite' }));
    expect(await screen.findByText("Couldn't rewrite. Try again.")).toBeTruthy();
    expect((screen.getByLabelText('AI-written description') as HTMLTextAreaElement).value).toBe('A soft lace gown.');
    expect(undo().disabled).toBe(true);
    rewriteReply = () => { throw new Error('down'); };
    await userEvent.click(screen.getByRole('button', { name: 'Rewrite' }));
    await waitFor(() => expect(screen.getAllByText("Couldn't rewrite. Try again.").length).toBe(2));
    expect((screen.getByRole('button', { name: 'Rewrite' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('Confirm and save', () => {
  it('sends the loaded state as one commit, says how many gowns went to Gallery and reloads', async () => {
    await open();
    const before = currentLoads;
    await userEvent.click(confirmButton(2));
    expect(await screen.findByText('2 gowns saved to Gallery')).toBeTruthy();
    expect(sent).toEqual([{
      method: 'POST',
      path: `/api/v1/uploads/${B}/commit`,
      body: {
        groups: [
          { id: 'g1', version: 3, name: 'Group 1', attributes: [], description: '', photoIds: [photo(1), photo(3)] },
          { id: 'g2', version: 5, name: 'Group 2', attributes: [{ type: 'fabric', value: 'Lace' }], description: 'A soft lace gown.', photoIds: [photo(2)] },
        ],
        removed: [],
        discarded: [],
      },
    }]);
    await waitFor(() => expect(currentLoads).toBe(before + 1));
  });

  it('sends every staged edit in the one request: renamed, split, merged-away, discarded', async () => {
    commitReply = () => ({ status: 200, body: { saved: 2 } });
    await open();
    const name = screen.getByLabelText(/^Gown name/);
    await userEvent.clear(name);
    await userEvent.type(name, 'Ivory');
    await userEvent.selectOptions(screen.getByLabelText('Silhouette'), 'A-line');
    await pick(2);
    await userEvent.click(splitBtn());
    await userEvent.click(screen.getByRole('button', { name: /^Group 2/ }));
    await pick(1);
    await userEvent.click(discardBtn());
    expect(sent).toEqual([]);
    await userEvent.click(confirmButton(2));
    await waitFor(() => expect(commits().length).toBe(1));
    const body = commits()[0].body as { groups: Record<string, unknown>[]; removed: unknown[]; discarded: string[] };
    expect(body.groups.length).toBe(2);
    expect(body.groups[0]).toEqual({ id: 'g1', version: 3, name: 'Ivory', attributes: [{ type: 'silhouette', value: 'A-line' }], description: '', photoIds: [photo(1)] });
    expect(Object.keys(body.groups[1]).sort()).toEqual(['attributes', 'description', 'name', 'photoIds']);
    expect(body.groups[1]).toMatchObject({ name: 'Ivory II', attributes: [{ type: 'silhouette', value: 'A-line' }], photoIds: [photo(3)] });
    expect(body.removed).toEqual([{ id: 'g2', version: 5 }]);
    expect(body.discarded).toEqual([photo(2)]);
    expect(sent.length).toBe(1);
  });

  it('shows a spinner while saving and blocks a second click', async () => {
    await open();
    let release: (r: Reply) => void = () => {};
    commitReply = () => new Promise((res) => { release = res; });
    await userEvent.click(confirmButton(2));
    const busy = await screen.findByRole('button', { name: 'Saving…' });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(busy.querySelector('.spinner')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Discard batch' }) as HTMLButtonElement).disabled).toBe(true);
    release({ status: 200, body: { saved: 2 } });
    expect(await screen.findByText('2 gowns saved to Gallery')).toBeTruthy();
    expect(commits().length).toBe(1);
  });

  it('says the batch changed elsewhere on 409, keeps the edits, and Reload loads the batch again', async () => {
    await open();
    const before = currentLoads;
    const name = screen.getByLabelText(/^Gown name/) as HTMLInputElement;
    await userEvent.type(name, '!');
    commitReply = () => ({ status: 409 });
    await userEvent.click(confirmButton(2));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('This batch changed elsewhere. Reload to see the latest.');
    expect(name.value).toBe('Group 1!');
    expect(currentLoads).toBe(before);
    await userEvent.click(within(alert).getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(currentLoads).toBe(before + 1));
  });

  it('says it could not save on a server error or a dropped connection, keeps the edits, and a retry saves', async () => {
    await open();
    await userEvent.type(screen.getByLabelText(/^Gown name/), '!');
    commitReply = () => ({ status: 500 });
    await userEvent.click(confirmButton(2));
    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't save. Try again.");
    expect((screen.getByLabelText(/^Gown name/) as HTMLInputElement).value).toBe('Group 1!');
    expect(undo().disabled).toBe(false);
    commitReply = () => { throw new Error('down'); };
    await userEvent.click(confirmButton(2));
    await waitFor(() => expect(commits().length).toBe(2));
    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't save. Try again.");
    commitReply = () => ({ status: 200, body: { saved: 2 } });
    await userEvent.click(confirmButton(2));
    expect(await screen.findByText('2 gowns saved to Gallery')).toBeTruthy();
    expect(screen.queryByText("Couldn't save. Try again.")).toBeNull();
  });

  it('selects the group without a name and saves nothing when the server refuses it', async () => {
    await open();
    commitReply = () => ({ status: 422, body: { fields: [{ field: 'groups[1].name', code: 'required' }] } });
    await userEvent.click(confirmButton(2));
    expect(await screen.findByText('Every gown needs a name before it can be saved.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Group 2/ }).getAttribute('aria-current')).toBe('true');
    expect((confirmButton(2) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('Discard the batch', () => {
  it('asks first with Keep reviewing focused, deletes the batch and resets the screen', async () => {
    const { container } = await open();
    const before = currentLoads;
    await userEvent.click(screen.getByRole('button', { name: 'Discard batch' }));
    const dlg = screen.getByRole('dialog', { name: 'Discard this batch?' });
    expect(within(dlg).getByText('The 3 uploaded photos and every AI group will be removed. This can’t be undone.')).toBeTruthy();
    expect(document.activeElement).toBe(within(dlg).getByRole('button', { name: 'Keep reviewing' }));
    expect(within(dlg).getByRole('button', { name: 'Discard batch' }).className).toContain('danger');
    await noViolations(container);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Discard batch' }));
    expect(await screen.findByText('Batch discarded')).toBeTruthy();
    expect(sent).toEqual([{ method: 'DELETE', path: `/api/v1/uploads/${B}`, body: undefined }]);
    await waitFor(() => expect(currentLoads).toBe(before + 1));
  });

  it('keeps the batch when Keep reviewing is pressed', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Discard batch' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Keep reviewing' }));
    expect(sent).toEqual([]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Leave without saving', () => {
  const leave = async () => {
    window.location.hash = '#/inquiries';
    return screen.findByRole('dialog', { name: 'Leave without saving?' });
  };

  it('asks when staged edits exist: Keep reviewing stays with the edits and the page, Leave goes', async () => {
    const { container } = await open();
    await userEvent.type(screen.getByLabelText(/^Gown name/), '!');
    const dlg = await leave();
    expect(within(dlg).getByText('Your changes to this batch will be lost.')).toBeTruthy();
    expect(document.activeElement).toBe(within(dlg).getByRole('button', { name: 'Keep reviewing' }));
    expect(within(dlg).getByRole('button', { name: 'Leave' }).className).toContain('danger');
    expect(window.location.hash).toBe('#/upload');
    await noViolations(container);

    await userEvent.click(within(dlg).getByRole('button', { name: 'Keep reviewing' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((screen.getByLabelText(/^Gown name/) as HTMLInputElement).value).toBe('Group 1!');

    await leave();
    await userEvent.click(screen.getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Gown groups' })).toBeNull());
    expect(window.location.hash).toBe('#/inquiries');
    expect(sent).toEqual([]);
  });

  it('does not ask once Undo is back at the loaded state', async () => {
    await open();
    await userEvent.type(screen.getByLabelText(/^Gown name/), '!');
    await userEvent.click(undo());
    window.location.hash = '#/inquiries';
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Gown groups' })).toBeNull());
    expect(screen.queryByRole('dialog', { name: 'Leave without saving?' })).toBeNull();
  });

  it('does not ask when nothing was edited', async () => {
    await open();
    window.location.hash = '#/inquiries';
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Gown groups' })).toBeNull());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('warns on window close only while edits are staged', async () => {
    await open();
    const idle = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(idle);
    expect(idle.defaultPrevented).toBe(false);
    await userEvent.type(screen.getByLabelText(/^Gown name/), '!');
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });
});
