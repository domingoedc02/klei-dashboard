/* assistant.js — topbar AI Assistant right drawer (simulated chat) */
(() => {
const K = window.K, S = K.S, esc = K.esc, icon = K.icon;

const GREET = { r: 'ai', t: 'Hi! I can summarize inquiries, draft replies and suggest gowns from your gallery.' };
const CHIPS = ['Summarize new inquiries', 'Draft a reply to Hannah', 'Suggest gowns for a beach wedding'];
let enter = false; // slide-in only on open; sync() recreates the node per message
const A = () => S.ui.ai ||= { open: false, busy: false, draft: '', id: 0, msgs: [GREET] };

/* shortcut: keyword-matched canned replies over seed data, swap for a real model call when a backend exists */
const reply = q => {
  const s = q.toLowerCase(), inq = K.D.inq, fresh = inq.filter(i => S.inqSt[i.id] === 'New');
  const first = n => n.split(' ')[0];
  if (/reply|draft|respond/.test(s)) {
    const w = inq.find(i => s.includes(first(i.name).toLowerCase())) || fresh[0] || inq[0];
    return `Draft for ${w.name}:\n\nHi ${first(w.name)}, thank you for reaching out about "${w.subj}". We would love to help. Would a fitting early next week work for you?\n\nWarm regards,\nKlei Bridal`;
  }
  if (/inquir|new|unread|summar/.test(s)) {
    return fresh.length ? `${fresh.length} new: ${fresh.map(i => `${i.name} (${i.subj.toLowerCase()})`).join('; ')}. ${inq.length - fresh.length} others are replied or closed.` : 'No new inquiries. You are all caught up.';
  }
  if (/gown|dress|beach|summer|lace|mikado|tulle|suggest|recommend/.test(s)) {
    const f = /lace/.test(s) ? 'Lace' : /mikado/.test(s) ? 'Mikado' : /beach|summer|outdoor|tulle/.test(s) ? 'Tulle' : '';
    const g = K.D.gallery.filter(x => !f || x.fab.includes(f)).slice(0, 3);
    return g.length ? `Top picks${f ? ` in ${f}` : ''}: ${g.map(x => `${x.name} (${K.L(x.sil)}, ${K.L(x.fab)})`).join('; ')}. Share the venue and budget to narrow it down.` : `No ${f} gowns in the gallery yet.`;
  }
  return 'I can summarize inquiries, draft replies and suggest gowns. Try "Summarize new inquiries".';
};

const msg = m => `<div class="ai-msg ${m.r}">${m.r === 'ai' ? `<span class="ai-av" aria-hidden="true">${icon('spark')}</span>` : ''}<div class="ai-b">${esc(m.t)}</div></div>`;

K.aiPanel = () => {
  const a = A();
  if (!a.open) return '';
  return `<aside id="ai-panel" class="ai-panel${enter ? ' enter' : ''}" aria-label="AI Assistant">
    <div class="ai-head"><span class="ai-av" aria-hidden="true">${icon('spark')}</span><h2>AI Assistant</h2>
      <button class="icon-btn" data-act="ai-new" aria-label="New chat" title="New chat">${icon('refresh')}</button>
      <button class="icon-btn" data-act="ai-close" aria-label="Close AI Assistant" title="Close">${icon('x')}</button></div>
    <div class="ai-msgs" role="log" aria-live="polite" aria-label="Conversation" tabindex="0">${a.msgs.map(msg).join('')}${a.busy ? '<div class="ai-msg ai" aria-label="Assistant is typing"><span class="ai-av" aria-hidden="true">' + icon('spark') + '</span><div class="ai-b ai-dots"><i></i><i></i><i></i></div></div>' : ''}</div>
    ${a.msgs.length === 1 && !a.busy ? `<div class="ai-sugg">${CHIPS.map(c => `<button type="button" data-act="ai-chip" data-arg="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}
    <div class="ai-foot"><label class="sr-only" for="ai-in">Message the assistant</label>
      <div class="ai-row"><textarea id="ai-in" class="textarea" rows="2" placeholder="Ask anything about your inquiries or gowns…" data-ai-in>${esc(a.draft)}</textarea>
        <button class="btn btn-primary" data-act="ai-send" aria-label="Send message">${icon('send')}</button></div>
      <span class="xs muted">Enter to send · Shift+Enter for a new line · Replies are simulated</span></div>
  </aside>`;
};

K.aiScroll = () => { const m = document.querySelector('.ai-msgs'); if (m) m.scrollTop = m.scrollHeight; };

/* Swap only the panel + button state so inquiry composers and scroll positions elsewhere are untouched */
const sync = (focus) => {
  const old = document.getElementById('ai-panel'), a = A();
  const hadFocus = old?.contains(document.activeElement);
  const t = document.createElement('div'); t.innerHTML = K.aiPanel(); enter = false;
  const nu = t.firstElementChild;
  if (old) nu ? old.replaceWith(nu) : old.remove(); else if (nu) document.querySelector('.shell')?.append(nu);
  const b = document.querySelector('.ai-btn'); b?.setAttribute('aria-expanded', String(a.open));
  const m = nu?.querySelector('.ai-msgs'); if (m) m.scrollTop = m.scrollHeight;
  if (focus === 'btn') b?.focus();
  else if (nu && (focus === 'in' || hadFocus)) { const i = nu.querySelector('[data-ai-in]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
};

const send = (txt) => {
  const a = A(); txt = txt.trim();
  if (!txt || a.busy) return;
  const id = a.id;
  a.msgs.push({ r: 'me', t: txt }); a.draft = ''; a.busy = true; sync('in');
  setTimeout(() => { if (a.id !== id) return; a.msgs.push({ r: 'ai', t: reply(txt) }); a.busy = false; sync(); }, 700);
};

Object.assign(K.acts, {
  'ai': () => { const a = A(); a.open = enter = !a.open; sync(a.open ? 'in' : 'btn'); },
  'ai-close': () => { A().open = false; sync('btn'); },
  'ai-send': () => send(document.querySelector('[data-ai-in]')?.value || ''),
  'ai-chip': (_, t) => send(t),
  'ai-new': () => { const a = A(); a.id++; a.msgs = [GREET]; a.busy = false; a.draft = ''; sync('in'); },
});

document.addEventListener('input', e => { if (e.target.matches?.('[data-ai-in]')) A().draft = e.target.value; });
document.addEventListener('keydown', e => {
  const a = S.ui.ai;
  if (e.key === 'Escape' && a?.open && !S.menu && !S.q && !document.getElementById('dlg').open) { a.open = false; sync('btn'); }
  else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.target.matches?.('[data-ai-in]')) { e.preventDefault(); send(e.target.value); }
});
})();
