import { useCallback, useEffect, useRef, useState } from 'react';
import type { components } from '../api/schema';
import { bridge, type RejectReason } from '../bridge';
import { Avatar } from '../shell/Avatar';
import { useShell } from '../shell/context';
import { ErrorBlock, Skeleton } from '../shell/ui';
import { TwoFactorCard } from './TwoFactor';

type Profile = components['schemas']['ProfileView'];
type Problems = Record<string, string>;

const MAX_NAME = 80;
const RULE = 'Use 8 to 128 characters with at least one number.';
const PHOTO_WHY: Record<RejectReason, string> = {
  type: 'Choose a JPEG, PNG or WebP photo.',
  size: 'The photo must be 2 MB or smaller.',
  full: 'Choose one photo.',
  dimensions: 'That photo is too large in pixels. Choose a smaller one.',
  unreadable: "Couldn't read that file.",
};
const LEVEL = ['', 'Weak', 'Fair', 'Good', 'Strong'];

const acceptable = (pw: string) => pw.length >= 8 && pw.length <= 128 && /\d/.test(pw);
export function strength(pw: string): number {
  if (!pw) return 0;
  const hits = [pw.length >= 8, pw.length >= 12, /[a-z]/i.test(pw) && /\d/.test(pw), (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) || /[^a-z0-9]/i.test(pw)];
  return Math.max(1, hits.filter(Boolean).length);
}

export function ProfileTab() {
  const shell = useShell();
  const req = useRef(shell.request);
  req.current = shell.request;
  const { toast, setDirty } = shell;
  const reloadMe = useRef(shell.reloadMe);
  reloadMe.current = shell.reloadMe;

  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [saved, setSaved] = useState<Profile | null>(null);
  const [name, setName] = useState('');
  const [problems, setProblems] = useState<Problems>({});
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoErr, setPhotoErr] = useState('');
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [pwProblems, setPwProblems] = useState<Problems>({});
  const [changing, setChanging] = useState(false);

  const load = useCallback(async (resetName = true): Promise<void> => {
    try {
      const r = await req.current<Profile>('GET', '/api/v1/me/profile');
      if (r.status === 200 && r.body) {
        setSaved(r.body);
        if (resetName) setName(r.body.name ?? '');
        setState('ready');
        return;
      }
    } catch { /* the shell already raised the offline banner or the expiry */ }
    setState('error');
  }, []);
  useEffect(() => { void load(); }, [load]);

  const dirty = (saved !== null && name.trim() !== (saved.name ?? '')) || !!cur || !!pw || !!again;
  useEffect(() => { setDirty(dirty); }, [dirty, setDirty]);
  useEffect(() => () => setDirty(false), [setDirty]);

  if (state === 'loading') return <Skeleton rows={5} height={44} />;
  if (state === 'error' || !saved) return <ErrorBlock what="your profile" onRetry={() => { setState('loading'); void load(); }} />;

  const save = async () => {
    const n = name.trim();
    if (!n) return setProblems({ name: 'Name is required.' });
    if (n.length > MAX_NAME) return setProblems({ name: `Name must be ${MAX_NAME} characters or fewer.` });
    setSaving(true);
    try {
      const r = await req.current<Profile>('PATCH', '/api/v1/me/profile', { name: n }, saved.version);
      if (r.status === 200 && r.body) {
        setSaved(r.body);
        setName(r.body.name ?? n);
        setProblems({});
        toast('Profile saved');
        void reloadMe.current();
      } else if (r.status === 409) setProblems({ form: 'Your profile changed in another window. Reload to see the latest.', stale: '1' });
      else if (r.status === 422) setProblems({ name: n.length ? 'Check the name and try again.' : 'Name is required.' });
      else setProblems({ form: "Couldn't save. Your changes are kept here." });
    } catch { setProblems({ form: "Couldn't save. Your changes are kept here." }); } finally { setSaving(false); }
  };

  const upload = async () => {
    setPhotoBusy(true);
    setPhotoErr('');
    try {
      const out = await bridge.uploadFiles('avatar', '');
      if (out.stored.length) {
        await load(false);
        void reloadMe.current();
        toast('Profile saved');
      } else if (out.rejected[0]) setPhotoErr(PHOTO_WHY[out.rejected[0].reason]);
    } catch { toast("Couldn't update the photo. Try again.", 'error'); } finally { setPhotoBusy(false); }
  };

  const remove = async () => {
    setPhotoBusy(true);
    setPhotoErr('');
    try {
      const r = await req.current('DELETE', '/api/v1/me/avatar');
      if (r.status === 204 || r.status === 200) {
        await load(false);
        void reloadMe.current();
        toast('Profile saved');
      } else toast("Couldn't remove the photo. Try again.", 'error');
    } catch { toast("Couldn't remove the photo. Try again.", 'error'); } finally { setPhotoBusy(false); }
  };

  const change = async () => {
    const p: Problems = {};
    if (!cur) p.current = 'Enter your current password.';
    if (!pw) p.new = 'Enter a new password.';
    else if (!acceptable(pw)) p.new = RULE;
    if (again !== pw) p.confirm = "Passwords don't match.";
    setPwProblems(p);
    if (Object.keys(p).length) return;
    setChanging(true);
    try {
      const r = await req.current<{ fields?: { field: string; code: string }[] }>('POST', '/api/v1/me/password', { current: cur, new: pw });
      if (r.status === 204 || r.status === 200) {
        setCur(''); setPw(''); setAgain('');
        toast('Password updated');
      } else if (r.status === 422) {
        const f = r.body?.fields ?? [];
        setPwProblems({
          ...(f.some((x) => x.field === 'current') && { current: 'Current password is incorrect.' }),
          ...(f.some((x) => x.field === 'new') && { new: RULE }),
          ...(!f.length && { form: "Couldn't update the password. Check the fields and try again." }),
        });
      } else if (r.status === 429) setPwProblems({ form: 'Too many attempts. Try again in a few minutes.' });
      else setPwProblems({ form: "Couldn't update the password. Try again." });
    } catch { setPwProblems({ form: "Couldn't update the password. Try again." }); } finally { setChanging(false); }
  };

  const field = (id: string, label: string, value: string, set: (v: string) => void, errs: Problems, extra: Record<string, string> = {}) => (
    <>
      <label htmlFor={id}>{label}</label>
      <input
        id={id} type="password" autoComplete={extra.autoComplete} value={value} onChange={(e) => set(e.target.value)}
        aria-invalid={!!errs[extra.key]} aria-describedby={errs[extra.key] ? `${id}-err` : undefined}
      />
      {errs[extra.key] && <p id={`${id}-err`} className="error">{errs[extra.key]}</p>}
    </>
  );
  const score = strength(pw);

  return (
    <>
      <form className="form" noValidate aria-labelledby="profile-h" onSubmit={(e) => { e.preventDefault(); if (!saving) void save(); }}>
        <h2 id="profile-h">Profile</h2>
        <div className="avatar-row">
          <Avatar name={saved.name ?? ''} revision={saved.avatar} large />
          <button type="button" className="btn" disabled={photoBusy} onClick={() => void upload()}>Upload photo</button>
          <button type="button" className="btn" disabled={photoBusy || !saved.avatar} onClick={() => void remove()}>Remove</button>
        </div>
        <p className="hint">JPEG, PNG or WebP, up to 2 MB.</p>
        {photoErr && <p role="alert" className="error">{photoErr}</p>}
        <label htmlFor="profile-name">Name</label>
        <input
          id="profile-name" value={name} maxLength={MAX_NAME + 20} onChange={(e) => setName(e.target.value)} autoComplete="name"
          aria-invalid={!!problems.name} aria-describedby={problems.name ? 'profile-name-err' : undefined}
        />
        {problems.name && <p id="profile-name-err" className="error">{problems.name}</p>}
        <label htmlFor="profile-email">Email</label>
        <input id="profile-email" value={saved.email ?? ''} readOnly aria-describedby="profile-email-note" />
        <p id="profile-email-note" className="hint">Ask an admin to change your email.</p>
        {problems.form && (
          <p role="alert" className="error">
            {problems.form}
            {problems.stale && <> <button type="button" className="link" onClick={() => { setProblems({}); void load(); }}>Reload</button></>}
          </p>
        )}
        <div className="actions">
          <button type="submit" className="btn primary" disabled={saving || name.trim() === (saved.name ?? '')}>Save changes</button>
        </div>
      </form>

      <form className="form" noValidate aria-labelledby="password-h" onSubmit={(e) => { e.preventDefault(); if (!changing) void change(); }}>
        <h2 id="password-h">Password</h2>
        {field('pw-current', 'Current password', cur, setCur, pwProblems, { key: 'current', autoComplete: 'current-password' })}
        {field('pw-new', 'New password', pw, setPw, pwProblems, { key: 'new', autoComplete: 'new-password' })}
        {pw && (
          <p className="strength">
            <meter min={0} max={4} value={score} aria-label="Password strength" /> <span>{LEVEL[score]}</span>
          </p>
        )}
        {field('pw-confirm', 'Confirm new password', again, setAgain, pwProblems, { key: 'confirm', autoComplete: 'new-password' })}
        <p className="hint">Other devices will be signed out.</p>
        {pwProblems.form && <p role="alert" className="error">{pwProblems.form}</p>}
        <div className="actions">
          <button type="submit" className="btn primary" disabled={changing}>Update password</button>
        </div>
      </form>

      <TwoFactorCard />
    </>
  );
}
