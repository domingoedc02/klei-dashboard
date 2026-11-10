import { useCallback, useEffect, useRef, useState } from 'react';
import type { components } from '../api/schema';
import { useShell } from '../shell/context';
import { ErrorBlock, Skeleton } from '../shell/ui';
import { renderSignature } from './signature';

type Sig = components['schemas']['SignatureView'];
type Studio = components['schemas']['WorkspaceView'];
type Problems = Record<string, string>;
type Fields = { enabled: boolean; signoff: string; name: string; title: string; phone: string };
type Reply = { fields?: { field: string; code: string }[] };

const MAX_LINE = 80;
const MAX_NAME = 80;
const MAX_ADDRESS = 240;
const MAX_LINES = 4;
const LONG = `Use ${MAX_LINE} characters or fewer.`;
const STALE = 'This changed in another window. Reload to see the latest.';
const KEEP = "Couldn't save. Your changes are kept here.";
const LINES: [keyof Fields, string][] = [['signoff', 'Sign-off'], ['name', 'Name'], ['title', 'Title'], ['phone', 'Phone']];

const fieldsOf = (s: Sig): Fields => ({ enabled: !!s.enabled, signoff: s.signoff ?? '', name: s.name ?? '', title: s.title ?? '', phone: s.phone ?? '' });
const addressLines = (a: string) => a.split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
const same = (a: Fields, b: Fields) => a.enabled === b.enabled && LINES.every(([k]) => String(a[k]).trim() === String(b[k]).trim());

export function SignatureTab() {
  const shell = useShell();
  const req = useRef(shell.request);
  req.current = shell.request;
  const { toast, setDirty } = shell;
  const isAdmin = shell.can(['PERM_MANAGE_STAFF']);

  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [saved, setSaved] = useState<Sig | null>(null);
  const [form, setForm] = useState<Fields>({ enabled: false, signoff: '', name: '', title: '', phone: '' });
  const [studio, setStudio] = useState<Studio | null>(null);
  const [studioName, setStudioName] = useState('');
  const [studioAddress, setStudioAddress] = useState('');
  const [problems, setProblems] = useState<Problems>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [s, w] = await Promise.all([
        req.current<Sig>('GET', '/api/v1/me/signature'),
        isAdmin ? req.current<Studio>('GET', '/api/v1/admin/workspace') : Promise.resolve(null),
      ]);
      if (s.status === 200 && s.body && (!isAdmin || (w?.status === 200 && w.body))) {
        setSaved(s.body);
        setForm(fieldsOf(s.body));
        if (w?.body) {
          setStudio(w.body);
          setStudioName(w.body.studioName ?? '');
          setStudioAddress(w.body.studioAddress ?? '');
        }
        setProblems({});
        setState('ready');
        return;
      }
    } catch { /* the shell already raised the offline banner or the expiry */ }
    setState('error');
  }, [isAdmin]);
  useEffect(() => { void load(); }, [load]);

  const sigDirty = saved !== null && !same(form, fieldsOf(saved));
  const studioDirty = studio !== null && (studioName.trim() !== (studio.studioName ?? '') || addressLines(studioAddress).join('\n') !== (studio.studioAddress ?? ''));
  const dirty = sigDirty || studioDirty;
  useEffect(() => { setDirty(dirty); }, [dirty, setDirty]);
  useEffect(() => () => setDirty(false), [setDirty]);

  if (state === 'loading') return <Skeleton rows={6} height={44} />;
  if (state === 'error' || !saved) return <ErrorBlock what="your signature" onRetry={() => { setState('loading'); void load(); }} />;

  const shownName = isAdmin ? studioName : saved.studio?.name ?? '';
  const shownAddress = isAdmin ? studioAddress : saved.studio?.address ?? '';
  const preview = renderSignature({ ...form, studioName: shownName, studioAddress: shownAddress });
  const set = (patch: Partial<Fields>) => setForm((f) => ({ ...f, ...patch }));

  const check = (): Problems => {
    const p: Problems = {};
    for (const [k] of LINES) if (String(form[k]).trim().length > MAX_LINE) p[k] = LONG;
    if (isAdmin) {
      if (studioName.trim().length > MAX_NAME) p.studioName = `Use ${MAX_NAME} characters or fewer.`;
      const lines = addressLines(studioAddress);
      if (lines.length > MAX_LINES) p.studioAddress = `Use up to ${MAX_LINES} lines.`;
      else if (lines.join('\n').length > MAX_ADDRESS) p.studioAddress = `Use ${MAX_ADDRESS} characters or fewer.`;
    }
    return p;
  };

  const fail = (status: number, body: Reply | null, map: Record<string, string>): Problems => {
    if (status === 409) return { form: STALE, stale: '1' };
    if (status === 422) {
      const out: Problems = {};
      for (const f of body?.fields ?? []) out[map[f.field] ?? 'form'] = f.code === 'too_many_lines' ? `Use up to ${MAX_LINES} lines.` : f.code === 'invalid' ? 'Use one line only.' : f.code === 'required' ? 'This is required.' : LONG;
      return Object.keys(out).length ? out : { form: 'Check the fields and try again.' };
    }
    return { form: KEEP };
  };

  const save = async () => {
    const found = check();
    setProblems(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    let out: Problems = {};
    try {
      if (sigDirty) {
        const r = await req.current<Sig & Reply>('PUT', '/api/v1/me/signature', { ...form, signoff: form.signoff.trim(), name: form.name.trim(), title: form.title.trim(), phone: form.phone.trim() }, saved.version);
        if (r.status === 200 && r.body) { setSaved(r.body); setForm(fieldsOf(r.body)); } else out = fail(r.status, r.body, {});
      }
      if (!Object.keys(out).length && studioDirty && studio) {
        const r = await req.current<Studio & Reply>('PUT', '/api/v1/admin/workspace', { studioName: studioName.trim(), studioAddress: addressLines(studioAddress).join('\n') }, studio.version);
        if (r.status === 200 && r.body) { setStudio(r.body); setStudioName(r.body.studioName ?? ''); setStudioAddress(r.body.studioAddress ?? ''); } else out = fail(r.status, r.body, { studioName: 'studioName', studioAddress: 'studioAddress' });
      }
    } catch { out = { form: KEEP }; } finally { setSaving(false); }
    setProblems(out);
    if (!Object.keys(out).length) toast('Changes saved');
  };

  const text = (id: string, label: string, value: string, onChange: (v: string) => void, key: string, extra: { autoComplete?: string } = {}) => (
    <>
      <label htmlFor={id}>{label}</label>
      <input
        id={id} value={value} maxLength={MAX_LINE + 20} autoComplete={extra.autoComplete} onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!problems[key]} aria-describedby={problems[key] ? `${id}-err` : undefined}
      />
      {problems[key] && <p id={`${id}-err`} className="error">{problems[key]}</p>}
    </>
  );

  return (
    <form className="form" noValidate aria-labelledby="signature-h" onSubmit={(e) => { e.preventDefault(); if (!saving) void save(); }}>
      <h2 id="signature-h">Signature</h2>
      <label className="switch">
        <input id="sig-enabled" type="checkbox" role="switch" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        Add my signature to replies
      </label>
      {text('sig-signoff', 'Sign-off', form.signoff, (v) => set({ signoff: v }), 'signoff')}
      {text('sig-name', 'Name', form.name, (v) => set({ name: v }), 'name', { autoComplete: 'name' })}
      {text('sig-title', 'Title', form.title, (v) => set({ title: v }), 'title', { autoComplete: 'organization-title' })}
      {text('sig-phone', 'Phone', form.phone, (v) => set({ phone: v }), 'phone', { autoComplete: 'tel' })}

      {isAdmin && (
        <>
          <h2 id="studio-h">Studio</h2>
          <p className="hint">Every signature ends with the studio name, your phone and the address.</p>
          {text('studio-name', 'Studio name', studioName, setStudioName, 'studioName')}
          <label htmlFor="studio-address">Studio address</label>
          <textarea
            id="studio-address" rows={4} value={studioAddress} onChange={(e) => setStudioAddress(e.target.value)}
            aria-invalid={!!problems.studioAddress} aria-describedby={problems.studioAddress ? 'studio-address-err' : 'studio-address-note'}
          />
          {problems.studioAddress ? <p id="studio-address-err" className="error">{problems.studioAddress}</p> : <p id="studio-address-note" className="hint">Up to {MAX_LINES} lines.</p>}
        </>
      )}

      <section aria-labelledby="sig-preview-h" className="sig-preview">
        <h3 id="sig-preview-h">Preview</h3>
        {form.enabled
          ? preview ? <pre>{preview}</pre> : <p className="hint">Add a sign-off or name to see your signature.</p>
          : <p className="hint">Signature is off. Replies will end without one.</p>}
      </section>

      {problems.form && (
        <p role="alert" className="error">
          {problems.form}
          {problems.stale && <> <button type="button" className="link" onClick={() => { setState('loading'); void load(); }}>Reload</button></>}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={saving || !dirty}>Save changes</button>
      </div>
    </form>
  );
}
