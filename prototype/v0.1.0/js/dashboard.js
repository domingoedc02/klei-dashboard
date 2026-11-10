/* dashboard.js — home widgets + wireframe state toggle (default / loading / empty) */
(() => {
const K = window.K, S = K.S, esc = K.esc, icon = K.icon;
const st = () => S.ui.dash || 'default';

const skelRows = n => Array.from({ length: n }, () => `<div class="list-row"><span class="skel" style="width:40px;height:53px"></span><span class="od-fill od-stack" style="--od-gap:6px"><span class="skel" style="height:14px;width:60%"></span><span class="skel" style="height:12px;width:40%"></span></span></div>`).join('');

K.views.dashboard = () => {
  const s = st(), G = K.D.gallery, I = K.D.inq.filter(i => S.inqSt[i.id] === 'New' && !S.read[i.id]);
  const total = s === 'empty' ? 0 : 128;
  const widgets = {
    recent: `<section class="card widget" aria-labelledby="w1"><div class="widget-head"><h2 id="w1">Recent uploads</h2><a href="#" class="sm semi" data-go="gallery">View gallery</a></div>
      ${s === 'loading' ? skelRows(4) : s === 'empty' ? K.empty({ art: 1, compact: true, title: 'No uploads yet', text: 'Upload gown photos and AI will group them for you.', action: 'Upload photos', go: 'upload', fk: 'dash-up' }) :
      G.slice(0, 4).map(g => `<button class="list-row link" data-go="gallery" data-open="${g.id}"><span class="thumb-sm">${K.ph(g.kind, g.fab, 0, '', g.name)}</span>
        <span class="od-fill"><span class="sm semi od-truncate">${esc(g.name)}</span><span class="xs muted">${K.L(g.sil)} · ${g.n} photos</span></span>${g.isNew ? '<span class="pill pill-blue">New</span>' : ''}<span class="xs muted od-nowrap">${g.label}</span></button>`).join('')}</section>`,
    unread: `<section class="card widget" aria-labelledby="w2"><div class="widget-head"><h2 id="w2">Unread inquiries</h2><a href="#" class="sm semi" data-go="inquiries">Open inbox</a></div>
      ${s === 'loading' ? skelRows(3) : s === 'empty' || !I.length ? K.empty({ art: 2, compact: true, title: 'No new inquiries', text: 'New website inquiries will appear here.', action: 'Open inbox', go: 'inquiries', fk: 'dash-inq' }) :
      I.map(i => `<button class="list-row link" data-go="inquiries" data-open="${i.id}"><span class="unread-dot"></span><span class="od-fill"><span class="sm semi od-truncate" data-cust="${i.id}">${esc(i.name)}</span><span class="xs muted od-truncate">${esc(i.subj)}</span></span><span class="xs muted od-nowrap">${i.time}</span></button>`).join('')}</section>`,
  };
  return `<div class="page"><div class="page-head"><div><h1 id="view-h" tabindex="-1">Good morning, ${K.isAdmin() ? 'Eleanor' : 'Marcus'}</h1><p class="muted sm" style="margin-top:4px">Saturday, Nov 7 · 3 appointments today</p></div>
    <div class="od-row"><div class="stsel"><span class="xs muted" id="dsl">Wireframe state</span><div class="seg" role="group" aria-labelledby="dsl">${['default', 'loading', 'empty'].map(x => `<button data-act="dash-state" data-arg="${x}" aria-pressed="${s === x}">${x[0].toUpperCase() + x.slice(1)}</button>`).join('')}</div></div>
    <button class="btn btn-primary" data-go="upload" data-fk="d-up">${icon('upload')}Upload photos</button></div></div>

    <div class="grid-4" style="margin-bottom:16px">
      <div class="card widget"><span class="eyebrow">Total gowns</span>${s === 'loading' ? '<span class="skel" style="height:40px;width:50%"></span>' : `<span class="big-num">${total}</span>`}<span class="xs muted">${s === 'empty' ? 'Nothing saved yet' : '+10 this week'}</span></div>
      <div class="card widget"><span class="eyebrow">Unread inquiries</span>${s === 'loading' ? '<span class="skel" style="height:40px;width:50%"></span>' : `<span class="big-num">${s === 'empty' ? 0 : K.unread()}</span>`}<span class="xs muted">${s === 'empty' ? 'Inbox is clear' : 'Oldest from 8:15 AM'}</span></div>
      <div class="card widget"><span class="eyebrow">Photos this month</span>${s === 'loading' ? '<span class="skel" style="height:40px;width:50%"></span>' : `<span class="big-num">${s === 'empty' ? 0 : 412}</span>`}<span class="xs muted">${s === 'empty' ? 'Upload to get started' : 'Across 96 gowns'}</span></div>
      <div class="card widget"><span class="eyebrow">Avg. reply time</span>${s === 'loading' ? '<span class="skel" style="height:40px;width:50%"></span>' : `<span class="big-num">${s === 'empty' ? '—' : '2.4h'}</span>`}<span class="xs muted">${s === 'empty' ? 'No replies yet' : 'Down from 3.1h'}</span></div></div>

    <div class="grid-2">${widgets.recent}<div class="od-stack" style="--od-gap:16px">
      <section class="card widget" aria-labelledby="w3"><div class="widget-head"><h2 id="w3">AI processing</h2>${s === 'empty' ? '<span class="pill pill-gray">Idle</span>' : s === 'loading' ? '<span class="pill pill-blue">Checking…</span>' : '<span class="pill pill-green">Ready for review</span>'}</div>
        ${s === 'loading' ? '<span class="skel" style="height:8px"></span><span class="skel" style="height:14px;width:70%"></span>' : s === 'empty' ? '<p class="sm muted">No batches in progress. Start one by dropping photos into AI Upload.</p>' :
        `<div class="od-stack" style="--od-gap:8px"><div class="od-row" style="justify-content:space-between"><span class="sm semi">Batch of 30 photos</span><span class="xs muted">100%</span></div>
        <div class="bar" style="--w:100%" role="progressbar" aria-label="Batch progress" aria-valuenow="100" aria-valuemin="0" aria-valuemax="100"><i></i></div>
        <p class="sm muted">Grouped into 10 gowns · 3 need a quick look.</p><button class="btn btn-secondary" style="align-self:flex-start" data-go="upload" data-act="resume-review">Review groups</button></div>`}</section>
      ${widgets.unread}</div></div></div>`;
};
Object.assign(K.acts, {
  'dash-state': (_, s) => { S.ui.dash = s; K.rerender(); },
  'resume-review': () => { S.ui.up = { phase: 'review', cur: 0, groups: K.D.groups.map(g => ({ ...g })), sel: [] }; },
});
})();
