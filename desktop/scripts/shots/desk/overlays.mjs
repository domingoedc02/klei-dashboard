// desk reach for shell overlays (bell, profile menu, search, assistant) on the dashboard + desktop-only sign-in phases and banners.
import { PENDING } from '../fixtures.mjs';

const DASH = { hash: '#/dashboard', ready: '.dash-stats .stat-figure' };
const hang = () => new Promise(() => {});
const open = (afterFn, fx) => ({ ...DASH, fx, after: afterFn });
const bell = (page) => page.getByRole('button', { name: /^Notifications/ }).click();
const search = (q, hit) => open(
  async (page) => { await page.locator('input[type=search]').fill(q); await page.waitForSelector(hit); },
  (r) => { r['POST /api/v1/search'] = ({ body }) => ({ items: body.q.startsWith('aur') ? [{ kind: 'gown', id: 'g0', title: 'Aurelia', subtitle: 'A-line · Mikado', thumbs: [] }] : [] }); },
);
const assistant = async (page) => { await page.getByRole('button', { name: 'AI Assistant' }).click(); await page.waitForSelector('aside.drawer'); };
const chat = (r) => { r['GET /api/v1/assistant/chat'] = () => ({ messages: [] }); };

export default {
  'overlay-notifications-default': open(async (page) => { await bell(page); await page.waitForSelector('[role=menu][aria-label=Notifications] .notice'); }),
  'overlay-notifications-empty': open(
    async (page) => { await bell(page); await page.waitForSelector('[role=menu][aria-label=Notifications]'); },
    (r) => { r['GET /api/v1/notifications'] = () => ({ items: [], unread: 0 }); },
  ),
  'overlay-profile-menu-default': open(async (page) => { await page.locator('.profile-btn').click(); await page.waitForSelector('.profile [role=menu]'); }),
  'overlay-search-results': search('aur', '[role=listbox][aria-label="Search results"]'),
  'overlay-search-none': search('zzz', '.search-note'),
  'overlay-assistant-greeting': open(assistant, chat),
  'overlay-assistant-busy': open(
    async (page) => { await assistant(page); await page.getByRole('button', { name: 'Summarize new inquiries' }).click(); await page.waitForSelector('.assist-typing'); },
    (r) => { chat(r); r['POST /api/v1/assistant/chat/messages'] = PENDING; },
  ),
};

// Sign-in phases: `GET /me` fails with a BridgeError kind (the whole api_request command rejects), so App.tsx lands on that screen.
const phase = (kind, then) => ({
  id: 'signin', state: kind,
  desk: { hash: '#/', ready: '.auth-card, .screen .lede', fx: (r) => { r['cmd api_request'] = { __reject: { kind, message: kind } }; then?.fx?.(r); }, after: then?.after },
});
const click = (name) => ({ fx: (r) => { r['cmd sign_in'] = hang; }, after: (page) => page.getByRole('button', { name }).click().then(() => page.waitForSelector('text=Finish signing in')) });

export const EXTRA = [
  { id: 'signin', state: 'booting', desk: { hash: '#/', ready: '.screen .lede', fx: (r) => { r['GET /api/v1/me'] = PENDING; } } },
  phase('signed_out'),
  { id: 'signin', state: 'waiting', desk: phase('signed_out', click('Sign in')).desk },
  { id: 'signin', state: 'failed', desk: phase('signed_out', {
    fx: (r) => { r['cmd sign_in'] = { __reject: { kind: 'failed', message: 'failed' } }; },
    after: (page) => page.getByRole('button', { name: 'Sign in' }).click().then(() => page.waitForSelector('[role=alert]')),
  }).desk },
  phase('keychain_unavailable'),
  phase('unreachable'),
  phase('session_expired'),
  phase('no_access'),
  { id: 'banner', state: 'update-ready', desk: { ...DASH, fx: (r) => { r['cmd check_update'] = { status: 'available', version: '1.2.0' }; }, after: (page) => page.waitForSelector('.banner.update') } },
  { id: 'banner', state: 'update-failed', desk: { ...DASH, fx: (r) => { r['cmd check_update'] = { status: 'available', version: '1.2.0' }; r['cmd install_update'] = { __reject: { kind: 'update_unverified', message: 'unverified' } }; }, after: (page) => page.getByRole('button', { name: 'Install and restart' }).click().then(() => page.waitForSelector('.banner.update.bad')) } },
  { id: 'banner', state: 'offline', desk: { hash: '#/dashboard', ready: '.banner', fx: (r) => { r['GET /api/v1/dashboard'] = { status: 503, body: null }; r['GET /api/v1/health/ready'] = { status: 503, body: null }; } } },
];
