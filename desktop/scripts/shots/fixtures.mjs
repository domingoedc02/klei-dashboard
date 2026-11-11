// API fixtures mirroring the prototype's js/data.js (same names, counts, copy, dates) in the real response shapes.
// `routes()` returns a table keyed `METHOD /path`; a screen's `fx(r)` edits it (empty lists, PENDING, errors).
import { gownSvg } from './gown-art.mjs';
import PROTO from './proto-groups.json' with { type: 'json' };

export const PENDING = Symbol('pending');
export const NOW = '2026-11-07T18:00:00Z'; // 10:00 Pacific, a Saturday: "Good morning", "Saturday, Nov 7"
export const TZ = 'America/Los_Angeles';
const at = (hhmm, day = '2026-11-07') => new Date(`${day}T${hhmm}:00-08:00`).toISOString();

export const ALL_PERMS = ['PERM_VIEW_GALLERY', 'PERM_UPLOAD_IMAGES', 'PERM_EDIT_GOWN', 'PERM_DELETE_GOWN', 'PERM_REPLY', 'PERM_CLOSE_INQUIRY', 'PERM_MANAGE_STAFF', 'PERM_AI_SETTINGS', 'PERM_KEY_ROTATE', 'PERM_AWAY', 'PERM_VIEW_AUDIT'];
export const STAFF_PERMS = ['PERM_VIEW_GALLERY', 'PERM_UPLOAD_IMAGES', 'PERM_EDIT_GOWN', 'PERM_REPLY', 'PERM_CLOSE_INQUIRY'];

export const PREFS = {
  timezone: TZ, dateFormat: 'MM/DD/YYYY', startPage: 'dashboard', enterToSend: false,
  newInquiry: true, aiFinished: true, teamActivity: false, emailNewInquiry: true, emailAiFinished: false, emailTeamActivity: false, digest: 'off', version: 1,
};
export const ME = { id: 'u-eleanor', name: 'Eleanor Park', email: 'eleanor@kleibridal.com', role: 'Admin', permissions: ALL_PERMS, avatar: null, preferences: PREFS };

// Gown id -> how its photos are drawn (see imgSvg).
export const GOWNS = [
  { id: 'g0', name: 'Aurelia', sil: ['A-line'], fab: ['Mikado'], kind: 'aline', n: 5, isNew: true, date: '2026-11-06' },
  { id: 'g1', name: 'Seraphine', sil: ['Mermaid'], fab: ['Tulle', 'Lace'], kind: 'mermaid', n: 4, date: '2026-11-04' },
  { id: 'g2', name: 'Cordelia', sil: ['Ball gown'], fab: ['Lace'], kind: 'ball', n: 6, date: '2026-10-29' },
  { id: 'g3', name: 'Marguerite', sil: ['A-line'], fab: ['Tulle', 'Lace'], kind: 'aline', n: 3, date: '2026-10-21' },
  { id: 'g4', name: 'Isolde', sil: ['Mermaid'], fab: ['Lace'], kind: 'mermaid', n: 5, date: '2026-10-14' },
  { id: 'g5', name: 'Valentina', sil: ['Ball gown'], fab: ['Mikado', 'Tulle'], kind: 'ball', n: 4, date: '2026-09-30' },
  { id: 'g6', name: 'Anastasia', sil: ['A-line'], fab: ['Tulle'], kind: 'aline', n: 6, date: '2026-09-18' },
  { id: 'g7', name: 'Genevieve', sil: ['Mermaid'], fab: ['Lace', 'Mikado'], kind: 'mermaid', n: 3, date: '2026-08-27' },
];
const photoIds = (g) => Array.from({ length: g.n }, (_, k) => `${g.id}p${k}`);
const card = (g) => ({ id: g.id, name: g.name, silhouette: g.sil, fabric: g.fab, photos: g.n, thumbs: photoIds(g).slice(0, 4), addedAt: at('12:00', g.date), isNew: !!g.isNew });

// ---- Inquiries: the prototype's D.inq (i1-i11) + D.cust (c1-c6); `last` is the list time ("9:42 AM", "Yesterday", "Nov 3"...) ----
const D = (day, hhmm = '10:00') => at(hhmm, day);
export const INQ = [
  ['i1', 'c1', 'Hannah Whitfield', 'Fitting availability for a June wedding', 'Hi, I saw the Aurelia gown on your site and would love to book a fitting...', 'new', true, D('2026-11-07', '09:42'), ['Hi there,', 'I saw the Aurelia gown on your site and would love to book a fitting. My wedding is on June 14 and I am looking for an A-line silhouette in Mikado, ideally with sleeves.', 'Do you have any appointments next week? I can come on Tuesday or Thursday afternoon.', 'Thank you, Hannah']],
  ['i2', 'c2', 'Priya Raman', 'Alterations and timeline question', 'We are two months out and I need to know how long alterations usually take...', 'new', true, D('2026-11-07', '08:15'), ['Hello,', 'We are two months out from the wedding and I need to know how long alterations usually take for a mermaid gown. I also need the hem shortened by about 2 inches.', 'Best, Priya']],
  ['i3', 'c3', 'Claire Dubois', 'Lace ball gown pricing', 'Could you share a price range for your lace ball gowns? We have a budget of...', 'replied', false, D('2026-11-06'), ['Hi,', 'Could you share a price range for your lace ball gowns? We have a budget of $3,500 and a cathedral train would be a dream.', 'Thanks, Claire'], 'Hi Claire, thank you for reaching out. Our lace ball gowns range from $2,800 to $4,600. I would be glad to set up a fitting to try a few within your budget.'],
  ['i4', 'c4', 'Maya Okafor', 'Can I reschedule my appointment?', 'Something came up on Saturday. Is it possible to move my appointment to...', 'replied', false, D('2026-11-06', '09:00'), ['Hi,', 'Something came up on Saturday. Is it possible to move my appointment to the following week?', 'Maya'], 'Of course, Maya. I have moved you to Saturday, Nov 14 at 11:00 AM. See you then.'],
  ['i5', 'c5', 'Sofia Lindqvist', 'Thank you, we found the one', 'We just wanted to say thank you. We found the gown and are placing the order...', 'closed', false, D('2026-11-03'), ['Hello,', 'We just wanted to say thank you. We found the gown and are placing the order this week.', 'Sofia'], 'Congratulations, Sofia! We are delighted for you. Your order is confirmed.'],
  ['i6', 'c6', 'Grace Tanaka', 'Do you offer plus-size samples?', 'I am a size 20 and want to know which gowns you have in sample sizes...', 'closed', false, D('2026-11-02'), ['Hi,', 'I am a size 20 and want to know which gowns you have in sample sizes.', 'Grace'], 'Hi Grace, yes, we carry samples up to size 26. Please see our list attached.'],
  ['i7', 'c1', 'Hannah Whitfield', 'Sample sizes for A-line gowns', 'Do you carry sample sizes 8 and 10 in A-line silhouettes? I would like to try...', 'closed', false, D('2026-10-28'), ['Hi,', 'Do you carry sample sizes 8 and 10 in A-line silhouettes? I would like to try a few before booking.', 'Thank you, Hannah'], 'Hi Hannah, yes, we have both sizes in A-line. Please book a fitting online.'],
  ['i8', 'c2', 'Priya Raman', 'Booking a first fitting', 'I would like to book a first fitting for me and two bridesmaids. Are weekends...', 'closed', false, D('2026-10-12'), ['Hello,', 'I would like to book a first fitting for me and two bridesmaids. Are weekends open?', 'Priya'], 'Hi Priya, Saturdays are open. We booked you in for 11:00.'],
  ['i9', 'c3', 'Claire Dubois', 'Veil and accessory options', 'Which veils go with a lace ball gown? I would like to see cathedral lengths...', 'closed', false, D('2026-10-20'), ['Hi,', 'Which veils go with a lace ball gown? I would like to see cathedral lengths.', 'Claire'], 'Hi Claire, we will have three cathedral veils ready for your fitting.'],
  ['i10', 'c4', 'Maya Okafor', 'First consultation request', 'I am getting married in December and need a gown quickly. Do you do rush...', 'closed', false, D('2026-10-09'), ['Hi,', 'I am getting married in December and need a gown quickly. Do you do rush orders?', 'Maya'], 'Hi Maya, yes, we can fit you in this week and start alterations right away.'],
  ['i11', 'c5', 'Sofia Lindqvist', 'Mikado or satin for a winter wedding?', 'We are torn between Mikado and satin for a March wedding. What would you...', 'closed', false, D('2026-10-18'), ['Hello,', 'We are torn between Mikado and satin for a March wedding. What would you suggest?', 'Sofia'], 'Hi Sofia, Mikado holds structure better in cold venues. Come try both on.'],
].map(([id, clientId, clientName, subject, preview, status, unread, last, body, sent]) => ({ id, clientId, clientName, subject, preview, status, unread, last, body, sent }));
const MAIL = { c1: 'hannah.whitfield@gmail.com', c2: 'priya.raman@outlook.com', c3: 'claire.dubois@icloud.com', c4: 'maya.okafor@gmail.com', c5: 's.lindqvist@proton.me', c6: 'grace.tanaka@gmail.com' };
const CUST = [
  ['c1', 'Hannah Whitfield', '(555) 014-2281', 'Portland, OR', '2027-06-14', 'Instagram', 'Wants an A-line in Mikado, ideally with sleeves. Free Tue/Thu afternoons.'],
  ['c2', 'Priya Raman', '(555) 019-6407', 'Seattle, WA', '2027-01-16', 'Friend referral', 'Tight timeline. Bringing two bridesmaids to fittings.'],
  ['c3', 'Claire Dubois', '(555) 011-7753', 'Tacoma, WA', '2027-09-04', 'Google search', 'Budget-conscious. Prefers lace ball gowns with a cathedral veil.'],
  ['c4', 'Maya Okafor', '(555) 018-3392', 'Portland, OR', '2026-12-05', 'Website', 'Rush order. Alterations needed within three weeks.'],
  ['c5', 'Sofia Lindqvist', '(555) 012-8846', 'Vancouver, WA', '2027-03-20', 'Pinterest', 'Ordered a Mikado gown. Next step: first alterations fitting.'],
  ['c6', 'Grace Tanaka', '(555) 017-5509', 'Salem, OR', '2027-10-09', 'Website', 'Size 20. Interested in plus-size samples.'],
];
const inqItem = (i) => ({ id: i.id, clientId: i.clientId, clientName: i.clientName, subject: i.subject, preview: i.preview, lastMessageAt: i.last, status: i.status, unread: i.unread });
const inqDetail = (i) => ({
  id: i.id, subject: i.subject, status: i.status, unread: i.unread, version: 1,
  client: { id: i.clientId, name: i.clientName, email: MAIL[i.clientId] },
  messages: [
    { id: `${i.id}m0`, direction: 'in', author: i.clientName, createdAt: i.sent ? new Date(new Date(i.last).getTime() - 36e5).toISOString() : i.last, body: i.body.join('\n\n'), html: false, mailState: null, attachments: [] },
    ...(i.sent ? [{ id: `${i.id}m1`, direction: 'out', author: 'Eleanor Park', createdAt: i.last, body: i.sent, html: false, mailState: 'sent', attachments: [] }] : []),
  ],
});

/** `items` overrides the list (e.g. [] for the empty state); detail/client/draft/signature routes always answer. */
export function inquiryRoutes(items = INQ) {
  return {
    'POST /api/v1/inquiries/query': ({ body: b }) => ({ items: items.filter((i) => !b.status || i.status === b.status).map(inqItem), next: null }),
    'GET /api/v1/inquiries/count': () => ({ count: items.filter((i) => i.unread).length }),
    'GET /api/v1/me/signature': () => ({ enabled: true, signoff: 'Warmly,', name: 'Eleanor Park', title: 'Owner', phone: null, studio: { name: 'Klei Bridal', address: null }, preview: 'Warmly,\nEleanor Park\nOwner\nKlei Bridal', version: 1 }),
    ...Object.fromEntries(INQ.flatMap((i) => [
      [`GET /api/v1/inquiries/${i.id}`, () => inqDetail(i)],
      [`GET /api/v1/inquiries/${i.id}/draft`, () => ({ body: '', updatedAt: null, attachments: [] })],
    ])),
    ...Object.fromEntries(CUST.map(([id, name, phone, city, weddingDate, source, note]) => [`GET /api/v1/clients/${id}`, () => ({
      id, name, email: MAIL[id], phone, city, weddingDate, source, note, createdAt: at('12:00', '2026-10-05'), version: 1,
      inquiries: INQ.filter((i) => i.clientId === id).map((i) => ({ id: i.id, subject: i.subject, preview: i.preview, lastMessageAt: i.last, status: i.status })),
    })])),
  };
}

const dashboard = () => ({
  recentGowns: GOWNS.slice(0, 4).map(card), totalGowns: 128, newThisWeek: 10, photosThisMonth: 412, gownsThisMonth: 96,
  aiStatus: { phase: 'review', step: 4, done: 30, total: 30, groups: 10, lowConfidence: 3 },
  inquiries: { unread: 2, latest: INQ.slice(0, 2).map(inqItem), oldestUnreadAt: at('08:15') },
  avgReplySeconds: 8640, prevAvgReplySeconds: 11160, errors: [],
});

export const NOTIFS = {
  items: [
    { id: 'n1', type: 'inquiry', title: 'New inquiry from Hannah Whitfield', target: 'inquiries', read: false, createdAt: at('09:42') },
    { id: 'n2', type: 'ai', title: 'AI finished grouping 30 images into 10 gowns', target: 'upload', read: false, createdAt: at('08:58') },
    { id: 'n3', type: 'team', title: 'Marcus Bell accepted your invite', target: 'settings', read: true, createdAt: at('15:00', '2026-11-06') },
  ],
  unread: 2,
};

export function routes() {
  return {
    'GET /api/v1/me': () => ME,
    'GET /api/v1/health/ready': () => ({ status: 'UP' }),
    'GET /api/v1/inquiries/count': () => ({ count: 2 }),
    'GET /api/v1/notifications': () => NOTIFS,
    'GET /api/v1/dashboard': dashboard,
  };
}

/** Unknown paths answer 404-less `null`; the caller logs them so a missing mock is never silent. */
export function makeHandler(table, log) {
  return async (cmd, args) => {
    const c = table[`cmd ${cmd}`]; // Tauri commands other than api_request: `fx` sets table['cmd upload_files'] etc.
    if (c !== undefined) return typeof c === 'function' ? c(args) : c;
    if (cmd === 'check_update') return { status: 'none' };
    if (cmd === 'set_dirty') return null;
    if (cmd === 'upload_files') return { stored: [], rejected: [], cancelled: false }; // watch/unwatch/cancel on mount
    if (cmd !== 'api_request') { log(`UNMOCKED command ${cmd}`); return null; }
    const { method, path } = args.request;
    const key = `${method} ${path.split('?')[0]}`;
    const f = table[key];
    if (f === undefined) { log(`UNMOCKED ${key}`); return { status: 200, body: null }; }
    if (f === PENDING) return new Promise(() => {});
    const v = typeof f === 'function' ? await f(args.request) : f;
    return v && v.status !== undefined && 'body' in v ? v : { status: 200, body: v };
  };
}

/** SVG for `klei-img://localhost/g/<gown>/<photo>` or `.../<batch>/<photo>`; photo ids are `<gown or group id>p<k>`, variant = k % 5. */
export function imgSvg(url) {
  const m = /\/([^/]+)\/([^/]+?)(?:\/full)?$/.exec(url);
  const pm = m && /^(.+?)p(\d+)$/.exec(m[2]);
  const src = pm && [...GOWNS, ...PROTO.groups].find((x) => x.id === pm[1]);
  return gownSvg(src?.kind ?? 'aline', src?.fab[0] ?? 'Mikado', pm ? Number(pm[2]) % 5 : 0);
}

// ---- Upload: one batch B, 10 groups of 3 photos mirroring the prototype's D.groups (u0-u9) ----
export const BATCH = '0b1c2d3e-0000-4000-8000-000000000001';
/** 60 characters: long enough to prove a group card truncates its name and keeps the Low pill. */
export const LONG_NAME = 'Marguerite Eleonora Valentina Seraphina Isolde Cordelia Rose';
const bandOf = (c) => (c < 80 ? 'low' : c < 90 ? 'medium' : 'high');
const TAG_TYPES = [['sil', 'silhouette'], ['fab', 'fabric'], ['neck', 'neckline'], ['slv', 'sleeve'], ['trn', 'train']];
const groupView = (g, i) => ({
  id: g.id, name: g.name, confidence: g.conf, band: bandOf(g.conf), position: i, version: 1, description: g.desc,
  photoIds: Array.from({ length: g.n }, (_, k) => `${g.id}p${k}`),
  tags: TAG_TYPES.flatMap(([k, type]) => g[k].map((value) => ({ type, value }))),
});
export const UPLOAD_PHOTOS = PROTO.groups.flatMap((g) => Array.from({ length: g.n }, (_, k) => `${g.id}p${k}`));

export const taxonomy = () => ({
  groups: TAG_TYPES.map(([, type]) => ({
    type, values: PROTO.tax[type[0].toUpperCase() + type.slice(1)].map((value, n) => ({ id: `${type}${n}`, type, value, version: 1 })),
  })),
});

// ---- Gallery: the prototype's D.gallery (g0-g7); detail fields follow its mk() ----
const NECK = ['Sweetheart', 'V-neck', 'Off-shoulder', 'Bateau', 'Square'], SLV = ['Strapless', 'Cap sleeve', 'Long sleeve', 'Sheer long sleeve'], TRN = ['Sweep', 'Chapel', 'Cathedral', 'None'];
const CONF = [96, 91, 84, 72, 94, 88, 67, 90];
const lc = (s) => s.toLowerCase();
export const gownDetail = (g) => {
  const i = GOWNS.indexOf(g), conf = CONF[i];
  return {
    id: g.id, name: g.name, photoCount: g.n, addedAt: at('12:00', g.date), confidence: conf, band: bandOf(conf), version: 1,
    attributes: [['silhouette', g.sil], ['fabric', g.fab], ['neckline', [NECK[i % 5]]], ['sleeve', [SLV[i % 4]]], ['train', [TRN[(i + 1) % 4]]]].map(([type, values]) => ({ type, values })),
    photos: photoIds(g).map((id) => ({ id, size: 1_400_000 })),
    description: `${g.name} is a ${lc(g.sil[0])} gown in ${g.fab.map(lc).join(' and ')} with a ${lc(NECK[i % 5])} neckline and ${lc(SLV[i % 4])}s. The ${lc(TRN[(i + 1) % 4])} train falls softly behind, finishing in a clean hem.`,
  };
};

/** POST /gowns/query: filters carry taxonomy ids (`silhouette0`), `days` is 0 for all time. */
export function galleryRoutes(items = GOWNS) {
  const valueOf = (id) => taxonomy().groups.flatMap((g) => g.values).find((v) => v.id === id)?.value;
  return {
    'POST /api/v1/gowns/query': ({ body: b }) => {
      const cut = b.days ? new Date(NOW).getTime() - b.days * 864e5 : 0;
      const hit = items.filter((g) =>
        (!b.silhouette?.length || b.silhouette.map(valueOf).some((v) => g.sil.includes(v))) &&
        (!b.fabric?.length || b.fabric.map(valueOf).some((v) => g.fab.includes(v))) && new Date(g.date).getTime() >= cut);
      return { items: hit.map(card), next: null, total: items.length, matching: hit.length };
    },
    'GET /api/v1/taxonomy': taxonomy,
    ...Object.fromEntries(items.map((g) => [`GET /api/v1/gowns/${g.id}`, () => gownDetail(g)])),
  };
}

/** Overrides for GET /uploads/current + /uploads/{id}: `phase` empty|processing|review|error. */
export function uploadRoutes(phase, status = {}) {
  const photoIds = phase === 'empty' ? [] : UPLOAD_PHOTOS;
  const st = { id: BATCH, phase, step: null, done: null, total: null, error: null, groups: phase === 'review' ? PROTO.groups.map(groupView) : null, ...status };
  return {
    'GET /api/v1/uploads/current': () => ({ id: BATCH, phase, photoIds, rejected: 0 }),
    [`GET /api/v1/uploads/${BATCH}`]: () => st,
    'GET /api/v1/taxonomy': taxonomy,
  };
}
