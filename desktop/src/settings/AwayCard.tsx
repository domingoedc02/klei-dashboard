import { useCallback, useEffect, useRef, useState } from 'react';
import type { components } from '../api/schema';
import { useShell } from '../shell/context';
import { ErrorBlock, Skeleton } from '../shell/ui';
import { DAYS, MODES, scheduleError, summary, type Mode, type Schedule } from './away';

type View = components['schemas']['AwayView'];
type Form = { enabled: boolean; message: string; schedule: Schedule };
type Reply = { fields?: { field: string; code: string }[] };
type Problems = Record<string, string>;

const MAX_MESSAGE = 2000;
const NEED = 'Enter the message to send.';
const STALE = 'This changed in another window. Reload to see the latest.';
const KEEP = "Couldn't save. Your changes are kept here.";

const formOf = (v: View): Form => ({
  enabled: !!v.enabled,
  message: v.message ?? '',
  schedule: {
    mode: (v.schedule?.mode as Mode) ?? 'weekly', days: v.schedule?.days ?? [], start: v.schedule?.start ?? '',
    end: v.schedule?.end ?? '', from: v.schedule?.from ?? '', to: v.schedule?.to ?? '',
  },
});
const key = (f: Form) => JSON.stringify({ ...f, message: f.message.trim(), schedule: { ...f.schedule, days: [...f.schedule.days].sort() } });

export function AwayCard() {
  const shell = useShell();
  const req = useRef(shell.request);
  req.current = shell.request;
  const { toast, setDirty } = shell;

  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [saved, setSaved] = useState<View | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [problems, setProblems] = useState<Problems>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const r = await req.current<View>('GET', '/api/v1/admin/away');
      if (r.status === 200 && r.body) {
        setSaved(r.body);
        setForm(formOf(r.body));
        setProblems({});
        setState('ready');
        return;
      }
    } catch { /* the shell already raised the offline banner or the expiry */ }
    setState('error');
  }, []);
  useEffect(() => { void load(); }, [load]);

  const dirty = !!saved && !!form && key(form) !== key(formOf(saved));
  useEffect(() => { setDirty(dirty); }, [dirty, setDirty]);
  useEffect(() => () => setDirty(false), [setDirty]);

  if (state === 'loading') return <Skeleton rows={6} height={44} />;
  if (state === 'error' || !saved || !form) return <ErrorBlock what="the away message" onRetry={() => { setState('loading'); void load(); }} />;

  const s = form.schedule;
  const bad = scheduleError(s);
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const setSch = (patch: Partial<Schedule>) => set({ schedule: { ...s, ...patch } });
  const toggleDay = (d: string) => setSch({ days: s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d] });

  const check = (): Problems => {
    const p: Problems = {};
    const m = form.message.trim();
    if (form.enabled && !m) p.message = NEED;
    else if (m.length > MAX_MESSAGE) p.message = `Use ${MAX_MESSAGE} characters or fewer.`;
    if (bad) p.schedule = bad;
    return p;
  };

  const fail = (status: number, body: Reply | null): Problems => {
    if (status === 409) return { form: STALE, stale: '1' };
    if (status === 422) {
      const out: Problems = {};
      for (const f of body?.fields ?? []) {
        if (f.field === 'message') out.message = f.code === 'too_long' ? `Use ${MAX_MESSAGE} characters or fewer.` : NEED;
        else out.form = 'Check the schedule and try again.';
      }
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
      const r = await req.current<View & Reply>('PUT', '/api/v1/admin/away', {
        enabled: form.enabled,
        message: form.message.trim(),
        schedule: { mode: s.mode, days: s.days, start: s.start || null, end: s.end || null, from: s.from || null, to: s.to || null },
      }, saved.version);
      if (r.status === 200 && r.body) { setSaved(r.body); setForm(formOf(r.body)); } else out = fail(r.status, r.body);
    } catch { out = { form: KEEP }; } finally { setSaving(false); }
    setProblems(out);
    if (!Object.keys(out).length) toast('Away message saved');
  };

  return (
    <form className="form" noValidate aria-labelledby="away-h" onSubmit={(e) => { e.preventDefault(); if (!saving) void save(); }}>
      <h2 id="away-h">Away message</h2>
      <p className="hint">Sent once to each new inquiry while you are out.</p>
      <label className="switch">
        <input id="away-on" type="checkbox" role="switch" checked={form.enabled} aria-describedby="away-state" onChange={(e) => set({ enabled: e.target.checked })} />
        Send away message
      </label>
      <p id="away-state" className="hint">{form.enabled ? (bad ? 'On.' : `On. ${summary(s)}`) : 'Off. Turn on when the studio is closed.'}</p>

      <label htmlFor="away-message">Message</label>
      <textarea
        id="away-message" rows={5} value={form.message} onChange={(e) => set({ message: e.target.value })} aria-required="true"
        aria-invalid={!!problems.message} aria-describedby={problems.message ? 'away-message-err' : undefined}
      />
      {problems.message && <p id="away-message-err" className="error">{problems.message}</p>}

      <fieldset className="tones">
        <legend>When is the business off?</legend>
        {MODES.map(([id, label, help]) => (
          <label key={id} className={`tone${s.mode === id ? ' on' : ''}`}>
            <input type="radio" name="away-mode" value={id} checked={s.mode === id} onChange={() => setSch({ mode: id })} />
            <strong>{label}</strong>
            <span className="hint">{help}</span>
          </label>
        ))}
      </fieldset>

      {s.mode === 'once' && (
        <>
          <label htmlFor="away-start">First day closed</label>
          <input id="away-start" type="date" value={s.start} aria-required="true" onChange={(e) => setSch({ start: e.target.value })} />
          <label htmlFor="away-end">Last day closed</label>
          <input id="away-end" type="date" value={s.end} aria-describedby="away-end-note" onChange={(e) => setSch({ end: e.target.value })} />
          <p id="away-end-note" className="hint">Optional. Leave blank for a single day.</p>
        </>
      )}
      {s.mode === 'weekly' && (
        <div role="group" aria-labelledby="away-days-h">
          <p id="away-days-h" className="hint">Closed on</p>
          <div className="chips">
            {DAYS.map(([d, short, long]) => (
              <button key={d} type="button" className="chip-btn" aria-pressed={s.days.includes(d)} aria-label={long} onClick={() => toggleDay(d)}>{short}</button>
            ))}
          </div>
        </div>
      )}
      {s.mode === 'daily' && (
        <>
          <label htmlFor="away-from">Closes at</label>
          <input id="away-from" type="time" value={s.from} onChange={(e) => setSch({ from: e.target.value })} />
          <label htmlFor="away-to">Reopens at</label>
          <input id="away-to" type="time" value={s.to} onChange={(e) => setSch({ to: e.target.value })} />
        </>
      )}

      <p id="away-summary" className={bad ? 'error' : 'hint'} role={problems.schedule && bad ? 'alert' : undefined} aria-live={problems.schedule && bad ? undefined : 'polite'}>
        {summary(s)}
      </p>
      <p className="hint">Times use {saved.zone}, the time zone in the saving Admin’s Preferences.</p>

      {problems.form && (
        <p role="alert" className="error">
          {problems.form}
          {problems.stale && <> <button type="button" className="link" onClick={() => { setState('loading'); void load(); }}>Reload</button></>}
        </p>
      )}
      <div className="actions foot">
        <button type="submit" className="btn primary" disabled={saving || !dirty}>Save away message</button>
      </div>
    </form>
  );
}
