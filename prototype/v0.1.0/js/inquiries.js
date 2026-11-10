/* inquiries.js — 2-pane inbox + email-style thread */
(() => {
const K = window.K, S = K.S, esc = K.esc, icon = K.icon;
const Q = () => {
  const q = (S.ui.inq ||= { sel: 'i1', filter: 'All', state: 'default', drafts: {} });
  if (S.ui.pendingOpen && S.route === 'inquiries') { const id = S.ui.pendingOpen; delete S.ui.pendingOpen; if (K.D.inq.some(i => i.id === id)) { q.sel = id; q.filter = 'All'; S.read[id] = true; } }
  return q;
};
const stOf = i => S.inqSt[i.id];
const pill = s => `<span class="pill ${s === 'New' ? 'pill-blue' : s === 'Replied' ? 'pill-green' : 'pill-gray'}">${s}</span>`;

K.views.inquiries = (sub) => {
  if (sub === 'profile') return profile();
  const q = Q(), all = K.D.inq, f = q.filter;
  const items = q.state === 'empty' ? [] : all.filter(i => f === 'All' || stOf(i) === f);
  const cur = all.find(i => i.id === q.sel);
  const list = q.state === 'loading' ? Array.from({ length: 5 }, () => '<div style="padding:16px;border-bottom:1px solid var(--border-soft)" class="od-stack"><span class="skel" style="height:14px;width:50%"></span><span class="skel" style="height:12px;width:80%"></span></div>').join('') :
    items.length ? items.map(i => `<button class="ti ${i.unread && !S.read[i.id] ? 'unread' : ''}" data-act="inq-sel" data-arg="${i.id}" data-fk="ti-${i.id}" ${i.id === q.sel ? 'aria-current="true"' : ''}>
      <span class="od-row"><span class="ti-name sm od-fill od-truncate" data-cust="${i.id}">${esc(i.name)}</span><span class="xs muted od-nowrap">${i.time}</span></span><span class="sm od-truncate ${i.unread && !S.read[i.id] ? 'semi' : ''}">${esc(i.subj)}</span>
      <span class="od-row"><span class="xs muted od-fill od-truncate">${esc(i.pre)}</span>${pill(stOf(i))}</span></button>`).join('') :
    K.empty({ art: 5, compact: true, title: all.length && q.state !== 'empty' ? `No ${f.toLowerCase()} inquiries` : 'No inquiries yet', text: all.length && q.state !== 'empty' ? 'Try another filter to see more messages.' : 'Website inquiries land here as soon as they arrive.', action: all.length && q.state !== 'empty' ? 'Show all' : 'View website form', act: all.length && q.state !== 'empty' ? 'inq-all' : 'inq-demo', fk: 'inq-empty' });

  const hasThread = !(!cur || q.state !== 'default' && !items.length);
  return `<div class="inq" id="view-h" tabindex="-1">
    <section class="pane" aria-label="Inbox"><div class="pane-head"><div class="od-row" style="justify-content:space-between"><h1 style="font-size:20px">Inquiries</h1>
      <div class="seg" role="group" aria-label="Wireframe state">${['default', 'loading', 'empty'].map(x => `<button data-act="inq-state" data-arg="${x}" aria-pressed="${q.state === x}">${x[0].toUpperCase() + x.slice(1)}</button>`).join('')}</div></div>
      <div class="mini-tabs" role="group" aria-label="Filter by status">${['All', 'New', 'Replied', 'Closed'].map(x => `<button data-act="inq-filter" data-arg="${x}" aria-pressed="${f === x}">${x}</button>`).join('')}</div></div>
      <div class="pane-body">${list}</div></section>
    <section class="pane" aria-label="Conversation">${!hasThread ? `<div class="pane-body">${K.empty({ art: 6, title: 'Select an inquiry', text: 'Pick a message on the left to read and reply.', action: 'Open first message', act: 'inq-first', fk: 'inq-first' })}</div>` : thread(cur, q)}</section></div>`;
};

const custOf = id => { const i = K.D.inq.find(x => x.id === id); return i && K.D.cust.find(c => c.mail === i.mail); };
const ini = n => n.split(' ').map(w => w[0]).join('');

const profile = () => {
  const c = K.D.cust.find(x => x.id === S.ui.cust);
  const back = `<nav class="crumbs" aria-label="Breadcrumb"><button data-act="cust-back" data-fk="back">Inquiries</button>${icon('cr')}<span aria-current="page">${c ? esc(c.name) : 'Customer'}</span></nav>`;
  if (!c) return `<div class="page">${back}<h1 id="view-h" tabindex="-1">Customer not found</h1></div>`;
  const inqs = K.D.inq.filter(i => i.mail === c.mail);
  const kv = [['Full name', c.name], ['Email', c.mail], ['Phone', c.phone], ['City', c.city], ['Wedding date', c.wedding], ['Heard about us', c.source], ['Customer since', c.since], ['Notes', c.note]];
  return `<div class="page">${back}
    <div class="page-head"><div class="od-row" style="gap:16px"><span class="avatar lg" aria-hidden="true">${ini(c.name)}</span><div><h1 id="view-h" tabindex="-1">${esc(c.name)}</h1><span class="sm muted">${esc(c.city)} · Wedding ${esc(c.wedding)}</span></div></div>
      <a class="btn btn-secondary" href="mailto:${esc(c.mail)}">${icon('mail')}Email ${esc(c.name.split(' ')[0])}</a></div>
    <div class="cprof"><section class="card od-stack" style="--od-gap:16px" aria-labelledby="pd-h"><h2 id="pd-h">Personal details</h2>
        <dl class="kv">${kv.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl></section>
      <section class="card od-stack" style="--od-gap:8px" aria-labelledby="ai-h"><h2 id="ai-h">All inquiries <span class="muted">(${inqs.length})</span></h2>
        <div>${inqs.map(i => `<button class="list-row link" data-go="inquiries" data-open="${i.id}"><span class="od-fill"><span class="sm semi od-truncate" style="display:block">${esc(i.subj)}</span><span class="xs muted od-truncate" style="display:block">${esc(i.pre)}</span></span><span class="xs muted od-nowrap">${i.time}</span>${pill(stOf(i))}</button>`).join('')}</div></section></div></div>`;
};

// Hover card: DOM-inserted (not state-rendered) so a re-render never fights the pointer.
// shortcut: mouse/focus only on [data-cust] triggers; keyboard users open the profile via the focusable name button. Touch has no hover.
let hc, cur, tm;
const arm = (fn, ms) => { clearTimeout(tm); tm = setTimeout(fn, ms); };
const hide = () => { clearTimeout(tm); hc?.remove(); hc = cur = null; };
const show = el => {
  const c = custOf(el.dataset.cust); if (!c) return;
  hc?.remove(); cur = el;
  const n = K.D.inq.filter(i => i.mail === c.mail).length;
  hc = document.createElement('div'); hc.id = 'hc'; hc.className = 'hc'; hc.setAttribute('role', 'group'); hc.setAttribute('aria-label', `Customer: ${c.name}`);
  hc.innerHTML = `<div class="od-row" style="gap:12px"><span class="avatar" aria-hidden="true">${ini(c.name)}</span><div class="od-fill"><div class="sm semi od-truncate">${esc(c.name)}</div><div class="xs muted od-truncate">${esc(c.mail)}</div></div></div>
    <dl class="kv"><dt>Phone</dt><dd>${esc(c.phone)}</dd><dt>City</dt><dd>${esc(c.city)}</dd><dt>Wedding</dt><dd>${esc(c.wedding)}</dd><dt>Inquiries</dt><dd>${n}</dd></dl>
    <button class="btn btn-secondary btn-sm" data-act="cust-open" data-arg="${el.dataset.cust}">View profile</button>`;
  document.getElementById('app').append(hc);
  const r = el.getBoundingClientRect(), w = hc.offsetWidth, h = hc.offsetHeight;
  hc.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
  hc.style.top = (r.bottom + 6 + h > innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
};
const trig = e => e.target.closest?.('[data-cust]');
document.addEventListener('mouseover', e => {
  const t = trig(e);
  if (t) { if (t === cur && hc?.isConnected) clearTimeout(tm); else arm(() => show(t), hc?.isConnected ? 0 : 250); }
  else if (e.target.closest?.('#hc')) clearTimeout(tm);
});
document.addEventListener('mouseout', e => {
  if ((trig(e) || e.target.closest?.('#hc')) && !e.relatedTarget?.closest?.('[data-cust], #hc')) arm(hide, 150);
});
document.addEventListener('focusin', e => { const t = trig(e); if (t) show(t); });
document.addEventListener('focusout', e => { if (trig(e)) arm(hide, 150); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
document.addEventListener('click', hide);
document.addEventListener('scroll', e => { if (e.target !== document) hide(); }, true);

const thread = (i, q) => {
  const st = stOf(i), done = st === 'Closed', n = 1 + [].concat(i.sent || []).length;
  const cb = `<button class="cust-link" data-cust="${i.id}" data-act="cust-open" data-arg="${i.id}">${esc(i.name)}</button>`;
  const me = K.isAdmin() ? ['Eleanor Park', 'eleanor@kleibridal.com', 'EP'] : ['Marcus Bell', 'marcus@kleibridal.com', 'MB'];
  const mail = (from, addr, init, to, time, paras, cust, x) => `<article class="mail"><header class="mail-h"><span class="avatar" aria-hidden="true"${cust ? ` data-cust="${i.id}"` : ''}>${init}</span><div class="od-fill"><div class="od-row" style="--od-gap:8px"><span class="sm semi">${from}</span><span class="xs muted">&lt;${esc(addr)}&gt;</span></div><span class="xs muted">To: ${to}</span></div><time class="xs muted">${time}</time></header><div class="mail-b">${paras.map(p => `<p class="sm">${esc(p)}</p>`).join('')}${x ? `<div class="rt-v sm">${x.html}</div>${x.sig ? `<p class="sm">${esc(x.sig)}</p>` : ''}${x.files.length ? `<div class="mail-files">${fileChips(x.files)}</div>` : ''}` : ''}</div></article>`;
  return `<div class="pane-head"><div class="od-row"><div class="od-fill"><h2 class="od-truncate">${esc(i.subj)}</h2><span class="xs muted">${n} message${n > 1 ? 's' : ''}</span></div>${pill(st)}</div>
    <div class="od-row"><label class="sr-only" for="stsel">Status</label><select class="select" id="stsel" style="width:140px" data-status>${['New', 'Replied', 'Closed'].map(s => `<option ${s === st ? 'selected' : ''}>${s}</option>`).join('')}</select>
    ${done ? `<button class="btn btn-secondary" data-act="inq-reopen">Reopen</button>` : `<button class="btn btn-secondary" data-act="inq-close">${icon('check')}Close inquiry</button>`}</div></div>
  <div class="pane-body"><div class="mails" aria-label="Messages in ${esc(i.subj)}">${mail(cb, i.mail, ini(i.name), 'Klei Bridal', i.time, i.body, true)}
    ${[].concat(i.sent || []).map(t => typeof t === 'string' ? mail(me[0], me[1], me[2], cb, 'Just now', [t]) : mail(me[0], me[1], me[2], cb, 'Just now', [], false, t)).join('')}</div></div>
  ${done ? `<div class="banner" style="margin:0 24px 16px">${icon('info')}<span>This inquiry is closed. Reopen it to reply.</span></div>` : composer(i, q)}`;
};

const first = i => i.name.split(' ')[0];
const $ = id => document.getElementById(id);
const OK = new Set(['B', 'I', 'U', 'STRONG', 'EM', 'UL', 'OL', 'LI', 'A', 'BR', 'DIV', 'P']);
// shortcut: tag allowlist only (all attributes dropped except safe href), fine for a prototype; use DOMPurify if mail is really sent.
const clean = h => {
  const d = new DOMParser().parseFromString(h || '', 'text/html').body;
  const walk = n => [...n.childNodes].forEach(c => {
    if (c.nodeType === 3) return;
    if (c.nodeType !== 1 || /^(SCRIPT|STYLE)$/.test(c.tagName)) return c.remove();
    walk(c);
    if (!OK.has(c.tagName)) return c.replaceWith(...c.childNodes);
    const href = c.tagName === 'A' && c.getAttribute('href');
    [...c.attributes].forEach(a => c.removeAttribute(a.name));
    if (href && /^(https?:|mailto:)/i.test(href)) { c.setAttribute('href', href); c.setAttribute('target', '_blank'); c.setAttribute('rel', 'noopener'); }
  });
  walk(d); return d.innerHTML;
};
K.cleanHtml = clean;
const MAX = 10 * 1048576, FMT = ['bold', 'italic', 'underline', 'insertUnorderedList'];
const fsize = n => n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const fileChips = (fs, rm) => (fs || []).map((f, n) => `<span class="chip">${icon('file')}<span class="od-truncate" style="max-width:200px">${esc(f.name)}</span><span class="muted">${fsize(f.size)}</span>${rm ? `<button type="button" data-act="inq-rm" data-arg="${n}" aria-label="Remove ${esc(f.name)}">${icon('x')}</button>` : ''}</span>`).join('');
const tb = (c, ic, label) => `<button type="button" class="tb-btn" data-act="${FMT.includes(c) ? 'fmt' : c}" data-arg="${c}" aria-label="${label}" title="${label}"${FMT.includes(c) ? ' aria-pressed="false"' : ''}>${icon(ic)}</button>`;

const composer = (i, q) => `<form class="mail-new" data-submit="send" novalidate aria-label="Reply to ${esc(first(i))}">
  <div class="mail-f"><span class="lbl">To</span><span class="sm">${esc(i.name)} &lt;${esc(i.mail)}&gt;</span></div>
  <div class="mail-f"><span class="lbl">Subject</span><span class="sm">Re: ${esc(i.subj)}</span></div>
  <div class="rte"><div class="rte-tb" role="toolbar" aria-label="Formatting">${tb('bold', 'bold', 'Bold (Ctrl+B)')}${tb('italic', 'italic', 'Italic (Ctrl+I)')}${tb('underline', 'underline', 'Underline (Ctrl+U)')}${tb('insertUnorderedList', 'list', 'Bulleted list')}<span class="tb-sep" aria-hidden="true"></span>${tb('inq-link', 'link', 'Insert link')}${tb('inq-attach', 'clip', 'Attach file')}
    <span class="tb-link" id="c-linkbar" hidden><input class="input" id="c-url" type="text" inputmode="url" placeholder="https://example.com" aria-label="Link URL"><button type="button" class="btn btn-secondary btn-sm" style="width:auto" data-act="link-ok">Apply</button><button type="button" class="tb-btn" data-act="link-x" aria-label="Cancel link">${icon('x')}</button></span></div>
  <div class="rte-ed" id="c-body" data-fk="c-body" data-draft contenteditable="true" role="textbox" aria-multiline="true" aria-label="Message to ${esc(first(i))}" aria-describedby="e-c-body" data-ph="Write your reply…">${clean(q.drafts[i.id])}</div></div>
  <input type="file" id="c-file" multiple hidden tabindex="-1" aria-hidden="true">
  <div class="mail-files" id="c-files" aria-label="Attachments">${fileChips((q.files ||= {})[i.id], true)}</div>
  <span class="err" id="e-c-body" hidden></span>
  <div class="od-row"><button class="btn btn-primary" type="submit" data-fk="send" style="width:auto">${icon('send')}Send</button><span class="xs muted">${S.prefs?.enterSend ? 'Enter to send · Shift+Enter for a new line' : 'Ctrl/⌘ + Enter to send'}${K.sigText?.() ? ' · Signature added on send' : ''}</span></div></form>`;

K.after.inquiries = () => {
  const q = Q(), i = K.D.inq.find(x => x.id === q.sel);
  if (i && S.read[i.id] !== true && i.unread) { /* read on open */ }
};

Object.assign(K.acts, {
  'cust-open': (_, id) => { const c = custOf(id); if (c) K.go('inquiries/profile', { cust: c.id }); },
  'cust-back': () => K.go('inquiries'),
  'inq-state': (_, s) => { Q().state = s; K.rerender(); },
  'inq-filter': (_, f) => { Q().filter = f; K.rerender(); },
  'inq-all': () => { Q().filter = 'All'; K.rerender('inq-empty'); },
  'inq-demo': () => K.toast('Opens the public website form (not part of this prototype)'),
  'inq-first': () => K.acts['inq-sel'](null, K.D.inq[0].id),
  'inq-sel': (_, id) => { const q = Q(); q.sel = id; S.read[id] = true; if (S.inqSt[id] === 'New') { /* stays New until replied */ } K.rerender('ti-' + id); },
  'inq-close': () => { S.inqSt[Q().sel] = 'Closed'; K.rerender(); K.toast('Inquiry closed'); },
  'inq-reopen': () => { S.inqSt[Q().sel] = 'New'; K.rerender(); },
  fmt: (_, c) => { edit(); document.execCommand(c); save(); },
  'inq-link': () => { edit(); $('c-url').removeAttribute('aria-invalid'); $('c-url').value = ''; $('c-linkbar').hidden = false; $('c-url').focus(); },
  'link-ok': () => {
    const u$ = $('c-url'); let u = u$.value.trim();
    if (u && !/^(https?:|mailto:)/i.test(u)) u = /^[^\s@/]+@[^\s@/]+$/.test(u) ? 'mailto:' + u : 'https://' + u;
    try { new URL(u); } catch { u$.setAttribute('aria-invalid', 'true'); u$.focus(); return; }
    $('c-linkbar').hidden = true; edit();
    if (getSelection().isCollapsed) document.execCommand('insertHTML', false, `<a href="${esc(u)}">${esc(u.replace(/^mailto:/, ''))}</a>`);
    else document.execCommand('createLink', false, u);
    save();
  },
  'link-x': () => { $('c-linkbar').hidden = true; edit(); },
  'inq-attach': () => $('c-file').click(),
  'inq-rm': (_, n) => { const q = Q(), a = q.files[q.sel]; a.splice(+n, 1); $('c-files').innerHTML = fileChips(a, true); edit(); },
});
document.addEventListener('change', e => { if (e.target.matches('[data-status]')) { S.inqSt[Q().sel] = e.target.value; K.rerender('stsel'); } });
// shortcut: document.execCommand is deprecated but still universal; swap for a Selection-API editor (Tiptap/Lexical) if this ships.
let lastR;
const save = () => { const ed = $('c-body'); if (!ed.textContent.trim() && !ed.querySelector('li')) ed.innerHTML = ''; Q().drafts[Q().sel] = ed.innerHTML; };
const edit = () => {
  const ed = $('c-body'), s = getSelection(); ed.focus();
  if (lastR && ed.contains(lastR.commonAncestorContainer)) { s.removeAllRanges(); s.addRange(lastR); } else { s.selectAllChildren(ed); s.collapseToEnd(); }
};
document.addEventListener('input', e => { if (e.target.matches('[data-draft]')) save(); });
document.addEventListener('selectionchange', () => {
  const ed = $('c-body'), s = getSelection();
  if (!ed || !s.rangeCount || !ed.contains(s.anchorNode)) return;
  lastR = s.getRangeAt(0).cloneRange();
  document.querySelectorAll('.tb-btn[aria-pressed]').forEach(b => b.setAttribute('aria-pressed', String(document.queryCommandState(b.dataset.arg))));
});
document.addEventListener('mousedown', e => { if (e.target.closest?.('.tb-btn')) e.preventDefault(); });
document.addEventListener('paste', e => { if (e.target.closest?.('[data-draft]')) { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); } });
document.addEventListener('change', e => {
  if (e.target.id !== 'c-file') return;
  const q = Q(), a = (q.files ||= {})[q.sel] ||= [];
  [...e.target.files].forEach(f => f.size > MAX ? K.toast(`${f.name} is over 10 MB`) : a.push({ name: f.name, size: f.size }));
  e.target.value = ''; $('c-files').innerHTML = fileChips(a, true);
});
document.addEventListener('keydown', e => {
  if (e.target.id === 'c-url' && (e.key === 'Enter' || e.key === 'Escape')) { e.preventDefault(); K.acts[e.key === 'Enter' ? 'link-ok' : 'link-x'](); return; }
  if (e.key === 'Enter' && !e.isComposing && (e.metaKey || e.ctrlKey || (!e.shiftKey && S.prefs?.enterSend)) && e.target.matches?.('[data-draft]')) { e.preventDefault(); e.target.closest('form').requestSubmit(); }
});
K.submit.send = () => {
  const q = Q(), body = $('c-body'), eb = $('e-c-body'), ok = !!body.textContent.trim();
  eb.hidden = ok; body.setAttribute('aria-invalid', String(!ok));
  if (!ok) { eb.innerHTML = `${icon('alert')}<span>Write a message before sending.</span>`; body.focus(); return; }
  const i = K.D.inq.find(x => x.id === q.sel);
  i.sent = [].concat(i.sent || [], { html: clean(body.innerHTML), sig: K.sigText?.() || '', files: q.files[i.id] || [] });
  S.inqSt[i.id] = 'Replied'; delete q.drafts[i.id]; delete q.files[i.id]; K.rerender('c-body');
  const pb = document.querySelector('[aria-label=Conversation] .pane-body'); if (pb) pb.scrollTop = pb.scrollHeight;
  K.toast(`Reply sent to ${first(i)}`);
};
})();
