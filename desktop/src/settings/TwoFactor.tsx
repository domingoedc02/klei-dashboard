import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { components } from '../api/schema';
import { useShell } from '../shell/context';

type Status = components['schemas']['TwoFactorStatus'];
type Setup = components['schemas']['TwoFactorSetup'];
type Fields = { field: string; code: string }[];

const BAD_CODE = 'That code is incorrect or has expired.';
const WAIT = 'Too many attempts. Try again in a few minutes.';

/** The one-time list of recovery codes. The server never shows them again, so the dialog stays until "I saved them". */
function Codes({ codes, done }: { codes: string[]; done: () => void }) {
  const { toast } = useShell();
  const copy = async () => {
    try { await navigator.clipboard.writeText(codes.join('\n')); toast('Copied'); } catch { toast("Couldn't copy. Select the text instead.", 'error'); }
  };
  return (
    <div className="form">
      <p className="lede">Save these 8 recovery codes somewhere safe. Each one works once if you lose your phone. You won’t see them again.</p>
      <ul className="recovery" aria-label="Recovery codes">{codes.map((c) => <li key={c}><code>{c}</code></li>)}</ul>
      <div className="actions">
        <button type="button" className="btn" onClick={() => void copy()}>Copy</button>
        <button type="button" className="btn primary" onClick={done}>I saved them</button>
      </div>
    </div>
  );
}

function Setup({ close, enabled }: { close: () => void; enabled: () => void }) {
  const { request, toast } = useShell();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [failed, setFailed] = useState(false);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // One start per dialog: a second would replace the secret the QR already shows.
    if (started.current) return;
    started.current = true;
    request<Setup>('POST', '/api/v1/me/2fa/start').then((r) => (r.status === 200 && r.body ? setSetup(r.body) : setFailed(true)), () => setFailed(true));
  }, [request]);

  if (codes) return <Codes codes={codes} done={close} />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) return setErr('Enter the 6 digits from your authenticator app.');
    setBusy(true);
    setErr('');
    try {
      const r = await request<{ codes?: string[] }>('POST', '/api/v1/me/2fa/confirm', { code: code.trim() });
      if (r.status === 200 && r.body?.codes) {
        setCodes(r.body.codes);
        toast('Two-factor enabled');
        enabled();
      } else if (r.status === 422) setErr(BAD_CODE);
      else if (r.status === 429) setErr(WAIT);
      else setErr("Couldn't turn on two-factor. Try again.");
    } catch { setErr("Couldn't reach the server. Try again."); } finally { setBusy(false); }
  };

  return (
    <form className="form" noValidate onSubmit={submit}>
      {failed && <p role="alert" className="error">Couldn't start setup. Close this and try again.</p>}
      {!failed && !setup && <p className="hint" role="status">Preparing your code…</p>}
      {setup && (
        <>
          <p className="lede">Scan with an authenticator app, then enter the 6-digit code.</p>
          <img className="qr" src={setup.qr} role="img" alt="QR code for your authenticator app" width={192} height={192} />
          <p className="hint">Can’t scan? Enter this key instead: <code className="secret">{setup.secret}</code></p>
        </>
      )}
      <label htmlFor="tf-code">6-digit code</label>
      <input
        id="tf-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} disabled={!setup} autoFocus
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-invalid={!!err} aria-describedby={err ? 'tf-code-err' : undefined}
      />
      {err && <p id="tf-code-err" role="alert" className="error">{err}</p>}
      <div className="actions">
        <button type="button" className="btn" onClick={close}>Cancel</button>
        <button type="submit" className="btn primary" disabled={busy || !setup}>Turn on</button>
      </div>
    </form>
  );
}

/** Password plus a code (or a recovery code): the proof both "Turn off" and "Make new codes" ask for. */
function Proof({ close, path, label, danger, onDone }: {
  close: () => void; path: string; label: string; danger?: boolean; onDone: (body: { codes?: string[] } | null) => void;
}) {
  const { request } = useShell();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const p: Record<string, string> = {};
    if (!password) p.password = 'Enter your current password.';
    if (!code.trim()) p.code = 'Enter a code from your app, or a recovery code.';
    setErrs(p);
    if (Object.keys(p).length) return;
    setBusy(true);
    try {
      const r = await request<{ codes?: string[]; fields?: Fields }>('POST', path, { password, code: code.trim() });
      if (r.status === 200 || r.status === 204) return onDone(r.body ?? null);
      if (r.status === 422) {
        const f = r.body?.fields ?? [];
        setErrs({ ...(f.some((x) => x.field === 'password') && { password: 'Current password is incorrect.' }), ...(f.some((x) => x.field === 'code') && { code: BAD_CODE }) });
      } else if (r.status === 429) setErrs({ form: WAIT });
      else if (r.status === 409) setErrs({ form: 'Two-factor is not on for your account.' });
      else setErrs({ form: "Couldn't do that. Try again." });
    } catch { setErrs({ form: "Couldn't reach the server. Try again." }); } finally { setBusy(false); }
  };

  return (
    <form className="form" noValidate onSubmit={submit}>
      <label htmlFor="tf-pw">Current password</label>
      <input id="tf-pw" type="password" autoComplete="current-password" value={password} autoFocus onChange={(e) => setPassword(e.target.value)} aria-invalid={!!errs.password} aria-describedby={errs.password ? 'tf-pw-err' : undefined} />
      {errs.password && <p id="tf-pw-err" className="error">{errs.password}</p>}
      <label htmlFor="tf-oc">Code</label>
      <input id="tf-oc" autoComplete="one-time-code" maxLength={16} value={code} onChange={(e) => setCode(e.target.value)} aria-invalid={!!errs.code} aria-describedby={errs.code ? 'tf-oc-err' : 'tf-oc-hint'} />
      {errs.code ? <p id="tf-oc-err" className="error">{errs.code}</p> : <p id="tf-oc-hint" className="hint">A 6-digit code from your app, or one recovery code.</p>}
      {errs.form && <p role="alert" className="error">{errs.form}</p>}
      <div className="actions">
        <button type="button" className="btn" onClick={close}>Cancel</button>
        <button type="submit" className={danger ? 'btn danger' : 'btn primary'} disabled={busy}>{label}</button>
      </div>
    </form>
  );
}

export function TwoFactorCard() {
  const { request, openDialog, toast } = useShell();
  const req = useRef(request);
  req.current = request;
  const [status, setStatus] = useState<Status | null | 'error'>(null);

  const load = useCallback(async () => {
    try {
      const r = await req.current<Status>('GET', '/api/v1/me/2fa');
      setStatus(r.status === 200 && r.body ? r.body : 'error');
    } catch { setStatus('error'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (status === null) return null;
  const on = status !== 'error' && status.enabled === true;
  const left = status === 'error' ? 0 : status.recoveryLeft ?? 0;

  const setUp = () => openDialog({ title: 'Set up authenticator', custom: (close) => <Setup close={() => { close(); void load(); }} enabled={() => void load()} /> });
  const off = () => openDialog({
    title: 'Turn off two-factor?',
    custom: (close) => (
      <>
        <p className="lede">Your account will be less secure. You can set it up again at any time.</p>
        <Proof close={close} path="/api/v1/me/2fa/disable" label="Turn off" danger onDone={() => { close(); toast('Two-factor turned off'); void load(); }} />
      </>
    ),
  });
  const renew = () => openDialog({
    title: 'Make new codes',
    custom: (close) => <Renew close={close} onDone={() => void load()} />,
  });

  return (
    <section className="form" aria-labelledby="tf-h">
      <h2 id="tf-h">Two-factor authentication</h2>
      {status !== 'error' && status.reset && !on && (
        <p className="banner" role="status">An admin reset your two-factor sign-in. Set it up again to keep your account protected.</p>
      )}
      {status === 'error' ? (
        <p role="alert" className="error">Couldn't load two-factor settings. <button type="button" className="link" onClick={() => void load()}>Retry</button></p>
      ) : (
        <div className="tf-row">
          <div>
            <strong>Authenticator app</strong>
            <p className="hint tf-hint">{on ? 'Enabled. You’ll enter a 6-digit code at sign-in.' : 'Add a second step when you sign in. Recommended for admins.'}</p>
            {on && <p className="hint tf-hint">{left === 1 ? '1 recovery code left' : `${left} recovery codes left`}</p>}
          </div>
          <span className={`pill ${on ? 'pos' : 'neutral'}`}>{on ? 'On' : 'Off'}</span>
          {on ? (
            <span className="tf-actions">
              <button type="button" className="btn" onClick={renew}>Make new codes</button>
              <button type="button" className="btn" onClick={off}>Turn off</button>
            </span>
          ) : (
            <button type="button" className="btn" onClick={setUp}>Set up</button>
          )}
        </div>
      )}
    </section>
  );
}

/** Password and code first, then the new codes in the same dialog. */
function Renew({ close, onDone }: { close: () => void; onDone: () => void }) {
  const [codes, setCodes] = useState<string[] | null>(null);
  if (codes) return <Codes codes={codes} done={close} />;
  return <Proof close={close} path="/api/v1/me/2fa/codes" label="Make new codes" onDone={(b) => { if (b?.codes) setCodes(b.codes); onDone(); }} />;
}
