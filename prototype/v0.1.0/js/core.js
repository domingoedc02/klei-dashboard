/* core.js — namespace, helpers, icons, art, router, dialogs, shell */
(() => {
const K = window.K = {
  S: { route: 'auth/login', role: 'admin', menu: null, q: '', fk: null, navFocus: false, notifs: null, ui: {} },
  acts: {}, views: {}, after: {},
};
const S = K.S;

K.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const esc = K.esc;

const P = {
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/>',
  upload: '<path d="M12 16V5"/><path d="M7 9l5-5 5 5"/><path d="M5 19h14"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  bell: '<path d="M6 16V11a6 6 0 0112 0v5l2 2H4z"/><path d="M10 21h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  cr: '<path d="M9 6l6 6-6 6"/>',
  cl: '<path d="M15 6l-6 6 6 6"/>',
  cd: '<path d="M6 9l6 6 6-6"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  merge: '<path d="M6 4v6a4 4 0 004 4h8M18 14l-3-3M18 14l-3 3M6 20v-6"/>',
  split: '<path d="M12 20v-8M12 12L6 5M12 12l6-7M6 5h4M6 5v4M18 5h-4M18 5v4"/>',
  move: '<path d="M5 12h14M15 8l4 4-4 4M9 8l-4 4 4 4"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  bold: '<path d="M7 5h6a3.5 3.5 0 010 7H7zM7 12h7a3.5 3.5 0 010 7H7z"/>',
  italic: '<path d="M10 5h8M6 19h8M14 5l-4 14"/>',
  underline: '<path d="M7 4v7a5 5 0 0010 0V4M5 20h14"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  clip: '<path d="M21 11.5l-8.6 8.6a5.5 5.5 0 01-7.8-7.8l8.6-8.6a3.7 3.7 0 015.2 5.2l-8.6 8.6a1.8 1.8 0 01-2.6-2.6l7.9-7.9"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3A4 4 0 0011 18.7l1-1"/>',
  send: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 6.1A9.6 9.6 0 0112 6c6 0 10 6 10 6a17 17 0 01-3 3.6M6.5 7.5A17 17 0 002 12s4 7 10 7a9.4 9.4 0 004-.9"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-5 7-5s7 1.5 7 5M16 5a3.5 3.5 0 010 7M22 20c0-3-2-4.5-4-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  folder: '<path d="M3 6a2 2 0 012-2h4l2 3h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  dots: '<path d="M5 12h.01M12 12h.01M19 12h.01"/>',
  logout: '<path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4-2v-4z"/>',
  refresh: '<path d="M20 11a8 8 0 00-14-4L4 9M4 4v5h5M4 13a8 8 0 0014 4l2-2M20 20v-5h-5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  key: '<circle cx="8" cy="14" r="4"/><path d="M11 11l9-8M16 6l3 3"/>',
  file: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5M9 13h7M9 17h7"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1"/>',
  tone: '<path d="M4 12h3l3-7 4 14 3-7h3"/>',
  sum: '<path d="M4 6h16M4 12h16M4 18h9"/>',
  star: '<path d="M12 3l2.7 5.8 6.3.7-4.7 4.3 1.3 6.2L12 17l-5.6 3 1.3-6.2L3 9.5l6.3-.7z"/>',
  mailopen: '<path d="M3 10l9-6 9 6v10H3z"/><path d="M3 10l9 6 9-6"/>',
};
K.icon = (n, cls = '') => `<svg class="od-icon ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${P[n] || ''}</svg>`;
const icon = K.icon;

/* Grayscale wireframe gown "photo". kind: aline|mermaid|ball; v: 0 front 1 side 2 back 3 bodice detail 4 hem detail */
const G = {
  aline: 'M52 30 L68 30 L66 70 L98 146 Q60 154 22 146 L54 70 Z',
  mermaid: 'M52 30 L68 30 L67 70 Q70 110 66 118 L84 146 Q60 152 36 146 L54 118 Q50 110 53 70 Z',
  ball: 'M52 30 L68 30 L66 66 Q112 90 108 146 Q60 156 12 146 Q8 90 54 66 Z',
};
const FAB = { Lace: 'url(#pat-lace)', Tulle: 'url(#pat-tulle)', Mikado: '#ffffff' };
K.ph = (kind = 'aline', fabric = 'Mikado', v = 0, cls = '', label = '') => {
  const vb = v === 3 ? '34 14 52 68' : v === 4 ? '10 96 100 64' : '0 0 120 160';
  const tf = v === 1 ? 'translate(18 0) scale(0.7 1)' : '';
  const back = v === 2 ? '<path d="M60 32V68" stroke-dasharray="1.5 4" stroke-width="2.5"/>' : '';
  const alt = label || `${kind} gown, view ${v + 1}`;
  return `<span class="ph ${cls}" role="img" aria-label="${esc(alt)}"><svg viewBox="${vb}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect x="-20" y="-20" width="160" height="200" fill="#ebe9e7"/>
    <g transform="${tf}"><circle cx="60" cy="19" r="6" fill="#fff" stroke="currentColor" stroke-width="1.5"/>
    <path d="${G[kind] || G.aline}" fill="${FAB[[].concat(fabric)[0]] || '#fff'}" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>${back}</g>
    <path d="M10 152H110" stroke="currentColor" stroke-width="1" opacity=".35"/></svg></span>`;
};
K.defs = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <pattern id="pat-lace" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#fff"/><circle cx="3" cy="3" r="1" fill="#a39e98"/></pattern>
  <pattern id="pat-tulle" width="5" height="5" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="#fff"/><path d="M0 0L5 5M5 0L0 5" stroke="#c9c5c0" stroke-width=".6"/></pattern>
</defs></svg>`;

/* Shared Notion-style line-art empty-state illustration: woman in a gown */
K.illo = (n = 1) => `<img class="illo" src="assets/empty/empty-gown-${n}.png" alt="">`;
K.empty = ({ art, title, text, action, go, act, compact = false, fk = 'empty-cta' }) => `<div class="empty ${compact ? 'compact' : ''}">${K.illo(art)}<h2>${esc(title)}</h2><p>${esc(text)}</p>
  ${action ? `<button class="btn btn-primary" data-fk="${fk}" ${go ? `data-go="${go}"` : `data-act="${act}"`}>${esc(action)}</button>` : ''}</div>`;

K.toast = (msg) => {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `${icon('check')}<span>${esc(msg)}</span>`;
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), 3200);
};

/* Dialogs: native <dialog>, focus returns to the trigger by its stable data-fk */
K.dlg = ({ title, body, actions = [], from }) => {
  const d = document.getElementById('dlg');
  K.dlgFrom = from || document.activeElement?.dataset?.fk || null;
  d.innerHTML = `<h2 id="dlg-title">${esc(title)}</h2><div class="od-stack" style="--od-gap:16px;margin-top:12px">${body}</div>
    <div class="dlg-actions">${actions.map(a => `<button class="btn ${a.cls || 'btn-secondary'}" data-act="${a.act}" ${a.arg ? `data-arg="${esc(a.arg)}"` : ''} ${a.autofocus ? 'autofocus' : ''}>${esc(a.label)}</button>`).join('')}</div>`;
  d.showModal();
};
K.closeDlg = () => {
  const d = document.getElementById('dlg');
  if (d.open) d.close();
};
document.getElementById('dlg').addEventListener('close', () => {
  const t = K.dlgFrom && document.querySelector(`[data-fk="${K.dlgFrom}"]`);
  (t || document.getElementById('view-h') || document.querySelector('#app button'))?.focus();
});

/* Router: state-driven, no reliance on location */
K.go = (route, opts = {}) => {
  S.route = route; S.menu = null; S.navFocus = true; S.fk = null;
  Object.assign(S.ui, opts);
  K.render();
};
K.render = () => {
  const [area, sub] = S.route.split('/');
  const fn = area === 'auth' ? K.views.auth : K.views[area];
  const app = document.getElementById('app');
  const scroll = app.querySelector('.view')?.scrollTop || 0;
  app.innerHTML = K.defs + (area === 'auth' ? fn(sub) : K.shell(area, fn(sub)));
  K.after[area]?.(sub);
  K.aiScroll?.();
  if (S.fk) { document.querySelector(`[data-fk="${S.fk}"]`)?.focus(); }
  else if (S.navFocus) { (document.getElementById('view-h') || document.querySelector('[data-autofocus]'))?.focus(); }
  const v = app.querySelector('.view'); if (v && !S.navFocus) v.scrollTop = scroll;
  S.navFocus = false;
};
K.rerender = (fk) => { S.fk = fk || null; K.render(); S.fk = null; };

const NAV = [['dashboard', 'Dashboard', 'home'], ['upload', 'AI Upload', 'upload'], ['gallery', 'Gallery', 'image'], ['inquiries', 'Inquiries', 'mail'], ['settings', 'Settings', 'settings']];
K.shell = (active, content) => `<div class="shell">
  <aside class="sidebar"><div class="brand"><span class="brand-mark" aria-hidden="true">K</span><span class="semi">Klei Bridal</span></div>
    <nav class="nav" aria-label="Main"><span class="eyebrow nav-label">Workspace</span>
      ${NAV.map(([r, l, i]) => `<a href="#" data-go="${r}" ${active === r ? 'aria-current="page"' : ''}>${icon(i, 'od-icon-lg')}<span>${l}</span>${r === 'inquiries' ? `<span class="pill pill-blue count">${K.unread()} new</span>` : ''}</a>`).join('')}
    </nav>
  </aside>
  <div class="main">${K.topbar()}<main class="view" id="view" tabindex="-1">${content}</main></div>${K.aiPanel?.() || ''}</div>`;
})();
