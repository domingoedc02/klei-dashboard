/* settings.js — Profile, Signature, Preferences, Notifications, Admin (admin only) */
(() => {
const K = window.K, S = K.S, esc = K.esc, icon = K.icon;
const T = () => (S.ui.set ||= { tab: 'profile', admin: 'staff', twofa: false, ai: { sens: 3, tone: 'Warm', model: true, prov: { preset: 'openai', url: 'https://api.openai.com/v1', key: '', org: '', chat: 'gpt-4o', vision: 'gpt-4o', temp: '0.7', max: '1024', show: false, status: 'untested', msg: '' } }, notif: { email: { inq: true, ai: true, team: false }, app: { inq: true, ai: true, team: true }, digest: 'Daily' }, state: 'default' });
const BIZ = 'Klei Bridal';
const SG = () => ((S.sig ||= {})[K.isAdmin() ? 'admin' : 'staff'] ||= K.isAdmin()
  ? { on: true, close: 'Warm regards,', name: 'Eleanor Park', title: 'Owner & Lead Stylist', phone: '(415) 555-0142', away: false, awayMsg: 'Thank you for your inquiry! We are away from the studio and will reply within two business days.' }
  : { on: true, close: 'Warm regards,', name: 'Marcus Bell', title: 'Bridal Consultant', phone: '(415) 555-0178', away: false, awayMsg: 'Thank you for your inquiry! We are away from the studio and will reply within two business days.' });
const PF = (S.prefs ||= { lang: 'English (US)', tz: 'Pacific Time (US & Canada)', date: 'Nov 7, 2026', start: 'dashboard', enterSend: false });
const build = g => [g.close, g.name, g.title, [BIZ, g.phone].filter(Boolean).join(' · ')].map(x => x.trim()).filter(Boolean).join('\n');
K.sigText = () => { const g = SG(); return g.on ? build(g) : ''; };
const sw = (id, label, on, extra = '') => `<label class="switch"><input type="checkbox" id="${id}" role="switch" ${on ? 'checked' : ''} ${extra} aria-label="${esc(label)}"><span class="track"></span></label>`;
const row = (title, help, ctl) => `<div class="srow"><div class="od-field"><span class="sm semi">${title}</span><span class="help">${help}</span></div>${ctl}</div>`;

/* Closure schedule. shortcut: saved and summarized only, never checked against a real clock; wire to the server time zone (PF.tz) when sending is real. */
const DAYS = [['mon', 'Mon', 'Monday'], ['tue', 'Tue', 'Tuesday'], ['wed', 'Wed', 'Wednesday'], ['thu', 'Thu', 'Thursday'], ['fri', 'Fri', 'Friday'], ['sat', 'Sat', 'Saturday'], ['sun', 'Sun', 'Sunday']];
const MODES = [['once', 'One time only', 'Closed on a date or date range. For holidays and trips.'], ['weekly', 'Weekly', 'Closed on the same days every week.'], ['daily', 'Every day', 'Closed outside set hours, every day.']];
const sch = g => (g.sch ||= { mode: 'weekly', days: ['sun', 'mon'], start: '2026-11-26', end: '2026-11-27', from: '18:00', to: '09:00' });
const fmtD = s => { const [y, m, d] = s.split('-'); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
const fmtT = t => { const [h, m] = t.split(':'); return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); };
const schErr = s => s.mode === 'once' ? (!s.start ? 'Pick the first day closed.' : s.end && s.end < s.start ? 'The last day can’t be before the first day.' : '')
  : s.mode === 'weekly' ? (s.days.length ? '' : 'Pick at least one day.') : (!s.from || !s.to || s.from === s.to ? 'Closing and reopening times must differ.' : '');
const schSum = s => schErr(s) || (s.mode === 'once' ? `Closed ${fmtD(s.start)}${s.end && s.end !== s.start ? ' to ' + fmtD(s.end) : ''}. Happens once.`
  : s.mode === 'weekly' ? `Closed every ${DAYS.filter(d => s.days.includes(d[0])).map(d => d[2]).join(', ')}, all day.` : `Closed every day from ${fmtT(s.from)} until ${fmtT(s.to)}.`);
const readSch = () => { const v = id => document.getElementById(id).value; return { mode: document.querySelector('[name=sch-mode]:checked').value, days: [...document.querySelectorAll('[data-day]:checked')].map(x => x.dataset.day), start: v('sch-start'), end: v('sch-end'), from: v('sch-from'), to: v('sch-to') }; };
const schUi = g => { const s = sch(g), p = k => `class="sch-p" data-sp="${k}" ${s.mode === k ? '' : 'hidden'}`; return `<fieldset class="od-stack" style="--od-gap:12px;border:0;padding:0;margin:0"><legend class="sm semi" style="padding:0;margin-bottom:12px">When is the business off?</legend>
  <div class="od-stack" style="--od-gap:8px">${MODES.map(([v, t, h]) => `<label class="radio-card"><input type="radio" name="sch-mode" value="${v}" data-sch ${s.mode === v ? 'checked' : ''}><span class="od-field"><span class="sm semi">${t}</span><span class="help">${h}</span></span></label>`).join('')}</div>
  <div ${p('once')}><div class="form-grid">
    <div class="field"><label for="sch-start">First day closed<span class="req" aria-hidden="true"> *</span></label><input class="input" type="date" id="sch-start" data-sch value="${s.start}" aria-required="true"></div>
    <div class="field"><label for="sch-end">Last day closed</label><input class="input" type="date" id="sch-end" data-sch value="${s.end}" aria-describedby="h-sch-end"><span class="help" id="h-sch-end">Optional. Leave blank for a single day.</span></div></div></div>
  <div ${p('weekly')}><div class="field"><span class="lbl" id="sch-dl">Closed on</span><div class="chips" role="group" aria-labelledby="sch-dl">${DAYS.map(([k, l, f]) => `<label class="dchip"><input type="checkbox" class="sr-only" data-sch data-day="${k}" aria-label="${f}" ${s.days.includes(k) ? 'checked' : ''}><span aria-hidden="true">${l}</span></label>`).join('')}</div></div></div>
  <div ${p('daily')}><div class="form-grid">
    <div class="field"><label for="sch-from">Closes at</label><input class="input" type="time" id="sch-from" data-sch value="${s.from}"></div>
    <div class="field"><label for="sch-to">Reopens at</label><input class="input" type="time" id="sch-to" data-sch value="${s.to}"></div></div></div>
  <div class="sig-pv"><span class="xs muted">Schedule</span><p class="sm semi" id="sch-sum" aria-live="polite">${esc(schSum(s))}</p></div>
  <span class="err" id="e-sch" role="alert" hidden></span></fieldset>`; };

const profile = t => `<div class="set-col"><section class="card od-stack" style="--od-gap:16px" aria-labelledby="ph"><h2 id="ph">Profile</h2>
  <div class="od-row" style="--od-gap:16px"><span class="avatar lg" aria-hidden="true">${K.isAdmin() ? 'EP' : 'MB'}</span><div class="od-stack" style="--od-gap:4px"><div class="od-row"><button class="btn btn-secondary" data-act="set-avatar" data-fk="av">Change photo</button><button class="btn btn-ghost" data-act="set-avatar-rm">Remove</button></div><span class="help">JPG or PNG, up to 5 MB.</span></div></div>
  <form class="od-stack" style="--od-gap:16px" data-submit="profile" novalidate><div class="form-grid">
    <div class="field"><label for="pn">Full name<span class="req" aria-hidden="true"> *</span></label><input class="input" id="pn" data-v="req" value="${K.isAdmin() ? 'Eleanor Park' : 'Marcus Bell'}" aria-describedby="e-pn" aria-required="true"><span class="err" id="e-pn" hidden></span></div>
    <div class="field"><label for="pe">Email<span class="req" aria-hidden="true"> *</span></label><input class="input" id="pe" type="email" data-v="email" value="${K.isAdmin() ? 'eleanor@kleibridal.com' : 'marcus@kleibridal.com'}" aria-describedby="e-pe" aria-required="true"><span class="err" id="e-pe" hidden></span></div></div>
    <div><button class="btn btn-primary" type="submit" data-fk="psave">Save changes</button></div></form></section>
  <section class="card od-stack" style="--od-gap:16px;margin-top:16px" aria-labelledby="pwh"><h2 id="pwh">Password</h2>
    <form class="od-stack" style="--od-gap:16px" data-submit="password" novalidate><div class="form-grid">
      <div class="field"><label for="cp">Current password<span class="req" aria-hidden="true"> *</span></label><input class="input" id="cp" type="password" autocomplete="current-password" data-v="req" aria-describedby="e-cp" aria-required="true"><span class="err" id="e-cp" hidden></span></div><span></span>
      <div class="field"><label for="np">New password<span class="req" aria-hidden="true"> *</span></label><input class="input" id="np" type="password" autocomplete="new-password" data-v="pw" aria-describedby="e-np h-np" aria-required="true"><span class="help" id="h-np">At least 8 characters with a number.</span><span class="err" id="e-np" hidden></span></div>
      <div class="field"><label for="np2">Confirm new password<span class="req" aria-hidden="true"> *</span></label><input class="input" id="np2" type="password" autocomplete="new-password" data-v="match" aria-describedby="e-np2" aria-required="true"><span class="err" id="e-np2" hidden></span></div></div>
    <div><button class="btn btn-secondary" type="submit">Update password</button></div></form></section>
  <section class="card" style="margin-top:16px" aria-labelledby="fah"><h2 id="fah">Two-factor authentication</h2>
    ${row('Authenticator app', t.twofa ? 'Enabled. You’ll enter a 6-digit code at sign-in.' : 'Add a second step when you sign in. Recommended for admins.', `<div class="od-row">${t.twofa ? '<span class="pill pill-green">On</span>' : '<span class="pill pill-gray">Off</span>'}<button class="btn ${t.twofa ? 'btn-secondary' : 'btn-primary'}" data-act="set-2fa" data-fk="tf">${t.twofa ? 'Turn off' : 'Set up'}</button></div>`)}</section></div>`;

const sigTab = () => { const g = SG(); return `<div class="set-col">
  <form class="card od-stack" style="--od-gap:16px" data-submit="sig" novalidate aria-labelledby="sgh"><div><h2 id="sgh">Email signature</h2><p class="help" style="margin-top:4px">Shown at the end of your replies to clients.</p></div>
    ${row('Add signature to replies', 'Appended automatically when you send from Inquiries.', sw('sg-on', 'Add signature to replies', g.on))}
    <div class="form-grid">
      <div class="field"><label for="sg-close">Sign-off</label><input class="input" id="sg-close" data-sg value="${esc(g.close)}" placeholder="Warm regards,"></div>
      <div class="field"><label for="sg-name">Display name<span class="req" aria-hidden="true"> *</span></label><input class="input" id="sg-name" data-sg data-v="req" value="${esc(g.name)}" aria-describedby="e-sg-name" aria-required="true"><span class="err" id="e-sg-name" hidden></span></div>
      <div class="field"><label for="sg-title">Job title</label><input class="input" id="sg-title" data-sg value="${esc(g.title)}" placeholder="Bridal Consultant"></div>
      <div class="field"><label for="sg-phone">Phone</label><input class="input" id="sg-phone" type="tel" data-sg value="${esc(g.phone)}" placeholder="(415) 555-0100" aria-describedby="h-sg-phone"><span class="help" id="h-sg-phone">Optional. Shown next to ${BIZ}.</span></div></div>
    <div class="field"><span class="lbl" id="sg-pvl">Preview</span><div class="sig-pv" role="group" aria-labelledby="sg-pvl"><p class="muted sm">Your message appears here.</p><pre id="sg-pv">${esc(build(g))}</pre></div></div>
    <div><button class="btn btn-primary" type="submit" data-fk="sgsave">Save signature</button></div></form>
  ${K.isAdmin() ? `<form class="card od-stack" style="--od-gap:16px;margin-top:16px" data-submit="away" novalidate aria-labelledby="awh"><div><h2 id="awh">Away message</h2><p class="help" style="margin-top:4px">Sent once to each new inquiry while you are out.</p></div>
    ${row('Send away message', g.away ? 'On. ' + schSum(sch(g)) : 'Off. Turn on when the studio is closed.', sw('aw-on', 'Send away message', g.away))}
    ${schUi(g)}
    <div class="field"><label for="aw-msg">Message<span class="req" aria-hidden="true"> *</span></label><textarea class="textarea" id="aw-msg" data-v="req" aria-describedby="e-aw-msg" aria-required="true">${esc(g.awayMsg)}</textarea><span class="err" id="e-aw-msg" hidden></span></div>
    <div><button class="btn btn-primary" type="submit" data-fk="awsave">Save away message</button></div></form>` : ''}</div>`; };

const prefs = () => {
  const sel = (k, label, opts, help) => `<div class="field"><label for="pf-${k}">${label}</label><select class="select" id="pf-${k}" data-pf="${k}">${opts.map(o => [].concat(o)).map(([v, l = v]) => `<option value="${v}" ${PF[k] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>${help ? `<span class="help">${help}</span>` : ''}</div>`;
  return `<div class="set-col"><section class="card od-stack" style="--od-gap:16px" aria-labelledby="rgh"><h2 id="rgh">Language and region</h2><div class="form-grid">
    ${sel('lang', 'Language', ['English (US)', 'English (UK)', 'Español', 'Français'])}
    ${sel('tz', 'Time zone', ['Pacific Time (US & Canada)', 'Mountain Time (US & Canada)', 'Central Time (US & Canada)', 'Eastern Time (US & Canada)', 'UTC'])}
    ${sel('date', 'Date format', ['Nov 7, 2026', '7 Nov 2026', '11/07/2026'])}
    ${sel('start', 'Start page after sign-in', [['dashboard', 'Dashboard'], ['inquiries', 'Inquiries'], ['gallery', 'Gallery']])}</div></section>
  <section class="card" style="margin-top:16px" aria-labelledby="ibh"><h2 id="ibh">Inquiries</h2>
    ${row('Press Enter to send', 'Off: Enter adds a new line. Use the send button to reply.', sw('pf-enter', 'Press Enter to send', PF.enterSend, 'data-pf="enterSend"'))}
    </section></div>`;
};

const notif = t => {
  const ev = [['inq', 'New inquiry', 'When a client submits the website form'], ['ai', 'AI finished processing', 'When a batch is ready to review'], ['team', 'Team activity', 'Invites accepted and role changes']];
  return `<div class="set-col"><section class="card" aria-labelledby="nh"><h2 id="nh">Notifications</h2>
    <table class="tbl" style="margin-top:8px"><thead><tr><th scope="col">Event</th><th scope="col" class="c">Email</th><th scope="col" class="c">In-app</th></tr></thead><tbody>
    ${ev.map(([k, l, h]) => `<tr><th scope="row" style="text-align:left;padding:12px;font-weight:400;text-transform:none;letter-spacing:0;font-size:14px;color:var(--fg)"><span class="semi" style="display:block">${l}</span><span class="help">${h}</span></th>
      <td class="c"><div style="display:inline-block">${sw('ne-' + k, l + ' by email', t.notif.email[k], `data-nt="email.${k}"`)}</div></td><td class="c"><div style="display:inline-block">${sw('na-' + k, l + ' in-app', t.notif.app[k], `data-nt="app.${k}"`)}</div></td></tr>`).join('')}</tbody></table></section>
  <section class="card" style="margin-top:16px" aria-labelledby="dh"><h2 id="dh">Email digest</h2><div class="field" style="margin-top:12px;max-width:280px"><label for="dg">Frequency</label>
    <select class="select" id="dg" data-nt-sel>${['Real-time', 'Hourly', 'Daily', 'Weekly', 'Never'].map(o => `<option ${o === t.notif.digest ? 'selected' : ''}>${o}</option>`).join('')}</select><span class="help">Bundles non-urgent updates into one email.</span></div></section></div>`;
};

const adminStaff = () => `<div class="od-row" style="justify-content:space-between;margin-bottom:12px"><h3>Staff (${K.D.staff.length})</h3><button class="btn btn-primary" data-act="staff-add" data-fk="sadd">${icon('plus')}Invite staff</button></div>
  ${K.D.staff.length ? `<div class="card" style="padding:0;overflow:hidden"><table class="tbl"><thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Last active</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>
  ${K.D.staff.map(s => `<tr><td><div class="od-row"><span class="avatar sm" aria-hidden="true">${s.name.split(' ').map(w => w[0]).join('')}</span><span class="od-stack" style="--od-gap:0"><span class="semi">${esc(s.name)}</span><span class="xs muted">${esc(s.mail)}</span></span></div></td>
    <td>${s.role === 'Admin' ? '<span class="role-badge">Admin</span>' : s.role}</td><td><span class="pill ${s.st === 'Active' ? 'pill-green' : 'pill-warn'}">${s.st}</span></td><td class="muted">${s.last}</td>
    <td><div class="od-row" style="justify-content:flex-end">${s.st === 'Invited' ? `<button class="btn btn-ghost btn-sm" style="width:auto" data-act="staff-resend" data-arg="${s.id}">Resend</button>` : ''}<button class="btn btn-ghost btn-sm" style="width:auto" data-act="staff-edit" data-arg="${s.id}" data-fk="se-${s.id}" aria-label="Edit ${esc(s.name)}">${icon('edit')}</button>
    <button class="btn btn-ghost btn-sm" style="width:auto" data-act="staff-del" data-arg="${s.id}" data-fk="sd-${s.id}" aria-label="Delete ${esc(s.name)}" ${s.role === 'Admin' ? 'disabled' : ''}>${icon('trash')}</button></div></td></tr>`).join('')}</tbody></table></div>` :
    K.empty({ art: 3, compact: true, title: 'No staff yet', text: 'Invite teammates so they can upload gowns and reply to clients.', action: 'Invite staff', act: 'staff-add', fk: 'sadd2' })}`;

const adminRoles = () => `<h3 style="margin-bottom:12px">Roles and permissions</h3><div class="card" style="padding:0;overflow:hidden"><table class="tbl"><thead><tr><th scope="col">Permission</th><th scope="col" class="c">Admin</th><th scope="col" class="c">Staff</th><th scope="col" class="c">Viewer</th></tr></thead><tbody>
  ${K.D.perms.map(([l, v], r) => `<tr><th scope="row" style="text-align:left;text-transform:none;letter-spacing:0;font-size:14px;font-weight:500;color:var(--fg);padding:12px">${l}</th>${v.map((on, c) => `<td class="c"><label class="check" style="justify-content:center"><input type="checkbox" ${on ? 'checked' : ''} ${c === 0 ? 'disabled' : ''} data-perm="${r}.${c}" aria-label="${l} for ${['Admin', 'Staff', 'Viewer'][c]}"></label></td>`).join('')}</tr>`).join('')}</tbody></table></div>
  <p class="help" style="margin-top:8px">Admin permissions are locked. Changes apply the next time a user signs in.</p>`;

/* Model provider. shortcut: nothing leaves the page, "Test connection" is simulated (fails on a key under 8 chars); wire to a server-side /models call, never from the browser, when real. */
const PRE = { openai: ['OpenAI', 'https://api.openai.com/v1', ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'], 1],
  openrouter: ['OpenRouter', 'https://openrouter.ai/api/v1', ['openai/gpt-4o', 'anthropic/claude-sonnet-4', 'google/gemini-2.0-flash-001', 'meta-llama/llama-3.3-70b-instruct'], 1],
  groq: ['Groq', 'https://api.groq.com/openai/v1', ['llama-3.3-70b-versatile', 'llama-3.2-90b-vision-preview'], 1],
  ollama: ['Ollama (local)', 'http://localhost:11434/v1', ['llama3.2-vision', 'qwen2.5vl', 'llama3.1'], 0],
  custom: ['Custom (OpenAI-compatible)', '', [], 0] };
const pvConn = p => { const s = { untested: ['pill-gray', 'Not tested'], testing: ['pill-blue', 'Testing…'], ok: ['pill-green', 'Connected'], fail: ['pill-red', 'Failed'] }[p.status];
  return row('Connection', esc(p.msg || 'Check the address and key before you save.'), `<div class="od-row"><span class="pill ${s[0]}">${s[1]}</span><button type="button" class="btn btn-secondary" data-act="pv-test" data-fk="pv-test" ${p.status === 'testing' ? 'disabled' : ''}>Test connection</button></div>`); };
const adminProv = p => { const [, , models, need] = PRE[p.preset], req = '<span class="req" aria-hidden="true"> *</span>';
  const mdl = (k, l, h) => `<div class="field"><label for="pv-${k}">${l}${k === 'chat' ? req : ''}</label><input class="input" id="pv-${k}" list="dl-pv" data-prov="${k}" ${k === 'chat' ? 'data-v="req"' : ''} value="${esc(p[k])}" autocomplete="off" spellcheck="false" aria-describedby="${k === 'chat' ? 'e-pv-chat ' : ''}h-pv-${k}"><span class="help" id="h-pv-${k}">${h}</span>${k === 'chat' ? '<span class="err" id="e-pv-chat" hidden></span>' : ''}</div>`;
  return `<form id="prov-form" class="card od-stack" style="--od-gap:16px" data-submit="prov" novalidate aria-label="Model provider"><p class="help">Connect any OpenAI-compatible API. Used for grouping photos, tags and descriptions.</p>
  <div id="pv-conn" aria-live="polite">${pvConn(p)}</div>
  <div class="field"><label for="pv-preset">Provider</label><select class="select" id="pv-preset" data-prov="preset" data-fk="pv-preset">${Object.entries(PRE).map(([k, v]) => `<option value="${k}" ${k === p.preset ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></div>
  <div class="field"><label for="pv-url">Base URL${req}</label><input class="input" id="pv-url" data-prov="url" data-v="url" value="${esc(p.url)}" placeholder="https://api.example.com/v1" inputmode="url" autocomplete="off" spellcheck="false" aria-required="true" aria-describedby="e-pv-url h-pv-url"><span class="help" id="h-pv-url">The server must support <code>/chat/completions</code>.</span><span class="err" id="e-pv-url" hidden></span></div>
  <div class="form-grid"><div class="field"><label for="pv-key">API key${need ? req : ''}</label><div class="pw-wrap"><input class="input" id="pv-key" type="${p.show ? 'text' : 'password'}" data-prov="key" ${need ? 'data-v="key" aria-required="true"' : ''} value="${esc(p.key)}" placeholder="sk-…" autocomplete="off" spellcheck="false" aria-describedby="e-pv-key h-pv-key">
      <button type="button" class="icon-btn" data-act="pv-eye" data-fk="pv-eye" aria-label="${p.show ? 'Hide' : 'Show'} API key" aria-pressed="${p.show}">${icon(p.show ? 'eyeoff' : 'eye')}</button></div>
      <span class="help" id="h-pv-key">${need ? 'Stored encrypted. Only admins can change it.' : 'Optional for local or self-hosted servers.'}</span><span class="err" id="e-pv-key" hidden></span></div>
    <div class="field"><label for="pv-org">Organization ID</label><input class="input" id="pv-org" data-prov="org" value="${esc(p.org)}" placeholder="org-…" autocomplete="off" aria-describedby="h-pv-org"><span class="help" id="h-pv-org">Optional.</span></div></div>
  <div class="form-grid">${mdl('chat', 'Model', 'Type to search or enter any model ID.')}${mdl('vision', 'Vision model', 'For reading photos. Leave as is to reuse the model.')}</div>
  <datalist id="dl-pv">${models.map(m => `<option value="${m}">`).join('')}</datalist>
  <div class="form-grid"><div class="field"><label for="pv-temp">Temperature: <b id="pv-tv">${p.temp}</b></label><input type="range" id="pv-temp" min="0" max="2" step="0.1" value="${p.temp}" data-prov="temp" aria-describedby="h-pv-temp"><span class="help" id="h-pv-temp">Lower is more consistent. Higher is more varied.</span></div>
    <div class="field"><label for="pv-max">Max output tokens</label><input class="input" id="pv-max" type="number" min="64" max="8192" step="1" data-prov="max" value="${esc(p.max)}" aria-describedby="h-pv-max"><span class="help" id="h-pv-max">64 to 8192.</span></div></div>
  <div><button class="btn btn-primary" type="submit" data-fk="pvsave">Save provider</button></div></form>`; };

const adminAI = t => `<div class="set-col"><h3 style="margin-bottom:12px">Model provider</h3>${adminProv(t.ai.prov)}<h3 style="margin:24px 0 12px">AI settings</h3><section class="card od-stack" style="--od-gap:20px">
  <div class="field"><label for="sens">Grouping sensitivity: <b id="sensv">${['', 'Very loose', 'Loose', 'Balanced', 'Strict', 'Very strict'][t.ai.sens]}</b></label><input type="range" id="sens" min="1" max="5" value="${t.ai.sens}" data-ai="sens" aria-describedby="sensh"><span class="help" id="sensh">Stricter groups split more often. Looser groups merge similar angles.</span></div>
  <fieldset style="border:0;padding:0;margin:0" class="od-stack"><legend class="lbl" style="margin-bottom:8px">Description tone</legend>${[['Warm', 'Friendly and personal'], ['Editorial', 'Polished, magazine-style'], ['Factual', 'Short and specific']].map(([v, h]) => `<label class="radio-card"><input type="radio" name="tone" value="${v}" ${t.ai.tone === v ? 'checked' : ''} data-ai="tone"><span class="od-field"><span class="sm semi">${v}</span><span class="help">${h}</span></span></label>`).join('')}</fieldset>
  <div class="field"><span class="lbl">Tag taxonomy</span><div class="od-stack" style="--od-gap:8px">${Object.entries(K.D.tax).map(([k, v]) => `<div class="od-row-top"><span class="sm muted" style="width:88px;padding-top:4px">${k}</span><div class="chips">${v.map(x => `<span class="chip">${x}<button data-act="tax-rm" data-arg="${k}|${x}" aria-label="Remove ${x} from ${k}">${icon('x')}</button></span>`).join('')}<button class="btn btn-ghost btn-sm" style="width:auto" data-act="tax-add" data-arg="${k}">${icon('plus')}Add</button></div></div>`).join('')}</div></div>
  ${row('Use advanced AI model', 'Higher accuracy on lace and sheer fabrics. Uses 2× credits.', sw('model', 'Advanced model', t.ai.model, 'data-ai="model"'))}
  <div><button class="btn btn-primary" data-act="ai-save" data-fk="aisave">Save AI settings</button></div></section></div>`;

const adminAudit = () => `<h3 style="margin-bottom:12px">Audit log</h3><div class="card" style="padding:0;overflow:hidden"><table class="tbl"><thead><tr><th scope="col">When</th><th scope="col">User</th><th scope="col">Action</th><th scope="col">IP</th></tr></thead><tbody>
  ${K.D.audit.map(a => `<tr><td class="muted od-nowrap">${a[0]}</td><td class="semi od-nowrap">${a[1]}</td><td>${esc(a[2])}</td><td class="muted" style="font-family:var(--font-mono);font-size:12px">${a[3]}</td></tr>`).join('')}</tbody></table></div>`;

K.views.settings = () => {
  const t = T(), admin = K.isAdmin();
  if (S.ui.pendingTab) { t.tab = S.ui.pendingTab; delete S.ui.pendingTab; }
  if (t.tab === 'admin' && !admin) t.tab = 'profile';
  const tabs = [['profile', 'Profile', 'user'], ['signature', 'Signature', 'edit'], ['prefs', 'Preferences', 'settings'], ['notifications', 'Notifications', 'bell'], ...(admin ? [['admin', 'Admin', 'shield']] : [])];
  const sub = [['staff', 'Staff'], ['roles', 'Roles & permissions'], ['ai', 'AI settings'], ['audit', 'Audit log']];
  return `<div class="page"><div class="page-head"><div><h1 id="view-h" tabindex="-1">Settings</h1><p class="muted sm" style="margin-top:4px">Manage your account${admin ? ' and workspace' : ''}.</p></div></div>
    <div class="tabs" role="tablist" aria-label="Settings sections">${tabs.map(([k, l, i]) => `<button role="tab" id="tab-${k}" aria-selected="${t.tab === k}" aria-controls="panel" data-act="set-tab" data-arg="${k}" data-fk="tab-${k}" tabindex="${t.tab === k ? 0 : -1}">${icon(i)}${l}${k === 'admin' ? '<span class="role-badge" style="margin-left:4px">Admin only</span>' : ''}</button>`).join('')}</div>
    <div role="tabpanel" id="panel" aria-labelledby="tab-${t.tab}">${t.tab === 'profile' ? profile(t) : t.tab === 'signature' ? sigTab() : t.tab === 'prefs' ? prefs() : t.tab === 'notifications' ? notif(t) :
    `<div class="mini-tabs" role="group" aria-label="Admin sections" style="margin-bottom:20px">${sub.map(([k, l]) => `<button data-act="adm-tab" data-arg="${k}" aria-pressed="${t.admin === k}" style="border:1px solid var(--border);padding:6px 12px">${l}</button>`).join('')}</div>
    ${{ staff: adminStaff, roles: adminRoles, ai: () => adminAI(t), audit: adminAudit }[t.admin]()}`}</div></div>`;
};

const stf = id => K.D.staff.find(s => s.id === id);
const staffForm = (s) => `<form class="od-stack" style="--od-gap:16px" id="sform" novalidate><div class="field"><label for="sn">Full name<span class="req" aria-hidden="true"> *</span></label><input class="input" id="sn" data-v="req" value="${esc(s?.name || '')}" aria-describedby="e-sn" aria-required="true"><span class="err" id="e-sn" hidden></span></div>
  <div class="field"><label for="se">Work email<span class="req" aria-hidden="true"> *</span></label><input class="input" id="se" type="email" data-v="email" value="${esc(s?.mail || '')}" aria-describedby="e-se" aria-required="true"><span class="err" id="e-se" hidden></span></div>
  <div class="field"><label for="sr">Role</label><select class="select" id="sr">${['Staff', 'Viewer', 'Admin'].map(r => `<option ${s?.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div></form>`;

Object.assign(K.acts, {
  'set-tab': (_, k) => { T().tab = k; K.rerender('tab-' + k); },
  'adm-tab': (_, k) => { T().admin = k; K.rerender(); },
  'set-avatar': () => K.toast('Photo picker opens here (wireframe)'),
  'set-avatar-rm': () => K.toast('Photo removed'),
  'set-2fa': () => { const t = T(); if (t.twofa) K.dlg({ title: 'Turn off two-factor?', body: '<p class="muted">Your account will be less secure. You can set it up again at any time.</p>', from: 'tf', actions: [{ label: 'Cancel', act: 'close-dlg', autofocus: true }, { label: 'Turn off', act: '2fa-off', cls: 'btn-danger' }] });
    else K.dlg({ title: 'Set up authenticator', from: 'tf', body: '<div class="od-row" style="--od-gap:16px"><span style="width:96px;height:96px;border:1px solid var(--border);border-radius:8px;display:grid;place-items:center;background:repeating-conic-gradient(#31302e 0 25%,#fff 0 50%) 0 0/16px 16px" role="img" aria-label="QR code placeholder"></span><p class="sm muted">Scan with an authenticator app, then enter the 6-digit code.</p></div><div class="field"><label for="otp">6-digit code</label><input class="input" id="otp" inputmode="numeric" maxlength="6" placeholder="123456"></div>', actions: [{ label: 'Cancel', act: 'close-dlg' }, { label: 'Verify and enable', act: '2fa-on', cls: 'btn-primary' }] }); },
  '2fa-on': () => { T().twofa = true; K.closeDlg(); K.rerender('tf'); K.toast('Two-factor enabled'); },
  '2fa-off': () => { T().twofa = false; K.closeDlg(); K.rerender('tf'); K.toast('Two-factor turned off'); },
  'staff-add': () => K.dlg({ title: 'Invite staff', body: staffForm(), from: 'sadd', actions: [{ label: 'Cancel', act: 'close-dlg' }, { label: 'Send invite', act: 'staff-save', cls: 'btn-primary' }] }),
  'staff-edit': (_, id) => K.dlg({ title: 'Edit staff member', body: staffForm(stf(id)), from: 'se-' + id, actions: [{ label: 'Cancel', act: 'close-dlg' }, { label: 'Save changes', act: 'staff-save', arg: id, cls: 'btn-primary' }] }),
  'staff-save': (_, id) => { const f = document.getElementById('sform'); if (!K.validateForm(f)) return; const v = { name: sn.value.trim(), mail: se.value.trim(), role: sr.value };
    if (id) Object.assign(stf(id), v); else K.D.staff.push({ id: 's' + Date.now(), ...v, st: 'Invited', last: 'Never' }); K.closeDlg(); K.rerender(id ? 'se-' + id : 'sadd'); K.toast(id ? 'Changes saved' : `Invite sent to ${v.mail}`); },
  'staff-resend': (_, id) => K.toast(`Invite re-sent to ${stf(id).mail}`),
  'staff-del': (_, id) => K.dlg({ title: `Delete ${stf(id).name}?`, body: `<p class="muted">${esc(stf(id).name)} will lose access immediately. Their uploads and replies stay in the workspace. This can’t be undone.</p>`, from: 'sd-' + id, actions: [{ label: 'Cancel', act: 'close-dlg', autofocus: true }, { label: 'Delete staff member', act: 'staff-del-ok', arg: id, cls: 'btn-danger' }] }),
  'staff-del-ok': (_, id) => { const n = stf(id).name; K.D.staff = K.D.staff.filter(s => s.id !== id); K.D.audit.unshift(['Nov 7, 2026 now', 'Eleanor Park', `Deleted staff member ${n}`, '192.168.1.24']); K.dlgFrom = 'sadd'; K.closeDlg(); K.rerender('sadd'); K.toast(`${n} removed`); },
  'tax-rm': (_, v) => { const [k, x] = v.split('|'); K.D.tax[k] = K.D.tax[k].filter(y => y !== x); K.rerender(); },
  'tax-add': (_, k) => K.dlg({ title: `Add ${k} tag`, from: '', body: `<div class="field"><label for="tv">Tag name<span class="req" aria-hidden="true"> *</span></label><input class="input" id="tv" data-v="req" aria-describedby="e-tv" aria-required="true"><span class="err" id="e-tv" hidden></span></div>`, actions: [{ label: 'Cancel', act: 'close-dlg' }, { label: 'Add tag', act: 'tax-ok', arg: k, cls: 'btn-primary' }] }),
  'tax-ok': (_, k) => { if (!K.validate(tv)) return tv.focus(); K.D.tax[k].push(tv.value.trim()); K.closeDlg(); K.rerender(); },
  'pv-eye': () => { const p = T().ai.prov; p.show = !p.show; K.rerender('pv-eye'); },
  'pv-test': () => {
    const p = T().ai.prov, bad = ['pv-url', 'pv-key'].map(id => document.getElementById(id)).filter(el => el.dataset.v && !K.validate(el));
    if (bad.length) return bad[0].focus();
    p.status = 'testing'; p.msg = ''; document.getElementById('pv-conn').innerHTML = pvConn(p);
    setTimeout(() => {
      if (p.status !== 'testing' || !document.getElementById('pv-conn')) return;
      const k = p.key.trim(), ok = !k || k.length >= 8;
      p.status = ok ? 'ok' : 'fail'; p.msg = ok ? `Reached ${p.url.replace(/^https?:\/\//i, '').split('/')[0]}. Model list loaded.` : '401 Unauthorized. The provider rejected this key.';
      document.getElementById('pv-conn').innerHTML = pvConn(p); document.querySelector('[data-act="pv-test"]').focus();
    }, 900);
  },
  'ai-save': () => K.toast('AI settings saved'),
});
Object.assign(K.submit, {
  profile: f => { if (K.validateForm(f)) K.toast('Profile saved'); },
  sig: () => { const v = id => document.getElementById(id); Object.assign(SG(), { on: v('sg-on').checked, close: v('sg-close').value.trim(), name: v('sg-name').value.trim(), title: v('sg-title').value.trim(), phone: v('sg-phone').value.trim() }); K.toast('Signature saved'); },
  away: () => { const g = SG(), e = schErr(sch(g)), er = document.getElementById('e-sch'); er.hidden = !e; er.textContent = e; if (e) return document.querySelector('[data-sch]:checked, [data-sch]').focus(); g.away = document.getElementById('aw-on').checked; g.awayMsg = document.getElementById('aw-msg').value.trim(); K.rerender('awsave'); K.toast(g.away ? 'Away message is on' : 'Away message saved'); },
  prov: () => { const p = T().ai.prov; p.max = String(Math.min(8192, Math.max(64, Math.round(+p.max) || 1024))); K.D.audit.unshift(['Nov 7, 2026 now', 'Eleanor Park', `Updated AI provider (${PRE[p.preset][0]})`, '192.168.1.24']); K.rerender('pvsave'); K.toast(`${PRE[p.preset][0]} provider saved`); },
  password: f => { if (K.validateForm(f)) { f.reset(); K.toast('Password updated'); } },
});
document.addEventListener('change', e => {
  if (S.route !== 'settings') return; const t = T(), el = e.target;
  if (el.dataset.sch !== undefined) { const s = Object.assign(sch(SG()), readSch()); document.querySelectorAll('.sch-p').forEach(d => d.hidden = d.dataset.sp !== s.mode); document.getElementById('sch-sum').textContent = schSum(s); const er = document.getElementById('e-sch'); er.hidden = true; }
  else if (el.dataset.pf) { PF[el.dataset.pf] = el.type === 'checkbox' ? el.checked : el.value; K.toast('Preference saved'); }
  else if (el.dataset.nt) { const [g, k] = el.dataset.nt.split('.'); t.notif[g][k] = el.checked; K.toast('Preference saved'); }
  else if (el.matches('[data-nt-sel]')) { t.notif.digest = el.value; K.toast('Digest set to ' + el.value.toLowerCase()); }
  else if (el.dataset.prov && el.tagName === 'SELECT') { const p = t.ai.prov, [, url, m] = PRE[el.value]; Object.assign(p, { preset: el.value, status: 'untested', msg: '' }, el.value === 'custom' ? {} : { url, chat: m[0] || '', vision: m[0] || '' }); K.rerender('pv-preset'); }
  else if (el.dataset.ai === 'tone') t.ai.tone = el.value; else if (el.dataset.ai === 'model') t.ai.model = el.checked;
  else if (el.dataset.perm) K.toast('Permission updated');
});
document.addEventListener('input', e => {
  if (e.target.matches?.('[data-sg]')) { const v = id => document.getElementById(id).value; document.getElementById('sg-pv').textContent = build({ close: v('sg-close'), name: v('sg-name'), title: v('sg-title'), phone: v('sg-phone') }); }
});
document.addEventListener('input', e => {
  const el = e.target, k = el.dataset?.prov; if (!k || el.tagName === 'SELECT' || S.route !== 'settings') return;
  const p = T().ai.prov; p[k] = el.value;
  if (k === 'temp') document.getElementById('pv-tv').textContent = el.value;
  if (['url', 'key', 'org'].includes(k) && p.status !== 'untested') { p.status = 'untested'; p.msg = ''; document.getElementById('pv-conn').innerHTML = pvConn(p); }
});
document.addEventListener('input', e => { if (e.target.dataset?.ai === 'sens') { T().ai.sens = +e.target.value; document.getElementById('sensv').textContent = ['', 'Very loose', 'Loose', 'Balanced', 'Strict', 'Very strict'][+e.target.value]; } });
})();
