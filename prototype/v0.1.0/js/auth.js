/* auth.js — login, invite, verify, forgot, reset */
(() => {
const K = window.K, S = K.S, esc = K.esc, icon = K.icon;
const A = () => (S.ui.a ||= { state: 'default', mode: 'code', sent: false, show: false });

const fld = (id, label, o = {}) => `<div class="field"><label for="${id}">${label}${o.req === false ? '' : '<span class="req" aria-hidden="true"> *</span>'}</label>
  ${o.pw ? `<div class="pw-wrap"><input class="input" id="${id}" name="${id}" type="${A().show ? 'text' : 'password'}" autocomplete="${o.ac || 'current-password'}" data-v="${o.v || 'req'}" aria-describedby="e-${id}${o.help ? ` h-${id}` : ''}" aria-required="true" value="${esc(o.val || '')}">
    <button type="button" class="icon-btn" data-act="toggle-pw" aria-label="${A().show ? 'Hide' : 'Show'} password" aria-pressed="${A().show}">${icon(A().show ? 'eyeoff' : 'eye')}</button></div>` :
    `<input class="input" id="${id}" name="${id}" type="${o.type || 'text'}" autocomplete="${o.ac || 'off'}" placeholder="${esc(o.ph || '')}" data-v="${o.v || 'req'}" aria-describedby="e-${id}${o.help ? ` h-${id}` : ''}" aria-required="true" value="${esc(o.val || '')}" ${o.ro ? 'readonly' : ''}>`}
  ${o.help ? `<span class="help" id="h-${id}">${o.help}</span>` : ''}<span class="err" id="e-${id}" hidden></span></div>`;

const wrap = (inner, foot = '') => `<div class="auth-wrap" id="view" tabindex="-1"><div class="auth-col">
  <div class="auth-brand"><span class="brand-mark" aria-hidden="true">K</span>Klei Bridal</div>${inner}${foot ? `<p class="auth-foot">${foot}</p>` : ''}</div>
  <div style="position:absolute;right:24px;bottom:24px" class="stsel"><span class="xs muted" id="stl">Wireframe state</span>
    <div class="seg" role="group" aria-labelledby="stl">${['default', 'error', 'loading'].map(s => `<button type="button" data-act="auth-state" data-arg="${s}" aria-pressed="${A().state === s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div></div></div>`;

const btn = (label, loadingLabel) => A().state === 'loading' ?
  `<button class="btn btn-primary btn-block" type="submit" disabled aria-busy="true"><span class="spinner"></span>${loadingLabel}</button>` :
  `<button class="btn btn-primary btn-block" type="submit" data-autofocus-x>${label}</button>`;
const bad = (msg) => A().state === 'error' ? `<div class="banner bad" role="alert">${icon('alert')}<span>${msg}</span></div>` : '';

const V = {
  login: () => wrap(`<div class="card auth-card"><div><h1 id="view-h" tabindex="-1">Welcome back</h1><p class="muted sm" style="margin-top:4px">Sign in to manage gowns and inquiries.</p></div>
    ${bad('Email or password is incorrect. Check both and try again, or reset your password.')}
    <form class="od-stack" style="--od-gap:16px" data-submit="login" novalidate>
      ${fld('email', 'Work email', { type: 'email', ac: 'username', v: 'email', ph: 'you@kleibridal.com', val: 'eleanor@kleibridal.com' })}
      ${fld('pw', 'Password', { pw: true, val: 'Bridal2026!' })}
      <div class="od-row" style="justify-content:space-between"><label class="check"><input type="checkbox" name="remember"> Keep me signed in</label><a href="#" data-go="auth/forgot" class="sm semi">Forgot password?</a></div>
      ${btn('Sign in', 'Signing in…')}</form></div>`,
    'Have an invite? <a href="#" data-go="auth/invite" class="semi">Accept invitation</a>'),

  invite: () => wrap(`<div class="card auth-card"><div><span class="pill pill-blue">Invitation</span><h1 id="view-h" tabindex="-1" style="margin-top:8px">Join Klei Bridal</h1>
    <p class="muted sm" style="margin-top:4px">Eleanor Park invited you as <b>Staff</b>. Set your name and a password to continue.</p></div>
    ${bad('This invite link has expired. Ask your admin to send a new one.')}
    <form class="od-stack" style="--od-gap:16px" data-submit="invite" novalidate>
      ${fld('email', 'Email', { type: 'email', val: 'jonah@kleibridal.com', ro: true, v: 'email', help: 'Set by your admin. Cannot be changed.' })}
      ${fld('name', 'Full name', { ac: 'name', ph: 'Jonah Reyes' })}
      ${fld('pw', 'Password', { pw: true, ac: 'new-password', v: 'pw', help: 'At least 8 characters with a number.' })}
      <div class="strength" aria-hidden="true" id="strength"><i></i><i></i><i></i><i></i></div>
      ${fld('pw2', 'Confirm password', { pw: true, ac: 'new-password', v: 'match' })}
      ${btn('Accept and continue', 'Creating account…')}</form></div>`,
    'Already have an account? <a href="#" data-go="auth/login" class="semi">Sign in</a>'),

  verify: () => {
    const a = A(), link = a.mode === 'link';
    return wrap(`<div class="card auth-card"><div><h1 id="view-h" tabindex="-1">Check your email</h1>
      <p class="muted sm" style="margin-top:4px">${link ? 'We sent a verification link to' : 'We sent a 6-digit code to'} <b>jonah@kleibridal.com</b>.</p></div>
      <div class="seg" role="group" aria-label="Verification method" style="align-self:flex-start"><button type="button" data-act="verify-mode" data-arg="code" aria-pressed="${!link}">Enter code</button><button type="button" data-act="verify-mode" data-arg="link" aria-pressed="${link}">Link sent</button></div>
      ${link ? `<div class="banner ok" role="status">${icon('mailopen')}<span>Link sent. Open the email and tap <b>Verify email</b>. The link expires in 30 minutes.</span></div>
        <button class="btn btn-secondary btn-block" data-act="verified">I’ve verified my email</button>` :
      `${bad('That code is incorrect or has expired. Check the digits or request a new code.')}
        <form class="od-stack" style="--od-gap:16px" data-submit="verify" novalidate><fieldset style="border:0;padding:0;margin:0"><legend class="lbl" style="margin-bottom:8px">Verification code<span class="req" aria-hidden="true"> *</span></legend>
        <div class="code">${[0, 1, 2, 3, 4, 5].map(i => `<input class="input" inputmode="numeric" maxlength="1" aria-label="Digit ${i + 1} of 6" data-code="${i}" ${a.state === 'error' ? 'aria-invalid="true"' : ''} value="${a.state === 'error' ? '0' : ''}">`).join('')}</div></fieldset>
        ${btn('Verify email', 'Verifying…')}</form>`}
      <div class="od-row" style="justify-content:center"><span class="sm muted">Didn’t get it?</span><button class="btn btn-ghost btn-sm" style="width:auto" data-act="resend" data-fk="resend">${a.resent ? 'Sent again ✓' : 'Resend'}</button></div></div>`,
      '<a href="#" data-go="auth/login" class="semi">Back to sign in</a>');
  },

  forgot: () => {
    const a = A();
    return wrap(a.sent ? `<div class="card auth-card"><div><h1 id="view-h" tabindex="-1">Reset link sent</h1>
      <p class="muted sm" style="margin-top:4px">If an account exists for <b>eleanor@kleibridal.com</b>, you’ll get an email in a minute.</p></div>
      <div class="banner ok" role="status">${icon('mailopen')}<span>Link expires in 30 minutes. Check spam if you don’t see it.</span></div>
      <button class="btn btn-primary btn-block" data-go="auth/reset" data-fk="open-reset">Open reset link (demo)</button>
      <button class="btn btn-ghost btn-block" data-act="forgot-again">Use a different email</button></div>` :
      `<div class="card auth-card"><div><h1 id="view-h" tabindex="-1">Forgot your password?</h1><p class="muted sm" style="margin-top:4px">Enter your work email and we’ll send a reset link.</p></div>
      ${bad('We couldn’t send that email. Check your connection and try again.')}
      <form class="od-stack" style="--od-gap:16px" data-submit="forgot" novalidate>${fld('email', 'Work email', { type: 'email', ac: 'username', v: 'email', ph: 'you@kleibridal.com' })}${btn('Send reset link', 'Sending…')}</form></div>`,
      '<a href="#" data-go="auth/login" class="semi">Back to sign in</a>');
  },

  reset: () => wrap(`<div class="card auth-card"><div><h1 id="view-h" tabindex="-1">Choose a new password</h1><p class="muted sm" style="margin-top:4px">Use at least 8 characters with a number.</p></div>
    ${bad('This reset link has expired. Request a new one.')}
    <form class="od-stack" style="--od-gap:16px" data-submit="reset" novalidate>
      ${fld('pw', 'New password', { pw: true, ac: 'new-password', v: 'pw' })}<div class="strength" aria-hidden="true" id="strength"><i></i><i></i><i></i><i></i></div>
      ${fld('pw2', 'Confirm new password', { pw: true, ac: 'new-password', v: 'match' })}${btn('Update password', 'Updating…')}</form></div>`,
    '<a href="#" data-go="auth/login" class="semi">Back to sign in</a>'),
};
K.views.auth = (sub) => (V[sub] || V.login)();

/* Validation: on blur / submit, error shown next to the field with cause + remedy */
const RULES = {
  req: (v, el) => v.trim() ? '' : `Enter ${el.labels?.[0]?.textContent.replace('*', '').trim().toLowerCase() || 'a value'}. This field is required.`,
  email: v => !v.trim() ? 'Enter your work email, for example you@kleibridal.com.' : /^\S+@\S+\.\S+$/.test(v) ? '' : 'That doesn’t look like an email. Add an @ and a domain, like kleibridal.com.',
  url: v => /^https?:\/\/[^\s/]+\S*$/i.test(v.trim()) ? '' : 'Enter the full address, starting with https:// or http://, for example https://api.openai.com/v1.',
  key: v => v.trim() ? '' : 'Enter your API key. Create one in your provider’s dashboard.',
  pw: v => v.length < 8 ? 'Password is too short. Use at least 8 characters.' : /\d/.test(v) ? '' : 'Add at least one number to your password.',
  match: v => v === document.getElementById('pw')?.value ? '' : 'Passwords don’t match. Retype the same password in both fields.',
};
K.validate = (el) => {
  const msg = (RULES[el.dataset.v] || (() => ''))(el.value, el);
  const e = document.getElementById('e-' + el.id);
  el.setAttribute('aria-invalid', msg ? 'true' : 'false');
  if (e) { e.hidden = !msg; e.innerHTML = msg ? `${icon('alert')}<span>${esc(msg)}</span>` : ''; }
  return !msg;
};
K.validateForm = (form) => {
  const bad = [...form.querySelectorAll('[data-v]')].filter(el => !K.validate(el));
  if (bad.length) bad[0].focus();
  return !bad.length;
};
K.strength = (v) => {
  const n = [v.length >= 8, /\d/.test(v), /[A-Z]/.test(v) && /[a-z]/.test(v), /[^A-Za-z0-9]/.test(v)].filter(Boolean).length;
  document.querySelectorAll('#strength i').forEach((i, k) => i.classList.toggle('on', k < n));
};

const run = (ms, fn) => { A().state = 'loading'; K.rerender(); setTimeout(() => { A().state = 'default'; fn(); }, ms); };
K.submit = {
  login: () => run(700, () => K.go(S.prefs?.start || 'dashboard')),
  invite: () => run(700, () => K.go('auth/verify')),
  verify: () => {
    const v = [...document.querySelectorAll('[data-code]')].map(i => i.value).join('');
    if (v.length < 6) { [...document.querySelectorAll('[data-code]')].find(i => !i.value)?.focus(); K.toast('Enter all 6 digits to continue'); return; }
    run(700, () => K.go(S.prefs?.start || 'dashboard'));
  },
  forgot: () => run(700, () => { A().sent = true; K.rerender('open-reset'); }),
  reset: () => run(700, () => { K.go('auth/login'); K.toast('Password updated. Sign in with your new password.'); }),
};
Object.assign(K.acts, {
  'toggle-pw': () => { const f = document.querySelector('form'); const keep = {}; f?.querySelectorAll('input').forEach(i => keep[i.id] = i.value); A().show = !A().show; K.rerender(); Object.entries(keep).forEach(([k, v]) => { const el = document.getElementById(k); if (el) el.value = v; }); },
  'auth-state': (_, s) => { A().state = s; K.render(); },
  'verify-mode': (_, m) => { A().mode = m; A().state = 'default'; K.render(); },
  'verified': () => K.go(S.prefs?.start || 'dashboard'),
  'resend': () => { A().resent = true; K.rerender('resend'); K.toast('New code sent to jonah@kleibridal.com'); },
  'forgot-again': () => { A().sent = false; K.render(); },
});
})();
