/* data.js — seed data, topbar, shared helpers */
(() => {
const K = window.K, S = K.S, esc = K.esc, icon = K.icon;

const NAMES = ['Aurelia', 'Seraphine', 'Cordelia', 'Marguerite', 'Isolde', 'Valentina', 'Anastasia', 'Genevieve', 'Rosalind', 'Philippa', 'Odette', 'Calliope'];
const SIL = ['A-line', 'Mermaid', 'Ball gown'];
const FAB = ['Mikado', 'Tulle', 'Lace'];
const NECK = ['Sweetheart', 'V-neck', 'Off-shoulder', 'Bateau', 'Square'];
const SLV = ['Strapless', 'Cap sleeve', 'Long sleeve', 'Sheer long sleeve'];
const TRN = ['Sweep', 'Chapel', 'Cathedral', 'None'];
const KIND = { 'A-line': 'aline', 'Mermaid': 'mermaid', 'Ball gown': 'ball' };

const mk = (i, over = {}) => {
  const s = SIL[i % 3], f = FAB[(i + (i > 2 ? 1 : 0)) % 3], fb = i % 2 ? [f, FAB[(FAB.indexOf(f) + 1) % 3]] : [f];
  const name = NAMES[i % NAMES.length];
  return {
    id: 'g' + i, name, sil: [s], fab: fb, neck: [NECK[i % 5]], slv: [SLV[i % 4]], trn: [TRN[(i + 1) % 4]],
    kind: KIND[s], n: 3 + (i % 4), conf: [96, 91, 84, 72, 94, 88, 67, 90, 93, 79][i % 10],
    desc: `${name} is a ${s.toLowerCase()} gown in ${fb.join(' and ').toLowerCase()} with a ${NECK[i % 5].toLowerCase()} neckline and ${SLV[i % 4].toLowerCase()}s. The ${TRN[(i + 1) % 4].toLowerCase()} train falls softly behind, finishing in a clean hem.`,
    ...over,
  };
};

K.D = {
  gallery: [
    mk(0, { date: '2026-11-06', label: 'Nov 6, 2026', isNew: true, n: 5 }),
    mk(1, { date: '2026-11-04', label: 'Nov 4, 2026', n: 4 }),
    mk(2, { date: '2026-10-29', label: 'Oct 29, 2026', n: 6 }),
    mk(3, { date: '2026-10-21', label: 'Oct 21, 2026', n: 3 }),
    mk(4, { date: '2026-10-14', label: 'Oct 14, 2026', n: 5 }),
    mk(5, { date: '2026-09-30', label: 'Sep 30, 2026', n: 4 }),
    mk(6, { date: '2026-09-18', label: 'Sep 18, 2026', n: 6 }),
    mk(7, { date: '2026-08-27', label: 'Aug 27, 2026', n: 3 }),
  ],
  groups: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => mk(i + 3, { id: 'u' + i, n: 3 })),
  inq: [
    { id: 'i1', name: 'Hannah Whitfield', mail: 'hannah.whitfield@gmail.com', subj: 'Fitting availability for a June wedding', pre: 'Hi, I saw the Aurelia gown on your site and would love to book a fitting...', time: '9:42 AM', st: 'New', unread: true, date: '2026-06-14', body: ['Hi there,', 'I saw the Aurelia gown on your site and would love to book a fitting. My wedding is on June 14 and I am looking for an A-line silhouette in Mikado, ideally with sleeves.', 'Do you have any appointments next week? I can come on Tuesday or Thursday afternoon.', 'Thank you, Hannah'] },
    { id: 'i2', name: 'Priya Raman', mail: 'priya.raman@outlook.com', subj: 'Alterations and timeline question', pre: 'We are two months out and I need to know how long alterations usually take...', time: '8:15 AM', st: 'New', unread: true, body: ['Hello,', 'We are two months out from the wedding and I need to know how long alterations usually take for a mermaid gown. I also need the hem shortened by about 2 inches.', 'Best, Priya'] },
    { id: 'i3', name: 'Claire Dubois', mail: 'claire.dubois@icloud.com', subj: 'Lace ball gown pricing', pre: 'Could you share a price range for your lace ball gowns? We have a budget of...', time: 'Yesterday', st: 'Replied', body: ['Hi,', 'Could you share a price range for your lace ball gowns? We have a budget of $3,500 and a cathedral train would be a dream.', 'Thanks, Claire'], sent: 'Hi Claire, thank you for reaching out. Our lace ball gowns range from $2,800 to $4,600. I would be glad to set up a fitting to try a few within your budget.' },
    { id: 'i4', name: 'Maya Okafor', mail: 'maya.okafor@gmail.com', subj: 'Can I reschedule my appointment?', pre: 'Something came up on Saturday. Is it possible to move my appointment to...', time: 'Yesterday', st: 'Replied', body: ['Hi,', 'Something came up on Saturday. Is it possible to move my appointment to the following week?', 'Maya'], sent: 'Of course, Maya. I have moved you to Saturday, Nov 14 at 11:00 AM. See you then.' },
    { id: 'i5', name: 'Sofia Lindqvist', mail: 's.lindqvist@proton.me', subj: 'Thank you, we found the one', pre: 'We just wanted to say thank you. We found the gown and are placing the order...', time: 'Nov 3', st: 'Closed', body: ['Hello,', 'We just wanted to say thank you. We found the gown and are placing the order this week.', 'Sofia'], sent: 'Congratulations, Sofia! We are delighted for you. Your order is confirmed.' },
    { id: 'i6', name: 'Grace Tanaka', mail: 'grace.tanaka@gmail.com', subj: 'Do you offer plus-size samples?', pre: 'I am a size 20 and want to know which gowns you have in sample sizes...', time: 'Nov 2', st: 'Closed', body: ['Hi,', 'I am a size 20 and want to know which gowns you have in sample sizes.', 'Grace'], sent: 'Hi Grace, yes, we carry samples up to size 26. Please see our list attached.' },
    { id: 'i7', name: 'Hannah Whitfield', mail: 'hannah.whitfield@gmail.com', subj: 'Sample sizes for A-line gowns', pre: 'Do you carry sample sizes 8 and 10 in A-line silhouettes? I would like to try...', time: 'Oct 28', st: 'Closed', body: ['Hi,', 'Do you carry sample sizes 8 and 10 in A-line silhouettes? I would like to try a few before booking.', 'Thank you, Hannah'], sent: 'Hi Hannah, yes, we have both sizes in A-line. Please book a fitting online.' },
    { id: 'i8', name: 'Priya Raman', mail: 'priya.raman@outlook.com', subj: 'Booking a first fitting', pre: 'I would like to book a first fitting for me and two bridesmaids. Are weekends...', time: 'Oct 12', st: 'Closed', body: ['Hello,', 'I would like to book a first fitting for me and two bridesmaids. Are weekends open?', 'Priya'], sent: 'Hi Priya, Saturdays are open. We booked you in for 11:00.' },
    { id: 'i9', name: 'Claire Dubois', mail: 'claire.dubois@icloud.com', subj: 'Veil and accessory options', pre: 'Which veils go with a lace ball gown? I would like to see cathedral lengths...', time: 'Oct 20', st: 'Closed', body: ['Hi,', 'Which veils go with a lace ball gown? I would like to see cathedral lengths.', 'Claire'], sent: 'Hi Claire, we will have three cathedral veils ready for your fitting.' },
    { id: 'i10', name: 'Maya Okafor', mail: 'maya.okafor@gmail.com', subj: 'First consultation request', pre: 'I am getting married in December and need a gown quickly. Do you do rush...', time: 'Oct 9', st: 'Closed', body: ['Hi,', 'I am getting married in December and need a gown quickly. Do you do rush orders?', 'Maya'], sent: 'Hi Maya, yes, we can fit you in this week and start alterations right away.' },
    { id: 'i11', name: 'Sofia Lindqvist', mail: 's.lindqvist@proton.me', subj: 'Mikado or satin for a winter wedding?', pre: 'We are torn between Mikado and satin for a March wedding. What would you...', time: 'Oct 18', st: 'Closed', body: ['Hello,', 'We are torn between Mikado and satin for a March wedding. What would you suggest?', 'Sofia'], sent: 'Hi Sofia, Mikado holds structure better in cold venues. Come try both on.' },
  ],
  cust: [
    { id: 'c1', name: 'Hannah Whitfield', mail: 'hannah.whitfield@gmail.com', phone: '(555) 014-2281', city: 'Portland, OR', wedding: 'Jun 14, 2027', source: 'Instagram', since: 'Oct 2026', note: 'Wants an A-line in Mikado, ideally with sleeves. Free Tue/Thu afternoons.' },
    { id: 'c2', name: 'Priya Raman', mail: 'priya.raman@outlook.com', phone: '(555) 019-6407', city: 'Seattle, WA', wedding: 'Jan 16, 2027', source: 'Friend referral', since: 'Oct 2026', note: 'Tight timeline. Bringing two bridesmaids to fittings.' },
    { id: 'c3', name: 'Claire Dubois', mail: 'claire.dubois@icloud.com', phone: '(555) 011-7753', city: 'Tacoma, WA', wedding: 'Sep 4, 2027', source: 'Google search', since: 'Oct 2026', note: 'Budget-conscious. Prefers lace ball gowns with a cathedral veil.' },
    { id: 'c4', name: 'Maya Okafor', mail: 'maya.okafor@gmail.com', phone: '(555) 018-3392', city: 'Portland, OR', wedding: 'Dec 5, 2026', source: 'Website', since: 'Oct 2026', note: 'Rush order. Alterations needed within three weeks.' },
    { id: 'c5', name: 'Sofia Lindqvist', mail: 's.lindqvist@proton.me', phone: '(555) 012-8846', city: 'Vancouver, WA', wedding: 'Mar 20, 2027', source: 'Pinterest', since: 'Oct 2026', note: 'Ordered a Mikado gown. Next step: first alterations fitting.' },
    { id: 'c6', name: 'Grace Tanaka', mail: 'grace.tanaka@gmail.com', phone: '(555) 017-5509', city: 'Salem, OR', wedding: 'Oct 9, 2027', source: 'Website', since: 'Nov 2026', note: 'Size 20. Interested in plus-size samples.' },
  ],
  staff: [
    { id: 's1', name: 'Eleanor Park', mail: 'eleanor@kleibridal.com', role: 'Admin', st: 'Active', last: 'Today, 9:02 AM' },
    { id: 's2', name: 'Marcus Bell', mail: 'marcus@kleibridal.com', role: 'Staff', st: 'Active', last: 'Today, 8:40 AM' },
    { id: 's3', name: 'Tessa Moreau', mail: 'tessa@kleibridal.com', role: 'Staff', st: 'Active', last: 'Yesterday' },
    { id: 's4', name: 'Jonah Reyes', mail: 'jonah@kleibridal.com', role: 'Staff', st: 'Invited', last: 'Never' },
    { id: 's5', name: 'Ines Carvalho', mail: 'ines@kleibridal.com', role: 'Viewer', st: 'Active', last: 'Nov 3' },
  ],
  notifs: [
    { id: 'n1', t: 'New inquiry from Hannah Whitfield', s: '9:42 AM', go: 'inquiries', unread: true },
    { id: 'n2', t: 'AI finished grouping 30 images into 10 gowns', s: '8:58 AM', go: 'upload', unread: true },
    { id: 'n3', t: 'Marcus Bell accepted your invite', s: 'Yesterday', go: 'settings', unread: false },
  ],
  audit: [
    ['Nov 6, 2026 4:12 PM', 'Eleanor Park', 'Changed grouping sensitivity from Medium to High', '192.168.1.24'],
    ['Nov 6, 2026 2:30 PM', 'Eleanor Park', 'Invited jonah@kleibridal.com as Staff', '192.168.1.24'],
    ['Nov 5, 2026 11:05 AM', 'Marcus Bell', 'Saved 10 gowns from AI Upload', '10.0.0.17'],
    ['Nov 4, 2026 9:48 AM', 'Eleanor Park', 'Updated role permissions for Viewer', '192.168.1.24'],
    ['Nov 3, 2026 3:21 PM', 'Tessa Moreau', 'Deleted folder "Genevieve" from Gallery', '10.0.0.31'],
    ['Nov 2, 2026 10:00 AM', 'Eleanor Park', 'Enabled two-factor requirement for admins', '192.168.1.24'],
  ],
  perms: [
    ['Upload images', [1, 1, 0]], ['Edit gown details', [1, 1, 0]], ['Delete gown folders', [1, 0, 0]],
    ['Reply to inquiries', [1, 1, 0]], ['Close inquiries', [1, 1, 0]], ['Manage staff', [1, 0, 0]], ['Change AI settings', [1, 0, 0]], ['View audit log', [1, 0, 0]],
  ],
  tax: { Silhouette: [...SIL], Fabric: [...FAB], Neckline: [...NECK], Sleeve: [...SLV], Train: [...TRN] },
};
K.OPT = { SIL, FAB, NECK, SLV, TRN };
K.L = a => a.join(', ') || 'None';
S.notifs = K.D.notifs;
S.inqSt = Object.fromEntries(K.D.inq.map(i => [i.id, i.st]));
S.read = {};
K.unread = () => K.D.inq.filter(i => S.inqSt[i.id] === 'New' && !S.read[i.id]).length;
K.isAdmin = () => S.role === 'admin';

K.searchHits = () => {
  const q = S.q.trim().toLowerCase();
  if (!q) return [];
  const g = K.D.gallery.filter(x => (x.name + x.sil + x.fab).toLowerCase().includes(q)).map(x => ({ t: x.name, s: `${K.L(x.sil)} · ${K.L(x.fab)}`, go: 'gallery', ic: 'folder', id: x.id }));
  const i = K.D.inq.filter(x => (x.name + x.subj).toLowerCase().includes(q)).map(x => ({ t: x.subj, s: x.name, go: 'inquiries', ic: 'mail', id: x.id }));
  return [...g, ...i].slice(0, 6);
};

K.topbar = () => {
  const m = S.menu, hits = K.searchHits(), q = S.q.trim();
  const nUn = S.notifs.filter(n => n.unread).length;
  const ns = S.ui.notifState === 'empty' ? [] : S.notifs;
  return `<header class="topbar">
    <div class="search"><label class="sr-only" for="gsearch">Search gowns and inquiries</label>${icon('search')}
      <input id="gsearch" class="input" type="search" placeholder="Search gowns, inquiries…" value="${esc(S.q)}" autocomplete="off" data-search></div>
    ${q ? `<div class="search-pop" role="listbox" aria-label="Search results" style="left:24px;top:56px">${hits.length ? hits.map(h => `<a href="#" role="option" data-go="${h.go}" data-hit="${h.id}">${icon(h.ic)}<span class="od-fill"><span class="od-truncate semi">${esc(h.t)}</span><span class="xs muted">${esc(h.s)}</span></span></a>`).join('') :
      K.empty({ art: 6, compact: true, title: `No results for “${q}”`, text: 'Check the spelling or try a gown name, fabric, or client.', action: 'Clear search', act: 'clear-search', fk: 'clear-search' })}</div>` : ''}
    <div class="od-fill"></div>
    <button class="btn btn-secondary btn-sm ai-btn" data-act="ai" data-fk="ai-btn" aria-expanded="${!!S.ui.ai?.open}" aria-controls="ai-panel" aria-haspopup="dialog">${icon('spark')}AI Assistant</button>
    <button class="icon-btn" data-act="menu" data-arg="notif" data-fk="m-notif" aria-label="Notifications${nUn ? `, ${nUn} unread` : ''}" aria-expanded="${m === 'notif'}" aria-haspopup="true">${icon('bell', 'od-icon-lg')}${nUn && S.ui.notifState !== 'empty' ? '<span class="dot"></span>' : ''}</button>
    <button class="profile-btn" data-act="menu" data-arg="profile" data-fk="m-profile" aria-expanded="${m === 'profile'}" aria-haspopup="true" aria-label="Profile menu">
      <span class="avatar sm" aria-hidden="true">${K.isAdmin() ? 'EP' : 'MB'}</span><span class="sm semi">${K.isAdmin() ? 'Eleanor Park' : 'Marcus Bell'}</span>${icon('cd')}</button>
    ${m === 'notif' ? `<div class="menu notif" role="menu"><div class="menu-head"><h3>Notifications</h3><button class="btn btn-ghost btn-sm" style="width:auto" data-act="read-all">Clear all</button></div>
      ${ns.length ? ns.map(n => `<button class="notif-item" role="menuitem" data-go="${n.go}">${n.unread ? '<span class="unread-dot" style="margin-top:8px"></span>' : '<span style="width:8px"></span>'}<span class="od-fill"><span class="sm ${n.unread ? 'semi' : ''}" style="display:block">${esc(n.t)}</span><span class="xs muted">${n.s}</span></span></button>`).join('') :
      K.empty({ art: 5, compact: true, title: 'You’re all caught up', text: 'New inquiries and AI results will show up here.', action: 'Go to Inquiries', go: 'inquiries', fk: 'notif-cta' })}</div>` : ''}
    ${m === 'profile' ? `<div class="menu" role="menu"><div class="od-row" style="padding:8px 12px"><span class="avatar" aria-hidden="true">${K.isAdmin() ? 'EP' : 'MB'}</span><span class="od-fill"><span class="sm semi" style="display:block">${K.isAdmin() ? 'Eleanor Park' : 'Marcus Bell'}</span><span class="xs muted">${K.isAdmin() ? 'eleanor@kleibridal.com' : 'marcus@kleibridal.com'}</span></span></div><hr>
      <button role="menuitem" data-go="settings" data-tab="profile">${icon('user')}Profile settings</button>
      <button role="menuitem" data-act="toggle-role" data-fk="role-sw">${icon('shield')}<span class="od-fill">View as: ${K.isAdmin() ? 'Staff' : 'Admin'}</span><span class="pill pill-gray">Prototype</span></button><hr>
      <button role="menuitem" data-go="auth/login">${icon('logout')}Sign out</button></div>` : ''}
  </header>`;
};
})();
