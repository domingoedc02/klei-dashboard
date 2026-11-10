/* upload.js — empty/drop, processing, review (cluster edit), save */
(() => {
const K = window.K, S = K.S, esc = K.esc, icon = K.icon;
const U = () => (S.ui.up ||= { phase: 'empty', cur: 0, pct: 0, sel: [], groups: null, err: false });
const ensure = g => (g.imgs ||= Array.from({ length: g.n || 3 }, (_, k) => ({ v: k % 5 })));
const fresh = () => K.D.groups.map(g => ({ ...g, imgs: Array.from({ length: g.n }, (_, k) => ({ v: k })) }));
const conf = c => c >= 90 ? ['High', 'pill-green'] : c >= 80 ? ['Medium', 'pill-gray'] : ['Low · check', 'pill-warn'];
const TAGS = [['sil', 'Silhouette'], ['fab', 'Fabric'], ['neck', 'Neckline'], ['slv', 'Sleeve'], ['trn', 'Train']];
const setTag = (g, k, v) => { g[k] = v; if (k === 'sil' && v[0]) g.kind = ({ 'A-line': 'aline', 'Mermaid': 'mermaid', 'Ball gown': 'ball' })[v[0]] || g.kind; };
// Reuses the combobox handlers below via data-tag; arrays are replaced, never mutated, because groups are shallow copies of seed data.
const tagbox = (g, k, label) => {
  const id = 'tb-' + k, vals = g[k], opts = K.D.tax[label].filter(o => !vals.includes(o));
  return `<div class="field"><label for="${id}">${label}</label><div class="tagbox" role="group" aria-label="${label}">${vals.map(v => `<span class="chip">${esc(v)}<button type="button" data-act="tag-rm" data-arg="${k}|${esc(v)}" aria-label="Remove ${esc(v)} from ${label}">${icon('x')}</button></span>`).join('')}
    <input class="tb-in" id="${id}" role="combobox" aria-expanded="false" aria-controls="${id}-l" aria-autocomplete="list" autocomplete="off" data-tag="${k}" data-fk="${id}" placeholder="${vals.length ? 'Add…' : 'Select…'}">
    <ul class="combo-list" id="${id}-l" role="listbox" aria-label="${label}" hidden>${opts.map((o, n) => `<li role="option" id="${id}-${n}" data-name="${esc(o)}" data-s="${esc(o.toLowerCase())}" aria-selected="false"><span class="sm semi">${esc(o)}</span></li>`).join('')}<li class="combo-empty sm muted" role="presentation" hidden>${opts.length ? 'No match' : 'All options added'}</li></ul></div></div>`;
};
const combo = (id, label, help, opts, val, btn) => {
  const cur = opts.find(o => o.id === val);
  return `<div class="org-row"><label class="lbl" for="${id}">${label}</label><span class="help" id="${id}-h">${help}</span>
    <div class="od-row"><div class="combo"><span class="combo-ic" aria-hidden="true">${icon('search')}</span>
      <input class="input" id="${id}" role="combobox" aria-expanded="false" aria-controls="${id}-l" aria-autocomplete="list" aria-describedby="${id}-h" autocomplete="off" placeholder="${opts.length ? 'Search gowns…' : 'No other gowns yet'}" value="${esc(cur?.name || '')}" data-val="${cur ? cur.id : ''}" ${opts.length ? '' : 'disabled'}>
      <ul class="combo-list" id="${id}-l" role="listbox" aria-label="${label}" hidden>${opts.map(o => `<li role="option" id="${id}-${o.id}" data-gid="${o.id}" data-name="${esc(o.name)}" data-s="${esc((o.name + ' ' + o.sil + ' ' + o.fab).toLowerCase())}" aria-selected="${o === cur}"><span class="sm semi">${esc(o.name)}</span><span class="xs muted">${o.imgs.length} photos · ${K.L(o.sil)} · ${K.L(o.fab)}</span></li>`).join('')}<li class="combo-empty sm muted" role="presentation" hidden>No gowns match</li></ul></div>${btn}</div></div>`;
};
const steps = ['Reading 30 photos', 'Grouping images of the same gown', 'Tagging silhouette, fabric, neckline', 'Writing descriptions'];

K.views.upload = () => {
  const u = U();
  const head = (right = '') => `<div class="page-head"><div><h1 id="view-h" tabindex="-1">AI Upload</h1><p class="muted sm" style="margin-top:4px">Drop photos. AI groups the same gown, tags it, and drafts a description.</p></div>
    <div class="stsel"><span class="xs muted" id="usl">Wireframe state</span><div class="seg" role="group" aria-labelledby="usl">${['empty', 'processing', 'review', 'error'].map(x => `<button data-act="up-state" data-arg="${x}" aria-pressed="${u.phase === x}">${x[0].toUpperCase() + x.slice(1)}</button>`).join('')}</div></div>${right}</div>`;

  if (u.phase === 'processing') {
    const i = Math.min(3, Math.floor(u.pct / 25));
    return `<div class="page">${head()}<div class="proc card"><div class="od-stack" style="--od-gap:8px"><div class="od-row" style="justify-content:space-between"><h2 id="proc-h">AI is grouping images</h2><span class="sm semi" id="pct">${u.pct}%</span></div>
      <div class="bar" id="pbar" style="--w:${u.pct}%" role="progressbar" aria-labelledby="proc-h" aria-valuenow="${u.pct}" aria-valuemin="0" aria-valuemax="100"><i></i></div></div>
      <ol class="steps" style="list-style:none;margin:0;padding:0" aria-live="polite">${steps.map((s, k) => `<li class="step ${k < i ? 'done' : k === i ? 'now' : ''}"><span class="mk">${k < i ? icon('check') : k === i ? '<i></i>' : ''}</span>${s}</li>`).join('')}</ol>
      <div class="od-grid" style="--od-cols:10;--od-gap:6px" aria-hidden="true">${Array.from({ length: 30 }, (_, k) => `<span class="skel" style="aspect-ratio:3/4;${k < u.pct * .3 ? 'animation:none;background:#d9d6d3' : ''}"></span>`).join('')}</div>
      <div><button class="btn btn-secondary" data-act="up-cancel" data-fk="cancel">Cancel</button></div></div></div>`;
  }

  if (u.phase === 'review') {
    const gs = u.groups ||= fresh(); gs.forEach(ensure);
    const g = gs[Math.min(u.cur, gs.length - 1)], total = gs.reduce((a, x) => a + x.imgs.length, 0), low = gs.filter(x => x.conf < 80).length;
    const [cl, cc] = conf(g.conf);
    const others = gs.filter(x => x !== g), to = u.to ||= {}, tv = id => others.some(o => o.id === id);
    return `<div class="page">${head()}
      <div class="banner" style="margin-bottom:16px">${icon('spark')}<span><b>${total} photos → ${gs.length} gowns.</b> ${low ? `${low} group${low > 1 ? 's' : ''} with low confidence, worth a look.` : 'All groups look confident.'} Nothing is saved until you confirm.</span></div>
      <div class="rv"><div><h2 style="margin-bottom:8px">Gown groups</h2><div class="rv-list" role="list">${gs.map((x, k) => { const [l, c] = conf(x.conf); return `<button role="listitem" class="gl" data-act="up-cur" data-arg="${k}" data-fk="gl${k}" ${x === g ? 'aria-current="true"' : ''}>
        <span class="od-row"><span class="sm semi od-fill od-truncate">${esc(x.name)}</span><span class="pill ${c}">${l}</span></span>
        <span class="strip">${x.imgs.slice(0, 5).map(m => K.ph(x.kind, x.fab, m.v, '', '')).join('')}</span><span class="xs muted">${x.imgs.length} photos · ${K.L(x.sil)} · ${K.L(x.fab)}</span></button>`; }).join('')}</div></div>

      <section class="card od-stack" style="--od-gap:16px" aria-labelledby="gh">
        <div class="od-row"><div class="od-fill field"><label for="gname" class="lbl">Gown name <span class="muted xs">(auto-named, editable)</span></label><input class="input" id="gname" value="${esc(g.name)}" data-bind="name"></div>
          <div class="conf" style="align-self:flex-end;padding-bottom:8px"><span>Confidence ${g.conf}%</span><div class="bar ${g.conf < 80 ? 'gray' : ''}" style="--w:${g.conf}%" role="img" aria-label="AI confidence ${g.conf} percent, ${cl}"><i></i></div><span class="pill ${cc}">${cl}</span></div></div>

        <div><div class="od-row" style="justify-content:space-between;margin-bottom:8px"><h3 id="gh">Photos in this group (${g.imgs.length})</h3><span class="xs muted">Select photos to move or split</span></div>
          <div class="thumbs">${g.imgs.map((m, k) => `<button class="th" data-act="up-sel" data-arg="${k}" data-fk="th${k}" aria-pressed="${u.sel.includes(k)}" aria-label="Photo ${k + 1}, view ${m.v + 1}">${K.ph(g.kind, g.fab, m.v, '', 'Photo ' + (k + 1))}<span class="tick">${u.sel.includes(k) ? icon('check') : ''}</span></button>`).join('')}</div>
          <div class="org" role="group" aria-label="Organize this group">
            ${combo('mvto', 'Move selected photos to', u.sel.length ? `${u.sel.length} photo${u.sel.length > 1 ? 's' : ''} selected. Type a gown name to search.` : 'Select photos above first, then choose a gown.', others, to.mvto, `<button class="btn btn-secondary" data-for="mvto" data-needs-sel data-act="up-move" ${u.sel.length && tv(to.mvto) ? '' : 'disabled'}>${icon('move')}Move${u.sel.length ? ' ' + u.sel.length : ''}</button>`)}
            ${combo('mgto', 'Merge this whole gown into', `Moves all ${g.imgs.length} photos into the gown you pick and removes this group.`, others, to.mgto, `<button class="btn btn-secondary" data-for="mgto" data-act="up-merge" ${tv(to.mgto) ? '' : 'disabled'}>${icon('merge')}Merge</button>`)}
            <div class="org-row"><span class="lbl">Split selected photos into a new gown</span><span class="help">${u.sel.length >= g.imgs.length ? 'Leave at least one photo in this gown.' : u.sel.length ? `Creates “${esc(g.name)} II” from the ${u.sel.length} selected.` : 'Select photos above first. They become a separate gown.'}</span>
              <div><button class="btn btn-secondary" data-act="up-split" ${u.sel.length && u.sel.length < g.imgs.length ? '' : 'disabled'}>${icon('split')}Split into new gown</button></div></div></div></div>

        <div class="tags-grid">${TAGS.map(([k, l]) => tagbox(g, k, l)).join('')}</div>
        <div class="field"><div class="od-row" style="justify-content:space-between"><label for="gdesc">AI-written description</label><button class="btn btn-ghost btn-sm" style="width:auto" data-act="up-regen" data-fk="regen">${icon('refresh')}Rewrite</button></div>
          <textarea class="textarea" id="gdesc" data-bind="desc">${esc(g.desc)}</textarea><span class="help">Edit freely. Your changes are kept when you save.</span></div></section></div>

      <div class="savebar"><span class="sm muted">${gs.length} gowns · ${total} photos will be added to Gallery</span><div class="od-row"><button class="btn btn-secondary" data-act="up-discard" data-fk="discard">Discard batch</button><button class="btn btn-primary" data-act="up-save" data-fk="save">Confirm and save ${gs.length} gowns</button></div></div></div>`;
  }

  const err = u.phase === 'error';
  return `<div class="page">${head()}${err ? `<div class="err-summary" role="alert" style="margin-bottom:16px"><b>2 files couldn’t be uploaded.</b> <span>wedding-fitting.heic is over 25 MB and notes.pdf isn’t an image. Remove them or convert to JPG or PNG, then retry.</span></div>` : ''}
    <div class="drop" id="drop"><div class="drop-inner">${K.illo(3)}<h2 style="font-size:26px;letter-spacing:-0.024em">Drop gown photos here</h2>
      <p class="muted">JPG, PNG or WebP up to 25 MB each. Upload up to 100 at once and AI groups them.</p>
      <input type="file" id="files" multiple accept="image/jpeg,image/png,image/webp" class="sr-only"><label for="files" class="btn btn-primary" id="files-l" tabindex="0" data-fk="choose" role="button">${err ? 'Retry upload' : 'Choose photos'}</label>
      <button class="btn btn-ghost btn-sm" data-act="up-sample" data-fk="sample">Try with 30 sample photos</button></div></div></div>`;
};

K.after.upload = () => {
  const u = U(), d = document.getElementById('drop');
  clearInterval(K.timer);
  if (u.phase === 'processing') K.timer = setInterval(() => {
    u.pct = Math.min(100, u.pct + 5);
    if (u.pct >= 100) { clearInterval(K.timer); u.phase = 'review'; u.cur = 0; u.groups = null; K.go('upload'); return; }
    K.rerender();
  }, 350);
  if (d) {
    ['dragenter', 'dragover'].forEach(e => d.addEventListener(e, ev => { ev.preventDefault(); d.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(e => d.addEventListener(e, ev => { ev.preventDefault(); d.classList.remove('over'); }));
    d.addEventListener('drop', () => start());
    document.getElementById('files').addEventListener('change', e => { if (e.target.files.length) start(); });
    document.getElementById('files-l').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); document.getElementById('files').click(); } });
  }
};
const start = () => { const u = U(); u.phase = 'processing'; u.pct = 0; u.groups = null; u.sel = []; K.rerender(); };

const cur = () => { const u = U(); return u.groups[Math.min(u.cur, u.groups.length - 1)]; };
Object.assign(K.acts, {
  'up-state': (_, s) => { const u = U(); u.phase = s; u.pct = s === 'processing' ? 40 : 0; u.sel = []; if (s === 'review' && !u.groups) u.groups = fresh(); K.rerender(); },
  'up-sample': start,
  'up-cancel': () => { clearInterval(K.timer); U().phase = 'empty'; K.rerender('choose'); },
  'up-cur': (_, k) => { const u = U(); u.cur = +k; u.sel = []; u.to = {}; K.rerender('gl' + k); },
  'up-sel': (_, k) => { const u = U(), i = +k; u.sel = u.sel.includes(i) ? u.sel.filter(x => x !== i) : [...u.sel, i]; K.rerender('th' + k); },
  'up-move': () => {
    const u = U(), g = cur(), t = u.groups.find(x => x.id === u.to?.mvto);
    if (!t || !u.sel.length) return;
    const moved = g.imgs.filter((_, i) => u.sel.includes(i)); g.imgs = g.imgs.filter((_, i) => !u.sel.includes(i)); t.imgs.push(...moved);
    u.sel = []; if (!g.imgs.length) { u.groups = u.groups.filter(x => x !== g); u.cur = 0; }
    K.rerender(); K.toast(`Moved ${moved.length} photo${moved.length > 1 ? 's' : ''} to ${t.name}`);
  },
  'up-split': () => {
    const u = U(), g = cur(); if (!u.sel.length || u.sel.length >= g.imgs.length) return;
    const moved = g.imgs.filter((_, i) => u.sel.includes(i)); g.imgs = g.imgs.filter((_, i) => !u.sel.includes(i));
    const ng = { ...g, id: 'u' + Date.now(), name: g.name + ' II', imgs: moved, n: moved.length, conf: 70 };
    u.groups.splice(u.groups.indexOf(g) + 1, 0, ng); u.cur = u.groups.indexOf(ng); u.sel = []; K.rerender(); K.toast('Split into a new gown. Check its tags.');
  },
  'up-merge': () => {
    const u = U(), g = cur(), t = u.groups.find(x => x.id === u.to?.mgto); if (!t) return;
    t.imgs.push(...g.imgs); u.groups = u.groups.filter(x => x !== g); u.cur = u.groups.indexOf(t); u.sel = []; u.to = {}; K.rerender(); K.toast(`Merged into ${t.name}`);
  },
  'up-regen': () => {
    const g = cur(), lf = new Intl.ListFormat('en'), bits = TAGS.filter(([k]) => g[k].length).map(([k, l]) => `${l.toLowerCase()}: ${lf.format(g[k].map(x => x.toLowerCase()))}`);
    g.desc = `${g.name}${bits.length ? ` (${bits.join('; ')})` : ' has no tags yet'}. Soft, structured and ready for a modern ceremony.`; K.rerender('regen');
  },
  'tag-rm': (_, v) => { const [k, x] = v.split('|'), g = cur(); setTag(g, k, g[k].filter(y => y !== x)); K.rerender('tb-' + k); },
  'up-discard': () => K.dlg({ title: 'Discard this batch?', body: '<p class="muted">The 30 uploaded photos and every AI group will be removed. This can’t be undone.</p>', from: 'discard', actions: [{ label: 'Keep reviewing', act: 'close-dlg', autofocus: true }, { label: 'Discard batch', act: 'up-discard-ok', cls: 'btn-danger' }] }),
  'up-discard-ok': () => { K.closeDlg(); S.ui.up = { phase: 'empty', cur: 0, pct: 0, sel: [], groups: null }; K.go('upload'); K.toast('Batch discarded'); },
  'up-save': () => {
    const u = U(), n = u.groups.length; K.D.gallery.forEach(g => g.isNew = false);
    u.groups.slice().reverse().forEach((g, i) => K.D.gallery.unshift({ ...g, id: 'n' + Date.now() + i, n: g.imgs.length, date: '2026-11-07', label: 'Nov 7, 2026', isNew: i === u.groups.length - 1 }));
    S.ui.up = { phase: 'empty', cur: 0, pct: 0, sel: [], groups: null }; S.ui.gal = {}; K.go('upload'); K.toast(`${n} gowns saved to Gallery`);
  },
});
const cb = e => e.target.matches?.('[role="combobox"]') ? e.target : null;
const list = i => document.getElementById(i.getAttribute('aria-controls'));
const shown = l => [...l.querySelectorAll('[role="option"]:not([hidden])')];
const mark = (i, o) => { list(i).querySelectorAll('.on').forEach(x => x.classList.remove('on')); if (o) { o.classList.add('on'); o.scrollIntoView({ block: 'nearest' }); i.setAttribute('aria-activedescendant', o.id); } else i.removeAttribute('aria-activedescendant'); };
const show = (i, on) => { list(i).hidden = !on; i.setAttribute('aria-expanded', String(on)); if (!on) mark(i); };
const find = (i, q) => { const l = list(i); q = q.trim().toLowerCase(); const m = [...l.querySelectorAll('[role="option"]')].filter(o => !(o.hidden = !o.dataset.s.includes(q))); l.querySelector('.combo-empty').hidden = m.length > 0; mark(i, m.find(o => o.getAttribute('aria-selected') === 'true') || m[0]); };
const sync = i => { const b = document.querySelector(`[data-for="${i.id}"]`); if (b) b.disabled = !i.dataset.val || (b.hasAttribute('data-needs-sel') && !U().sel.length); };
const pick = (i, o) => { if (i.dataset.tag) { const g = cur(), k = i.dataset.tag; setTag(g, k, [...g[k], o.dataset.name]); return K.rerender(i.id); } i.value = o.dataset.name; i.dataset.val = o.dataset.gid; (U().to ||= {})[i.id] = o.dataset.gid; list(i).querySelectorAll('[role="option"]').forEach(x => x.setAttribute('aria-selected', String(x === o))); show(i, false); sync(i); };
const open = i => { find(i, ''); show(i, true); };
document.addEventListener('focusin', e => { const i = cb(e); if (i) { i.select(); open(i); } });
document.addEventListener('click', e => { const i = cb(e); if (i && list(i).hidden) open(i); if (e.target.classList?.contains('tagbox')) e.target.querySelector('input').focus(); });
document.addEventListener('focusout', e => { const i = cb(e); if (!i || !list(i)) return; i.value = list(i).querySelector('[aria-selected="true"]')?.dataset.name || ''; i.dataset.val = U().to?.[i.id] || ''; show(i, false); });
document.addEventListener('mousedown', e => { const o = e.target.closest?.('.combo-list [role="option"]'); if (o) { e.preventDefault(); pick(document.getElementById(o.parentElement.id.replace(/-l$/, '')), o); } });
document.addEventListener('keydown', e => {
  const i = cb(e); if (!i) return;
  if (e.key === 'Backspace' && i.dataset.tag && !i.value) { const g = cur(), k = i.dataset.tag; if (g[k].length) { setTag(g, k, g[k].slice(0, -1)); K.rerender(i.id); } return; }
  const l = list(i), v = shown(l), k = v.indexOf(l.querySelector('.on'));
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (l.hidden) return open(i); if (v.length) mark(i, v[(k + (e.key === 'ArrowDown' ? 1 : -1) + v.length) % v.length]); }
  else if (e.key === 'Enter' && !l.hidden) { e.preventDefault(); const o = l.querySelector('.on'); if (o) pick(i, o); }
  else if (e.key === 'Escape' && !l.hidden) { e.preventDefault(); i.value = l.querySelector('[aria-selected="true"]')?.dataset.name || ''; show(i, false); }
});
document.addEventListener('input', e => {
  const c = cb(e); if (c) { delete (U().to ||= {})[c.id]; c.dataset.val = ''; list(c).querySelectorAll('[aria-selected="true"]').forEach(x => x.setAttribute('aria-selected', 'false')); find(c, c.value); show(c, true); sync(c); return; }
  const b = e.target.dataset?.bind; if (!b || S.route !== 'upload') return;
  cur()[b] = e.target.value;
});
})();
