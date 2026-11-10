// desk reach for the upload screens: { '<id>-<state>': { hash, ready, fx(table), after(page) } }; see ../screens.mjs and ../desktop.mjs.
import { PENDING, uploadRoutes, NOW } from '../fixtures.mjs';

const H = '#/upload';
const review = { hash: H, ready: '.review .grouplist .row', fx: (r) => Object.assign(r, uploadRoutes('review')) };
const pickGroup = (n) => (page) => page.locator('.grouplist .row').nth(n).click();
const scrollEnd = (page) => page.evaluate(() => { for (const e of document.querySelectorAll('.sheet, main')) e.scrollTop = e.scrollHeight; });

// Prototype "error" = empty drop zone + rejected files; the desktop twin is upload_files answering with `rejected`.
const REJECTED = { __events: [], value: { stored: [], rejected: [{ name: 'wedding-fitting.heic', reason: 'size' }, { name: 'notes.pdf', reason: 'type' }], cancelled: false } };

export default {
  'upload-empty': { hash: H, ready: '.dropzone', fx: (r) => Object.assign(r, uploadRoutes('empty')) },
  'upload-processing': { hash: H, ready: '.processing', fx: (r) => Object.assign(r, uploadRoutes('processing', { step: 3, done: 12, total: 30 })) },
  'upload-review': review,
  'upload-error': {
    hash: H, ready: '.dropzone',
    fx: (r) => { Object.assign(r, uploadRoutes('empty')); r['cmd upload_files'] = REJECTED; },
    after: async (page) => { await page.getByRole('button', { name: 'Choose photos' }).click(); await page.waitForSelector('.rejected'); },
  },
  'upload-review-low-group': { ...review, after: pickGroup(3) },
  // no checkbox selection on desktop: nearest state is a photo's action menu open
  'upload-review-photos-selected': { ...review, after: async (page) => { await page.getByRole('button', { name: 'Photo 1 actions' }).click(); } },
  // no inline combobox on desktop: nearest state is the group Actions menu open
  'upload-review-combo-open': { ...review, after: async (page) => { await page.getByRole('button', { name: 'Group actions' }).click(); } },
  'upload-review-discard-dialog': { ...review, after: async (page) => { await page.getByRole('button', { name: 'Discard batch' }).click(); await page.waitForSelector('[role=dialog]'); } },
  'upload-review-scrolled': { ...review, after: async (page) => { await pickGroup(9)(page); await scrollEnd(page); } },
};

// Desktop-only states, no prototype twin.
export const EXTRA = [
  { id: 'upload', state: 'loading', desk: { hash: H, ready: '.upload h1', fx: (r) => { r['GET /api/v1/uploads/current'] = PENDING; } } },
  {
    id: 'upload', state: 'stopped',
    desk: { hash: H, ready: '.failed', fx: (r) => Object.assign(r, uploadRoutes('error', { step: 2, error: { code: 'timed_out', step: 2, lastGood: NOW } })) },
  },
];
