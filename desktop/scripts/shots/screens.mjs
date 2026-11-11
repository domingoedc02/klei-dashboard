// One table drives BOTH sides so every pair has the same file name.
// `proto(page)` drives the prototype (window.K, state-driven router).
// `desk` (added in desktop.mjs) drives the Vite app through the Tauri shim.
// Reach calls are from reading js/*.js; a failing step is logged, never swallowed silently.

import { PENDING, LONG_NAME } from './fixtures.mjs';
import DESK, { EXTRA } from './desk/index.mjs';

const ev = (page, code) => page.evaluate(code);
const go = (route, opts) => (page) => ev(page, `K.go(${JSON.stringify(route)}${opts ? ',' + JSON.stringify(opts) : ''})`);
const act = (name, ...args) => (page) => ev(page, `K.acts[${JSON.stringify(name)}](null${args.map((a) => ',' + JSON.stringify(a)).join('')})`);
const seq = (...steps) => async (page) => { for (const s of steps) await s(page); };
const js = (code) => (page) => ev(page, code);
const scrollEnd = js(`(()=>{const v=document.getElementById('view');if(v)v.scrollTop=v.scrollHeight})()`);

const dash = (s) => seq(js(`K.S.ui.dash=${JSON.stringify(s)}`), go('dashboard'));
const upload = (phase) => seq(go('upload'), act('up-state', phase));
const review = (...more) => seq(js(`K.after.upload=()=>{}`), upload('review'), ...more);
const gal = (...more) => seq(go('gallery'), ...more);
const inq = (...more) => seq(go('inquiries'), ...more);
const set = (tab, ...more) => seq(go('settings'), act('set-tab', tab), ...more);
const adm = (sub, ...more) => set('admin', act('adm-tab', sub), ...more);

export const SCREENS = [
  // dashboard
  { id: 'dashboard', state: 'default', proto: dash('default'), desk: { hash: '#/dashboard', ready: '.dash-stats .stat-figure' } },
  { id: 'dashboard', state: 'loading', proto: dash('loading'), desk: { hash: '#/dashboard', ready: '.dash-stats .skeleton', fx: (r) => { r['GET /api/v1/dashboard'] = PENDING; } } },
  { id: 'dashboard', state: 'empty', proto: dash('empty'), desk: { hash: '#/dashboard', ready: '.dash-stats .stat-figure', fx: (r) => { r['GET /api/v1/dashboard'] = () => ({ recentGowns: [], totalGowns: 0, newThisWeek: 0, photosThisMonth: 0, gownsThisMonth: 0, aiStatus: { phase: 'idle' }, inquiries: { unread: 0, latest: [], oldestUnreadAt: null }, avgReplySeconds: null, prevAvgReplySeconds: null, errors: [] }); } } },

  // upload
  { id: 'upload', state: 'empty', proto: go('upload') },
  { id: 'upload', state: 'processing', proto: seq(js(`K.after.upload=()=>{};K.S.ui.up={phase:'processing',pct:60,cur:0,sel:[],groups:null}`), go('upload')) },
  { id: 'upload', state: 'review', proto: review() },
  { id: 'upload', state: 'error', proto: upload('error') },
  { id: 'upload-review', state: 'low-group', proto: review(act('up-cur', 3)) },
  { id: 'upload-review', state: 'long', proto: review(js(`K.S.ui.up.groups[3].name=${JSON.stringify(LONG_NAME)};K.render()`), act('up-cur', 3)) },
  { id: 'upload-review', state: 'photos-selected', proto: review(act('up-sel', 0), act('up-sel', 1), js(`K.S.ui.up.to={mvto:'u1'};K.render()`)) },
  { id: 'upload-review', state: 'combo-open', proto: review(js(`document.getElementById('mvto').focus()`)) },
  { id: 'upload-review', state: 'discard-dialog', proto: review(act('up-discard')) },
  { id: 'upload-review', state: 'scrolled', proto: review(act('up-cur', 9), scrollEnd) },

  // gallery
  { id: 'gallery', state: 'default', proto: gal() },
  { id: 'gallery', state: 'loading', proto: seq(js(`K.S.ui.gal={state:'loading'}`), go('gallery'), act('gal-state', 'loading')) },
  { id: 'gallery', state: 'empty', proto: gal(act('gal-state', 'empty')) },
  { id: 'gallery', state: 'no-match', proto: gal(js(`Object.assign(K.S.ui.gal,{sil:'Ball gown',date:'Last 7 days'});K.render()`)) },
  { id: 'gallery', state: 'selected', proto: gal(act('g-sel', 'g0'), act('g-sel', 'g1')) },
  { id: 'gallery', state: 'delete-dialog', proto: gal(act('g-sel', 'g0'), act('g-del')) },
  { id: 'viewer', state: 'default', proto: gal(act('gal-open', 'g0')) },
  { id: 'viewer', state: 'photo-3', proto: gal(act('gal-open', 'g0'), act('v-img', 2)) },
  { id: 'viewer', state: 'edit-dialog', proto: gal(act('gal-open', 'g0'), act('v-edit')) },
  { id: 'viewer', state: 'edit-error', proto: gal(act('gal-open', 'g0'), act('v-edit'), js(`document.getElementById('ve-name').value=''`), act('v-edit-ok')) },
  { id: 'viewer', state: 'delete-dialog', proto: gal(act('gal-open', 'g0'), act('v-del')) },

  // inquiries
  { id: 'inquiries', state: 'default', proto: inq() },
  { id: 'inquiries', state: 'loading', proto: inq(act('inq-state', 'loading')) },
  { id: 'inquiries', state: 'empty', proto: inq(act('inq-state', 'empty')) },
  { id: 'inquiries', state: 'filtered-empty', proto: inq(js(`Object.keys(K.S.inqSt).forEach(k=>K.S.inqSt[k]='Closed')`), act('inq-filter', 'New')) },
  { id: 'inquiries', state: 'thread-replied', proto: inq(act('inq-sel', 'i3')) },
  { id: 'inquiries', state: 'thread-closed', proto: inq(act('inq-sel', 'i5')) },
  { id: 'inquiries', state: 'composer-error', proto: inq(js(`K.submit.send()`)) },
  { id: 'inquiries', state: 'customer-card', proto: inq(js(`document.querySelector('.cust-link').focus()`)) },
  { id: 'client-profile', state: 'default', proto: go('inquiries/profile', { cust: 'c1' }) },

  // settings
  { id: 'settings-profile', state: 'default', proto: set('profile') },
  { id: 'settings-signature', state: 'default', proto: set('signature') },
  { id: 'settings-signature', state: 'away-on', proto: set('signature', js(`K.S.sig.admin.away=true;K.render();document.getElementById('awh').scrollIntoView({block:'start'})`)) },
  { id: 'settings-preferences', state: 'default', proto: set('prefs') },
  { id: 'settings-notifications', state: 'default', proto: set('notifications') },
  { id: 'settings-staff', state: 'default', proto: adm('staff') },
  { id: 'settings-staff', state: 'empty', proto: adm('staff', js(`K.D.staff=[];K.render()`)) },
  { id: 'settings-staff', state: 'add-dialog', proto: adm('staff', act('staff-add')) },
  { id: 'settings-roles', state: 'default', proto: adm('roles') },
  { id: 'settings-ai', state: 'default', proto: adm('ai') },
  { id: 'settings-ai', state: 'provider-fail', proto: adm('ai', js(`K.S.ui.set.ai.prov.status='fail';K.S.ui.set.ai.prov.msg='Could not reach provider';K.render()`)) },
  { id: 'settings-audit', state: 'default', proto: adm('audit') },
  { id: 'settings-profile', state: 'staff-role', proto: seq(js(`K.S.role='staff'`), set('profile')) },
  { id: 'settings-2fa', state: 'on', proto: set('profile', js(`K.S.ui.set.twofa=true;K.render();document.getElementById('fah').scrollIntoView({block:'center'})`)) },

  // shell overlays (on dashboard)
  { id: 'overlay-notifications', state: 'default', proto: seq(go('dashboard'), act('menu', 'notif')) },
  { id: 'overlay-notifications', state: 'empty', proto: seq(go('dashboard'), js(`K.S.ui.notifState='empty'`), act('menu', 'notif')) },
  { id: 'overlay-profile-menu', state: 'default', proto: seq(go('dashboard'), act('menu', 'profile')) },
  { id: 'overlay-search', state: 'results', proto: seq(go('dashboard'), js(`K.S.q='aur';K.render()`)) },
  { id: 'overlay-search', state: 'none', proto: seq(go('dashboard'), js(`K.S.q='zzz';K.render()`)) },
  { id: 'overlay-assistant', state: 'greeting', proto: seq(go('dashboard'), act('ai')) },
  { id: 'overlay-assistant', state: 'busy', proto: seq(go('dashboard'), act('ai'), act('ai-chip', 'Summarize new inquiries')) },
];

export const name = (s) => `${s.id}-${s.state}`;
for (const s of SCREENS) s.desk ??= DESK[name(s)];
SCREENS.push(...EXTRA); // desktop-only states: no prototype twin
