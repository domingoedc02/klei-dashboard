// desk reach for the upload screens: { '<id>-<state>': { hash, ready, fx(table), after(page) } }; see ../screens.mjs and ../desktop.mjs.
import { PENDING, uploadRoutes, NOW, BATCH, LONG_NAME } from '../fixtures.mjs';

const H = '#/upload';
const review = { hash: H, ready: '.review .rv-list .gl', fx: (r) => Object.assign(r, uploadRoutes('review')) };
const pickGroup = (n) => (page) => page.locator('.rv-list .gl').nth(n).click();
const scrollEnd = (page) => page.evaluate(() => { for (const e of document.querySelectorAll('.sheet, main, .rv-list, .rv > .editor')) e.scrollTop = e.scrollHeight; });

// Prototype "error" = empty drop zone + rejected files; the desktop twin is upload_files answering with `rejected`.
const REJECTED = { __events: [], value: { stored: [], rejected: [{ name: 'wedding-fitting.heic', reason: 'size' }, { name: 'notes.pdf', reason: 'type' }], cancelled: false } };

export default {
  'upload-empty': { hash: H, ready: '.dropzone', fx: (r) => Object.assign(r, uploadRoutes('empty')) },
  'upload-processing': { hash: H, ready: '.processing', fx: (r) => Object.assign(r, uploadRoutes('processing', { step: 3, done: 12, total: 30 })) },
  'upload-review': review,
  'upload-error': {
    hash: H, ready: '.dropzone',
    fx: (r) => { Object.assign(r, uploadRoutes('empty')); r['cmd upload_files'] = REJECTED; },
    after: async (page) => { await page.getByRole('button', { name: 'Choose photos' }).click(); await page.waitForSelector('.err-summary'); },
  },
  'upload-review-low-group': { ...review, after: pickGroup(3) },
  'upload-review-long': {
    ...review,
    fx: (r) => {
      review.fx(r);
      const status = r[`GET /api/v1/uploads/${BATCH}`];
      r[`GET /api/v1/uploads/${BATCH}`] = (...a) => { const st = status(...a); return { ...st, groups: st.groups.map((g, i) => (i === 3 ? { ...g, name: LONG_NAME } : g)) }; };
    },
    after: pickGroup(3),
  },
  'upload-review-photos-selected': { ...review, after: async (page) => { await page.getByRole('button', { name: 'Photo 1', exact: true }).click(); await page.getByRole('button', { name: 'Photo 2', exact: true }).click(); await page.getByLabel('Move selected photos to').click(); await page.getByRole('option').first().click(); } },
  'upload-review-combo-open': { ...review, after: async (page) => { await page.getByLabel('Move selected photos to').click(); await page.getByRole('listbox', { name: 'Gowns' }).waitFor(); } },
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
