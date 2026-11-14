// desk reach for the gallery + viewer screens: { '<id>-<state>': { hash, ready, fx(table), after(page) } }; see ../screens.mjs and ../desktop.mjs.
import { PENDING, galleryRoutes } from '../fixtures.mjs';

const G = '#/gallery';
const list = { hash: G, ready: '.gallery .grid .gown', fx: (r) => Object.assign(r, galleryRoutes()) };
const viewer = { hash: `${G}/g0`, ready: '.viewer .details', fx: (r) => Object.assign(r, galleryRoutes()) };
const dialog = (page) => page.waitForSelector('[role=dialog]');
const pickCards = (...names) => async (page) => { for (const n of names) await page.getByLabel(`Select ${n}`).check(); };

export default {
  'gallery-default': list,
  'gallery-loading': { hash: G, ready: '.gallery .skeleton', fx: (r) => { Object.assign(r, galleryRoutes()); r['POST /api/v1/gowns/query'] = PENDING; } },
  'gallery-empty': { hash: G, ready: '.gallery .empty', fx: (r) => Object.assign(r, galleryRoutes([])) },
  'gallery-no-match': {
    ...list,
    after: async (page) => {
      await page.getByLabel('Silhouette').selectOption({ label: 'Ball gown' });
      await page.getByLabel('Date added').selectOption({ label: 'Last 7 days' });
      await page.waitForSelector('.gallery .empty');
    },
  },
  'gallery-selected': { ...list, after: pickCards('Aurelia', 'Seraphine') },
  'gallery-delete-dialog': {
    ...list,
    after: async (page) => { await pickCards('Aurelia')(page); await page.getByRole('button', { name: 'Delete' }).click(); await dialog(page); },
  },
  'viewer-default': viewer,
  'viewer-photo-3': { ...viewer, after: (page) => page.getByRole('button', { name: 'Show photo 3 of 5' }).click() },
  'viewer-edit-dialog': { ...viewer, after: async (page) => { await page.getByRole('button', { name: 'Edit' }).click(); await dialog(page); await page.waitForSelector('#eg-name'); } },
  'viewer-edit-error': {
    ...viewer,
    after: async (page) => {
      await page.getByRole('button', { name: 'Edit' }).click();
      await page.locator('#eg-name').fill('');
      await page.getByRole('button', { name: 'Save changes' }).click();
      await page.waitForSelector('#eg-name[aria-invalid=true]');
    },
  },
  'viewer-delete-dialog': { ...viewer, after: async (page) => { await page.getByRole('button', { name: 'Delete folder' }).click(); await dialog(page); } },
};

// Desktop-only states, no prototype twin.
export const EXTRA = [
  { id: 'viewer', state: 'loading', desk: { hash: `${G}/g0`, ready: '.viewer .skeleton', fx: (r) => { Object.assign(r, galleryRoutes()); r['GET /api/v1/gowns/g0'] = PENDING; } } },
  {
    id: 'viewer', state: 'lightbox',
    desk: { hash: `${G}/g0`, ready: '.viewer .details', fx: (r) => Object.assign(r, galleryRoutes()), after: async (page) => { await page.getByRole('button', { name: 'Full view' }).click(); await page.getByRole('dialog').waitFor(); } },
  },
];
