// desk reach for Settings: { '<id>-<state>': { hash, ready, fx(table), after(page) } }; see ../screens.mjs and ../desktop.mjs.
// Fixtures mirror the prototype's js/settings.js defaults (Eleanor Park admin / Marcus Bell staff, same staff/audit/permission rows).
import { ME, PREFS, STAFF_PERMS, TZ, taxonomy } from '../fixtures.mjs';

const at = (hhmm, day = '2026-11-07') => new Date(`${day}T${hhmm}:00-08:00`).toISOString();
const S = '#/settings';
const PERMS = ['PERM_VIEW_GALLERY', 'PERM_UPLOAD_IMAGES', 'PERM_EDIT_GOWN', 'PERM_DELETE_GOWN', 'PERM_REPLY', 'PERM_CLOSE_INQUIRY', 'PERM_MANAGE_STAFF', 'PERM_AI_SETTINGS', 'PERM_VIEW_AUDIT'];
const PROTO_PREFS = { ...PREFS, newInquiry: true, aiFinished: true, teamActivity: true, emailNewInquiry: true, emailAiFinished: true, emailTeamActivity: false, digest: 'daily' };

const STAFF = [
  ['u-eleanor', 'Eleanor Park', 'eleanor', 'r-admin', 'Admin', 'active', at('09:02')],
  ['u-marcus', 'Marcus Bell', 'marcus', 'r-staff', 'Staff', 'active', at('08:40')],
  ['u-tessa', 'Tessa Moreau', 'tessa', 'r-staff', 'Staff', 'active', at('17:10', '2026-11-06')],
  ['u-jonah', 'Jonah Reyes', 'jonah', 'r-staff', 'Staff', 'invited', null],
  ['u-ines', 'Ines Carvalho', 'ines', 'r-viewer', 'Viewer', 'active', at('11:00', '2026-11-03')],
].map(([id, name, mail, roleId, role, status, lastActive]) => ({
  id, name, email: `${mail}@kleibridal.com`, roleId, role, status, lastActive, hasAvatar: false, lastAdmin: id === 'u-eleanor', version: 1, twoFactor: id === 'u-eleanor',
}));
const ROLES = [{ id: 'r-admin', name: 'Admin' }, { id: 'r-staff', name: 'Staff' }, { id: 'r-viewer', name: 'Viewer' }];

const AUDIT = [
  ['2026-11-06', '16:12', 'Eleanor Park', 'ai_settings_changed', 'Grouping sensitivity from Medium to High', '192.168.1.24'],
  ['2026-11-06', '14:30', 'Eleanor Park', 'user_invited', 'jonah@kleibridal.com as Staff', '192.168.1.24'],
  ['2026-11-05', '11:05', 'Marcus Bell', 'upload_saved', '10 gowns', '10.0.0.17'],
  ['2026-11-04', '09:48', 'Eleanor Park', 'role_permissions_changed', 'Viewer', '192.168.1.24'],
  ['2026-11-03', '15:21', 'Tessa Moreau', 'gown_deleted', 'Genevieve', '10.0.0.31'],
  ['2026-11-02', '10:00', 'Eleanor Park', 'twofa_enabled', 'Required for admins', '192.168.1.24'],
].map(([day, hhmm, actor, action, detail, ip], n) => ({ id: `a${n}`, ts: at(hhmm, day), actor, action, detail, ip }));

const AI = {
  preset: 'openai', baseUrl: 'https://api.openai.com/v1', apiKeySet: true, apiKeyMask: 'sk-••••••••3f2a', organization: null,
  chatModel: 'gpt-4o', visionModel: 'gpt-4o', visionModelAdv: 'gpt-4o', sensitivity: 3, tone: 'warm', advanced: true,
  embeddingModel: 'text-embedding-3-small', embeddingBaseUrl: null, embeddingApiKeySet: false, temperature: 0.7, maxTokens: 1024,
  status: 'not_tested', testedAt: null, models: ['gpt-4o', 'gpt-4o-mini'], version: 1,
};
const AWAY = {
  enabled: false, message: 'Thank you for your inquiry! We are away from the studio and will reply within two business days.',
  schedule: { mode: 'weekly', days: ['sun', 'mon'], start: '2026-11-26', end: '2026-11-27', from: '18:00', to: '09:00' }, zone: TZ, version: 1,
};

const adminSig = { enabled: true, signoff: 'Warm regards,', name: 'Eleanor Park', title: 'Owner & Lead Stylist', phone: '(415) 555-0142', studio: { name: 'Klei Bridal', address: null }, preview: 'Warm regards,\nEleanor Park\nOwner & Lead Stylist\nKlei Bridal · (415) 555-0142', version: 1 };
const STAFF_ME = { ...ME, id: 'u-marcus', name: 'Marcus Bell', email: 'marcus@kleibridal.com', role: 'Staff', permissions: STAFF_PERMS, preferences: PROTO_PREFS };

/** Every endpoint the Settings tabs read; a screen's fx edits it afterwards. */
const base = (r) => {
  r['GET /api/v1/me'] = () => ({ ...ME, preferences: PROTO_PREFS });
  r['GET /api/v1/me/profile'] = () => ({ name: 'Eleanor Park', email: 'eleanor@kleibridal.com', avatar: null, version: 1 });
  r['GET /api/v1/me/2fa'] = () => ({ enabled: false, recoveryLeft: 0, reset: false });
  r['GET /api/v1/me/signature'] = () => adminSig;
  r['GET /api/v1/admin/workspace'] = () => ({ studioName: 'Klei Bridal', studioAddress: '', version: 1 });
  r['GET /api/v1/admin/away'] = () => AWAY;
  r['GET /api/v1/admin/users'] = () => ({ items: STAFF, next: null, total: STAFF.length, roles: ROLES });
  r['GET /api/v1/admin/roles'] = () => ({
    permissions: PERMS,
    roles: [
      { id: 'r-admin', name: 'Admin', locked: true, permissions: PERMS, version: 1 },
      { id: 'r-staff', name: 'Staff', locked: false, permissions: STAFF_PERMS, version: 1 },
      { id: 'r-viewer', name: 'Viewer', locked: false, permissions: ['PERM_VIEW_GALLERY'], version: 1 },
    ],
  });
  r['GET /api/v1/admin/ai'] = () => AI;
  r['POST /api/v1/admin/ai/models'] = () => ({ models: AI.models, failure: null });
  r['GET /api/v1/taxonomy'] = taxonomy;
  r['GET /api/v1/admin/audit'] = () => ({ items: AUDIT, page: 1, pages: 1 });
  r['GET /api/v1/admin/ai/usage'] = () => ({
    items: [
      ['describe', 'ok', 4200], ['verify', 'ok', 1800], ['describe', 'ok', 3900], ['chat', 'ok', 2600], ['embed', 'error', 600], ['describe', 'timeout', 30000],
    ].map(([purpose, outcome, durationMs], n) => ({ id: `us${n}`, time: at(`0${9 - (n % 3)}:${10 + n * 7}`), user: 'Eleanor Park', purpose, model: 'gpt-4o', size: 1_400_000 + n * 1000, outcome, durationMs })),
    page: 1, pages: 1,
  });
  r['GET /api/v1/admin/keys/status'] = () => ({
    active: 2, highest: 2, configured: [1, 2], rows: { dataKey: { 1: 0, 2: 128 }, storedObject: { 1: 0, 2: 412 } },
    run: { state: 'idle', done: 0, total: 0, dataKey: 0, storedObject: 0 },
  });
};
const tab = (hash, ready, fx, after) => ({
  hash: `${S}/${hash}`, ready,
  fx: (r) => { base(r); fx?.(r); },
  after: async (page) => { await page.waitForSelector('.skeletons', { state: 'detached' }); await after?.(page); },
});
const staffTab = (fx, after) => tab('admin/staff', 'table[aria-label=Staff], .empty', fx, after);

export default {
  'settings-profile-default': tab('profile', '#profile-h'),
  'settings-profile-staff-role': tab('profile', '#profile-h', (r) => {
    r['GET /api/v1/me'] = () => STAFF_ME;
    r['GET /api/v1/me/profile'] = () => ({ name: 'Marcus Bell', email: 'marcus@kleibridal.com', avatar: null, version: 1 });
  }),
  'settings-signature-default': tab('signature', '#studio-h'),
  'settings-signature-away-on': tab('admin/away', '#away-h', (r) => { r['GET /api/v1/admin/away'] = () => ({ ...AWAY, enabled: true }); }),
  'settings-preferences-default': tab('preferences', 'h2:text("Language and region")'),
  'settings-notifications-default': tab('notifications', '#notif-h'),
  'settings-staff-default': staffTab(),
  'settings-staff-empty': staffTab((r) => { r['GET /api/v1/admin/users'] = () => ({ items: [], next: null, total: 0, roles: ROLES }); }),
  'settings-staff-add-dialog': staffTab(null, async (page) => { await page.getByRole('button', { name: 'Invite staff' }).click(); await page.waitForSelector('[role=dialog]'); await page.getByRole('button', { name: 'Send invite', exact: true }).click(); }),
  'settings-roles-default': tab('admin/roles', 'table[aria-label="Role permissions"]'),
  'settings-ai-default': tab('admin/ai', 'h2:text("Model provider")'),
  'settings-ai-provider-fail': tab('admin/ai', 'h2:text("Model provider")', (r) => {
    r['GET /api/v1/admin/ai'] = () => ({ ...AI, status: 'failed' });
    r['POST /api/v1/admin/ai/test'] = () => ({ status: 'failed', checks: [{ id: 'reach', label: 'Reach the provider', ok: false, detail: 'Could not reach provider' }, { id: 'chat', label: 'Chat model', ok: false, detail: 'Skipped' }] });
  }, async (page) => { await page.getByRole('button', { name: 'Test connection' }).click(); await page.waitForSelector('.checks'); await page.evaluate(() => { for (const e of document.querySelectorAll('*')) if (e.scrollTop) e.scrollTop = 0; }); }),
  'settings-audit-default': tab('admin/audit', 'table[aria-label="Audit log"]'),
  'settings-2fa-on': tab('profile', '#tf-h', (r) => { r['GET /api/v1/me/2fa'] = () => ({ enabled: true, recoveryLeft: 8, reset: false }); }, (page) => page.locator('#tf-h').evaluate((e) => e.scrollIntoView({ block: 'center' }))),
};

// Desktop-only states, no prototype twin (the prototype has no Usage/Keys tabs).
export const EXTRA = [
  { id: 'settings-usage', state: 'default', desk: tab('admin/usage', 'table') },
  { id: 'settings-keys', state: 'default', desk: tab('admin/keys', '.app') },
  { id: 'settings-away', state: 'default', desk: tab('admin/away', '#away-h') },
];
