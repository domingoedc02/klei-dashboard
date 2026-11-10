import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { components } from '../api/schema';
import { useShell } from '../shell/context';

type Client = components['schemas']['ClientDetail'];
type Fail = { fields?: { field: string; code: string }[] };
type Save = 'idle' | 'saving' | 'stale' | 'error';

export const SOURCES = ['Website', 'Instagram', 'Referral', 'Event', 'Other'];

const PROBLEMS: Record<string, string> = {
  'phone:too_long': 'Phone can be up to 40 characters.',
  'phone:invalid': 'Phone must be on one line.',
  'city:too_long': 'City can be up to 80 characters.',
  'city:invalid': 'City must be on one line.',
  'weddingDate:invalid': 'Enter a real date.',
  'source:invalid': 'Pick an answer from the list.',
  'note:too_long': 'Notes can be up to 2,000 characters.',
};

/** I2 (FR-23): the Edit dialog body. Name and email are the Customer's identity here and stay read-only. */
export function EditClient({ client, close, onSaved, onReload }: { client: Client; close: () => void; onSaved: (c: Client) => void; onReload: () => void }) {
  const shell = useShell();
  const req = useRef(shell.request);
  req.current = shell.request;
  const dirtyFlag = useRef(shell.setDirty);
  dirtyFlag.current = shell.setDirty;

  const first = useRef({
    phone: client.phone ?? '', city: client.city ?? '', weddingDate: client.weddingDate ?? '', source: client.source ?? '', note: client.note ?? '',
  }).current;
  const [f, setF] = useState(first);
  const [state, setState] = useState<Save>('idle');
  const [problem, setProblem] = useState('');
  const dirty = (Object.keys(first) as (keyof typeof first)[]).some((k) => f[k] !== first[k]);
  const set = (k: keyof typeof first) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  useEffect(() => { dirtyFlag.current(dirty); }, [dirty]);
  useEffect(() => () => dirtyFlag.current(false), []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (state === 'saving') return;
    setState('saving');
    setProblem('');
    try {
      const r = await req.current<Client & Fail>('PATCH', `/api/v1/clients/${client.id}`, f, client.version ?? 0);
      if (r.status === 200 && r.body) {
        shell.toast('Customer updated');
        onSaved(r.body);
        close();
      } else if (r.status === 409) setState('stale');
      else if (r.status === 404) { shell.toast('This customer no longer exists.', 'error'); close(); onReload(); }
      else if (r.status === 422) {
        const p = (r.body as Fail | null)?.fields?.[0];
        setProblem(p ? `${p.field}:${p.code}` : 'save');
        setState('idle');
      } else setState('error');
    } catch { setState('error'); /* the shell already raised the offline banner or the expiry */ }
  };

  const field = problem.split(':')[0];
  const note = state === 'error' ? "Couldn't save. Your changes are kept here." : PROBLEMS[problem] ?? (problem ? "Couldn't save this change." : '');

  return (
    <form className="form editor" onSubmit={(e) => void submit(e)} noValidate>
      <p className="lede">{client.name} · {client.email}</p>

      <label htmlFor="ec-phone">Phone</label>
      <input id="ec-phone" value={f.phone} maxLength={40} aria-invalid={field === 'phone' || undefined} onChange={set('phone')} />

      <label htmlFor="ec-city">City</label>
      <input id="ec-city" value={f.city} maxLength={80} aria-invalid={field === 'city' || undefined} onChange={set('city')} />

      <label htmlFor="ec-date">Wedding date</label>
      <input id="ec-date" type="date" value={f.weddingDate} aria-invalid={field === 'weddingDate' || undefined} onChange={set('weddingDate')} />

      <label htmlFor="ec-source">Heard about us</label>
      <select id="ec-source" value={f.source} aria-invalid={field === 'source' || undefined} onChange={set('source')}>
        <option value="">Not set</option>
        {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>

      <label htmlFor="ec-note">Notes</label>
      <textarea id="ec-note" rows={4} value={f.note} maxLength={2000} aria-invalid={field === 'note' || undefined} onChange={set('note')} />
      <p className="hint" aria-live="off">{f.note.length.toLocaleString('en-US')} / 2,000</p>

      <div role="status">
        {state === 'stale' ? (
          <p className="error">
            This customer changed while you were editing. Reload to see the latest.{' '}
            <button type="button" className="link" onClick={() => { close(); onReload(); }}>Reload</button>
          </p>
        ) : note && <p className="error">{note}</p>}
      </div>

      <div className="actions">
        {/* shortcut: Cancel drops edits without asking, five short fields; add the discard prompt of Edit gown if people lose notes. */}
        <button type="button" className="btn" onClick={close}>Cancel</button>
        <button type="submit" className="btn primary" disabled={state === 'saving' || state === 'stale'}>{state === 'saving' ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}
