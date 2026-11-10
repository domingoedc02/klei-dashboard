/* gallery.js — folder grid, filters, viewer */
(() => {
const K = window.K, S = K.S, esc = K.esc, icon = K.icon;
const GS = () => {
  const f = (S.ui.gal ||= { sil: 'All', fab: 'All', date: 'All time', open: null, img: 0, state: 'default', sel: [] });
  if (S.ui.pendingOpen && S.route === 'gallery') { const id = S.ui.pendingOpen; delete S.ui.pendingOpen; if (K.D.gallery.some(g => g.id === id)) { f.open = id; f.img = 0; } }
  return f;
};
const opt = (id, label, opts, val) => `<div class="field"><label for="${id}">${label}</label><select class="select" id="${id}" data-filter="${id}">${opts.map(o => `<option ${o === val ? 'selected' : ''}>${o}</option>`).join('')}</select></div>`;
const DATES = { 'All time': 0, 'Last 7 days': 7, 'Last 30 days': 30, 'Last 90 days': 90 };
const list = () => {
  const f = GS(), now = new Date('2026-11-07');
  return K.D.gallery.filter(g => (f.sil === 'All' || g.sil.includes(f.sil)) && (f.fab === 'All' || g.fab.includes(f.fab)) && (!DATES[f.date] || (now - new Date(g.date)) / 864e5 <= DATES[f.date]))
    .sort((a, b) => b.date.localeCompare(a.date));
};

K.views.gallery = () => {
  const f = GS();
  if (f.open) {
    const g = K.D.gallery.find(x => x.id === f.open); if (g) return viewer(g, f);
  }
  const items = list(), none = !K.D.gallery.length || f.state === 'empty', filt = f.sil !== 'All' || f.fab !== 'All' || f.date !== 'All time';
  return `<div class="page"><div class="page-head"><div><h1 id="view-h" tabindex="-1">Gallery</h1><p class="muted sm" style="margin-top:4px">${none ? 'No gowns saved yet' : `${items.length} of ${K.D.gallery.length} gowns · latest upload first`}</p></div>
    <div class="od-row"><div class="stsel"><span class="xs muted" id="gsl">Wireframe state</span><div class="seg" role="group" aria-labelledby="gsl">${['default', 'loading', 'empty'].map(x => `<button data-act="gal-state" data-arg="${x}" aria-pressed="${f.state === x}">${x[0].toUpperCase() + x.slice(1)}</button>`).join('')}</div></div>
    <button class="btn btn-primary" data-go="upload" data-fk="g-up">${icon('upload')}Upload photos</button></div></div>
    ${none ? K.empty({ art: 4, title: 'Your gallery is empty', text: 'Saved gowns appear here as albums, newest first.', action: 'Upload photos', go: 'upload', fk: 'g-empty' }) : `
    <div class="filters" role="search" aria-label="Filter gowns">${opt('sil', 'Silhouette', ['All', ...K.OPT.SIL], f.sil)}${opt('fab', 'Fabric', ['All', ...K.OPT.FAB], f.fab)}${opt('date', 'Date added', Object.keys(DATES), f.date)}
      <div class="field"><span class="lbl">Sort</span><span class="btn btn-secondary" aria-disabled="true" style="cursor:default">${icon('clock')}Latest upload first</span></div>
      ${filt ? '<button class="btn btn-ghost" data-act="gal-clear" data-fk="gclr">Clear filters</button>' : ''}</div>
    ${f.state === 'loading' ? `<div class="folders">${Array.from({ length: 8 }, () => '<div class="card" style="padding:12px"><span class="skel" style="display:block;aspect-ratio:1/1"></span><span class="skel" style="display:block;height:16px;width:60%;margin-top:12px"></span><span class="skel" style="display:block;height:12px;width:40%;margin-top:8px"></span></div>').join('')}</div>` :
    items.length ? `${bulk(items)}<div class="folders">${items.map(g => `<div class="folder-wrap${f.sel.includes(g.id) ? ' sel' : ''}"><label class="folder-chk"><input type="checkbox" data-act="g-sel" data-arg="${g.id}" data-fk="gs-${g.id}" aria-label="Select ${esc(g.name)}" ${f.sel.includes(g.id) ? 'checked' : ''}></label><button class="card card-hover folder" data-act="gal-open" data-arg="${g.id}" data-fk="f-${g.id}" aria-label="Open ${esc(g.name)}, ${g.n} photos${g.isNew ? ', new' : ''}">
      ${g.isNew ? '<span class="pill pill-new">New</span>' : ''}<span class="mosaic">${[0, 1, 2, 3].map(v => K.ph(g.kind, g.fab, v % 3 === 2 ? 2 : v, 'sq', '')).join('')}</span>
      <span class="od-stack" style="--od-gap:2px"><span class="semi od-truncate">${esc(g.name)}</span><span class="xs muted od-truncate">${K.L(g.sil)} · ${K.L(g.fab)}</span><span class="xs muted">${g.n} photos · ${g.label}</span></span></button></div>`).join('')}</div>` :
    K.empty({ art: 4, title: 'No gowns match these filters', text: 'Try a different silhouette, fabric, or date range.', action: 'Clear filters', act: 'gal-clear', fk: 'gclr2' })}`}</div>`;
};

const picked = () => { const f = GS(); return list().filter(g => f.sel.includes(g.id)); };
const bulk = items => {
  const n = picked().length, off = n ? '' : 'disabled';
  return `<div class="bulk" role="toolbar" aria-label="Bulk actions"><label class="check"><input type="checkbox" data-act="g-all" data-fk="g-all" ${n === items.length ? 'checked' : ''}>Select all</label>
    <span class="sm muted">${n ? `${n} selected` : 'None selected'}</span>
    <span class="od-row bulk-act"><button class="btn btn-secondary" data-act="g-zip" data-fk="g-zip" ${off}>${icon('download')}Download .zip</button><button class="btn btn-secondary" data-act="g-del" data-fk="g-del" ${off}>${icon('trash')}Delete</button></span></div>`;
};
K.after.gallery = () => { const a = document.querySelector('[data-act="g-all"]'); if (a) a.indeterminate = !a.checked && picked().length > 0; };

const viewer = (g, f) => {
  const imgs = Array.from({ length: g.n }, (_, k) => k % 5), v = imgs[Math.min(f.img, imgs.length - 1)];
  return `<div class="page"><nav class="crumbs" aria-label="Breadcrumb"><button data-act="gal-close" data-fk="back">Gallery</button>${icon('cr')}<span aria-current="page">${esc(g.name)}</span></nav>
    <div class="page-head"><div class="od-row"><h1 id="view-h" tabindex="-1">${esc(g.name)}</h1>${g.isNew ? '<span class="pill pill-blue">New</span>' : ''}</div>
      <div class="od-row"><button class="btn btn-secondary" data-act="v-edit" data-fk="v-edit">${icon('edit')}Edit</button><button class="btn btn-secondary" data-act="v-zip" data-fk="v-zip">${icon('download')}Download .zip</button><button class="btn btn-secondary" data-act="v-copy">${icon('copy')}Copy description</button><button class="btn btn-secondary" data-act="v-del" data-fk="v-del">${icon('trash')}Delete folder</button></div></div>
    <div class="viewer"><div><div class="stage"><button class="icon-btn nav-btn prev" data-act="v-nav" data-arg="-1" aria-label="Previous photo">${icon('cl')}</button>${K.ph(g.kind, g.fab, v, '', `${g.name}, photo ${f.img + 1} of ${g.n}`)}<button class="icon-btn nav-btn next" data-act="v-nav" data-arg="1" aria-label="Next photo">${icon('cr')}</button></div>
      <div class="vthumbs" role="group" aria-label="Photos">${imgs.map((m, k) => `<button data-act="v-img" data-arg="${k}" data-fk="vt${k}" aria-label="Photo ${k + 1}" ${k === f.img ? 'aria-current="true"' : ''}>${K.ph(g.kind, g.fab, m, '', '')}</button>`).join('')}</div></div>
      <aside class="card od-stack" style="--od-gap:16px" aria-label="Gown details"><h2>Details</h2>
        <dl class="kv"><dt>Silhouette</dt><dd>${K.L(g.sil)}</dd><dt>Fabric</dt><dd>${K.L(g.fab)}</dd><dt>Neckline</dt><dd>${K.L(g.neck)}</dd><dt>Sleeve</dt><dd>${K.L(g.slv)}</dd><dt>Train</dt><dd>${K.L(g.trn)}</dd><dt>Photos</dt><dd>${g.n}</dd><dt>Added</dt><dd>${g.label}</dd></dl>
        <div><h3 style="margin-bottom:4px">Description</h3><p class="sm muted">${esc(g.desc)}</p></div>
      </aside></div></div>`;
};

/* shortcut: store-only zip (no compression), fine for a few small SVGs; swap in a zip lib for real photos */
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = b => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const zip = files => {
  const te = new TextEncoder(), parts = [], cen = []; let off = 0;
  for (const [n, d] of files) {
    const nb = te.encode(n), db = te.encode(d), c = crc32(db);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(12, 0x21, true);
    h.setUint32(14, c, true); h.setUint32(18, db.length, true); h.setUint32(22, db.length, true); h.setUint16(26, nb.length, true);
    const e = new DataView(new ArrayBuffer(46));
    e.setUint32(0, 0x02014b50, true); e.setUint16(4, 20, true); e.setUint16(6, 20, true); e.setUint16(8, 0x0800, true); e.setUint16(14, 0x21, true);
    e.setUint32(16, c, true); e.setUint32(20, db.length, true); e.setUint32(24, db.length, true); e.setUint16(28, nb.length, true); e.setUint32(42, off, true);
    parts.push(h, nb, db); cen.push(e, nb); off += 30 + nb.length + db.length;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cen.reduce((s, p) => s + p.byteLength, 0), true); end.setUint32(16, off, true);
  return new Blob([...parts, ...cen, end], { type: 'application/zip' });
};
const photoSvg = g => {
  const defs = K.defs.match(/<defs>[\s\S]*<\/defs>/)[0];
  return (k) => K.ph(g.kind, g.fab, k % 5, '', '').match(/<svg[\s\S]*<\/svg>/)[0]
    .replace('aria-hidden="true">', `xmlns="http://www.w3.org/2000/svg" width="480" height="640" style="color:#8a8580">${defs}`);
};

const gownFiles = g => {
  const svg = photoSvg(g), dir = g.name.toLowerCase();
  return [...Array.from({ length: g.n }, (_, k) => [`${dir}/photo-${k + 1}.svg`, svg(k)]),
    [`${dir}/details.txt`, `${g.name}\nSilhouette: ${K.L(g.sil)}\nFabric: ${K.L(g.fab)}\nNeckline: ${K.L(g.neck)}\nSleeve: ${K.L(g.slv)}\nTrain: ${K.L(g.trn)}\nPhotos: ${g.n}\nAdded: ${g.label}\n\n${g.desc}\n`]];
};
const save = (name, files) => {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(zip(files)), download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  K.toast(`Downloaded ${name}`);
};
const EDIT = [['sil', 'Silhouette'], ['fab', 'Fabric'], ['neck', 'Neckline'], ['slv', 'Sleeve'], ['trn', 'Train']];
const KIND = { 'A-line': 'aline', 'Mermaid': 'mermaid', 'Ball gown': 'ball' };
Object.assign(K.acts, {
  'v-edit': () => {
    const g = K.D.gallery.find(x => x.id === GS().open);
    K.dlg({ title: `Edit “${g.name}”`, from: 'v-edit', body: `<form class="od-stack" style="--od-gap:16px" novalidate>
      <div class="field"><label for="ve-name">Name</label><input class="input" id="ve-name" value="${esc(g.name)}" required aria-required="true"></div>
      ${EDIT.map(([k, l]) => `<fieldset style="border:0;padding:0;margin:0"><legend class="lbl" style="margin-bottom:8px">${l}</legend><div class="chips">${K.D.tax[l].map(o => `<label class="check"><input type="checkbox" name="${k}" value="${esc(o)}" ${g[k].includes(o) ? 'checked' : ''}>${esc(o)}</label>`).join('')}</div></fieldset>`).join('')}
      <div class="field"><label for="ve-desc">Description</label><textarea class="textarea" id="ve-desc">${esc(g.desc)}</textarea></div></form>`,
      actions: [{ label: 'Cancel', act: 'close-dlg' }, { label: 'Save changes', act: 'v-edit-ok', cls: 'btn-primary' }] });
  },
  'v-edit-ok': () => {
    const d = document.getElementById('dlg'), n = d.querySelector('#ve-name'), g = K.D.gallery.find(x => x.id === GS().open);
    if (!n.value.trim()) { n.setAttribute('aria-invalid', 'true'); n.focus(); return K.toast('Name is required'); }
    g.name = n.value.trim(); g.desc = d.querySelector('#ve-desc').value.trim();
    EDIT.forEach(([k]) => { g[k] = [...d.querySelectorAll(`input[name="${k}"]:checked`)].map(i => i.value); });
    g.kind = KIND[g.sil[0]] || g.kind;
    K.closeDlg(); K.rerender('v-edit'); K.toast('Gown updated');
  },
  'v-zip': () => { const g = K.D.gallery.find(x => x.id === GS().open); save(`${g.name.toLowerCase()}-gown.zip`, gownFiles(g)); },
  'g-sel': (_, id) => { const f = GS(); f.sel = f.sel.includes(id) ? f.sel.filter(x => x !== id) : [...f.sel, id]; K.rerender('gs-' + id); },
  'g-all': () => { const f = GS(), all = list().map(g => g.id); f.sel = picked().length === all.length ? [] : all; K.rerender('g-all'); },
  'g-zip': () => { const p = picked(); save(`klei-${p.length}-gowns.zip`, p.flatMap(gownFiles)); },
  'g-del': () => {
    const p = picked(); if (!p.length) return;
    K.dlg({ title: `Delete ${p.length} folder${p.length > 1 ? 's' : ''}?`, from: 'g-del', body: `<p class="muted">This removes ${esc(K.L(p.map(g => g.name)))} and ${p.reduce((s, g) => s + g.n, 0)} photos from Gallery. This can’t be undone.</p>`,
      actions: [{ label: 'Cancel', act: 'close-dlg', autofocus: true }, { label: `Delete ${p.length} folder${p.length > 1 ? 's' : ''}`, act: 'g-del-ok', cls: 'btn-danger' }] });
  },
  'g-del-ok': () => { const f = GS(), ids = picked().map(g => g.id); K.D.gallery = K.D.gallery.filter(x => !ids.includes(x.id)); f.sel = []; K.closeDlg(); K.rerender('g-all'); K.toast(`${ids.length} folder${ids.length > 1 ? 's' : ''} deleted`); },
  'gal-state': (_, s) => { GS().state = s; K.rerender(); },
  'gal-open': (_, id) => { const f = GS(); f.open = id; f.img = 0; S.navFocus = true; K.render(); },
  'gal-close': () => { const f = GS(), id = f.open; f.open = null; K.rerender('f-' + id); },
  'gal-clear': () => { Object.assign(GS(), { sil: 'All', fab: 'All', date: 'All time' }); K.rerender('sil'); },
  'v-nav': (_, d) => { const f = GS(), g = K.D.gallery.find(x => x.id === f.open); f.img = (f.img + +d + g.n) % g.n; K.rerender(); },
  'v-img': (_, k) => { GS().img = +k; K.rerender('vt' + k); },
  'v-copy': () => K.toast('Description copied'),
  'v-del': () => { const g = K.D.gallery.find(x => x.id === GS().open); K.dlg({ title: `Delete “${g.name}”?`, body: `<p class="muted">This removes the folder and its ${g.n} photos from Gallery. This can’t be undone.</p>`, from: 'v-del', actions: [{ label: 'Cancel', act: 'close-dlg', autofocus: true }, { label: 'Delete folder', act: 'v-del-ok', cls: 'btn-danger' }] }); },
  'v-del-ok': () => { const f = GS(); K.D.gallery = K.D.gallery.filter(x => x.id !== f.open); f.open = null; K.closeDlg(); S.navFocus = true; K.render(); K.toast('Folder deleted'); },
});
document.addEventListener('change', e => {
  const k = e.target.dataset?.filter; if (!k || S.route !== 'gallery') return;
  GS()[k] = e.target.value; K.rerender(k);
});
})();
