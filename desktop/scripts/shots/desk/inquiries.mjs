// desk reach for the inquiries + client-profile screens: { '<id>-<state>': { hash, ready, fx(table), after(page) } }; see ../screens.mjs and ../desktop.mjs.
import { INQ, PENDING, inquiryRoutes } from '../fixtures.mjs';

const I = '#/inquiries';
const withRoutes = (items) => (r) => Object.assign(r, inquiryRoutes(items));
// Prototype default selects i1; desktop `#/inquiries` selects nothing, so the default pair opens i1 (the no-selection pane is an EXTRA).
const thread = (id, over = {}) => ({ hash: `${I}/${id}`, ready: 'form.composer, .composer-note', fx: withRoutes(), ...over });
const sendable = (page) => page.waitForSelector('form.composer button[type=submit]:not([disabled])');

export default {
  'inquiries-default': thread('i1'),
  'inquiries-loading': { hash: I, ready: '.inq-skel', fx: (r) => { withRoutes()(r); r['POST /api/v1/inquiries/query'] = PENDING; } },
  'inquiries-empty': { hash: I, ready: '.inq-list .empty', fx: withRoutes([]) },
  'inquiries-filtered-empty': {
    hash: I, ready: '.inq-row',
    fx: withRoutes(INQ.map((i) => ({ ...i, status: 'closed', unread: false }))),
    after: async (page) => { await page.getByRole('button', { name: 'New', exact: true }).click(); await page.waitForSelector('.inq-list .empty'); },
  },
  'inquiries-thread-replied': thread('i3'),
  'inquiries-thread-closed': thread('i5'),
  'inquiries-composer-error': thread('i1', {
    after: async (page) => { await sendable(page); await page.getByRole('button', { name: 'Send', exact: true }).click(); await page.waitForSelector('.composer .error'); },
  }),
  'inquiries-customer-card': thread('i1', { after: async (page) => { await page.locator('.thread-head .cust-link').focus(); await page.waitForSelector('.hc'); } }),
  'client-profile-default': { hash: `${I}/client/c1`, ready: '.client-profile header', fx: withRoutes() },
};

// Desktop-only states, no prototype twin.
export const EXTRA = [
  { id: 'inquiries', state: 'no-selection', desk: { hash: I, ready: '.inq-row', fx: withRoutes() } },
];
