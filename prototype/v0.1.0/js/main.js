/* main.js — global event delegation + boot */
(() => {
const K = window.K, S = K.S;

Object.assign(K.acts, {
  'close-dlg': () => K.closeDlg(),
  'menu': (_, m) => { S.menu = S.menu === m ? null : m; K.rerender('m-' + m); },
  'read-all': () => { S.notifs.forEach(n => n.unread = false); S.ui.notifState = 'empty'; K.rerender('m-notif'); },
  'clear-search': () => { S.q = ''; K.render(); },
  'toggle-role': () => { S.role = S.role === 'admin' ? 'staff' : 'admin'; S.menu = null; K.render(); K.toast(`Now viewing as ${S.role === 'admin' ? 'Admin' : 'Staff'}`); },
});

const nav = (t) => {
  const { go, tab, open, hit } = t.dataset;
  if (hit) S.q = '';
  if (go === 'auth/login') { S.ui.notifState = 'default'; S.notifs.forEach(n => n.unread = n.id !== 'n3'); }
  if (tab) S.ui.pendingTab = tab;
  if (open || hit) S.ui.pendingOpen = open || hit;
  K.go(go);
};

document.addEventListener('click', e => {
  const t = e.target.closest('[data-act],[data-go]');
  if (!t) {
    if ((S.menu || S.q) && !e.target.closest('.menu, .search, .search-pop, #dlg')) { S.menu = null; S.q = ''; K.render(); }
    return;
  }
  if (t.tagName === 'A') e.preventDefault();
  if (t.disabled || t.getAttribute('aria-disabled') === 'true') return;
  if (t.dataset.act) K.acts[t.dataset.act]?.(t, t.dataset.arg);
  if (t.dataset.go) nav(t);
});

document.addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target, n = f.dataset.submit;
  if (!n) { document.querySelector('#dlg .btn-primary')?.click(); return; }
  if (!K.validateForm(f)) return;
  K.submit[n]?.(f);
});

document.addEventListener('focusout', e => {
  const el = e.target;
  if (el.matches?.('[data-v]') && el.isConnected && !el.readOnly) K.validate(el);
});

document.addEventListener('input', e => {
  const el = e.target;
  if (el.matches('[data-search]')) {
    S.q = el.value; const pos = el.selectionStart;
    const tmp = document.createElement('div'); tmp.innerHTML = K.topbar();
    document.querySelector('.topbar').replaceWith(tmp.firstElementChild);
    const n = document.getElementById('gsearch'); n.focus(); n.setSelectionRange(pos, pos);
  } else if (el.matches('[data-code]')) {
    el.value = el.value.replace(/\D/g, '').slice(0, 1);
    if (el.value) el.nextElementSibling?.focus();
  } else if (el.matches('#pw[data-v="pw"]')) K.strength(el.value);
  if (el.matches('[aria-invalid="true"][data-v]') && el.isConnected) K.validate(el);
});

document.addEventListener('keydown', e => {
  const el = e.target;
  if (e.key === 'Escape' && (S.menu || S.q) && !document.getElementById('dlg').open) {
    const fk = S.menu ? 'm-' + S.menu : null; S.menu = null; S.q = ''; K.rerender(fk); return;
  }
  if (e.key === 'Backspace' && el.matches?.('[data-code]') && !el.value) el.previousElementSibling?.focus();
  if (el.getAttribute?.('role') === 'tab' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    const tabs = [...el.parentElement.querySelectorAll('[role="tab"]')], i = tabs.indexOf(el);
    tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length].click();
  }
});

K.render();
})();
