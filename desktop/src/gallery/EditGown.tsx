import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { components } from '../api/schema';
import { useShell } from '../shell/context';
import { ErrorBlock, Skeleton } from '../shell/ui';
import { forgetGallery } from './memory';

type Detail = components['schemas']['GownDetail'];
type Tag = { type: string; value: string };
type Groups = { type: string; values: { id: string; value: string }[] }[];
type Fail = { fields?: { field: string; code: string }[] };
type Save = 'idle' | 'saving' | 'stale' | 'error';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const key = (t: Tag[]) => t.map((x) => `${x.type}:${x.value}`).sort().join('|');

const PROBLEMS: Record<string, string> = {
  'name:required': 'Name is required',
  'name:too_long': 'Name can be up to 80 characters.',
  'description:too_long': 'Description can be up to 2,000 characters.',
  'attributes:invalid': 'A tag is no longer in the tag taxonomy. Remove it to save.',
};

/** G2 (FR-16): the Edit dialog body. Saves with the version the viewer read; a 409 keeps the typed text until the person reloads. */
export function EditGown({ gown, close, onSaved, onReload }: { gown: Detail; close: () => void; onSaved: (g: Detail) => void; onReload: () => void }) {
  const shell = useShell();
  const req = useRef(shell.request);
  req.current = shell.request;
  const dirtyFlag = useRef(shell.setDirty);
  dirtyFlag.current = shell.setDirty;

  const first = useRef({
    name: gown.name ?? '',
    description: gown.description ?? '',
    tags: (gown.attributes ?? []).flatMap((a) => (a.values ?? []).map((value) => ({ type: a.type ?? '', value }))),
  }).current;

  const [name, setName] = useState(first.name);
  const [description, setDescription] = useState(first.description);
  const [tags, setTags] = useState<Tag[]>(first.tags);
  const [groups, setGroups] = useState<Groups | 'loading' | 'failed'>('loading');
  const [tries, setTries] = useState(0);
  const [state, setState] = useState<Save>('idle');
  const [problem, setProblem] = useState('');
  const [asking, setAsking] = useState(false);
  const nameBox = useRef<HTMLInputElement>(null);
  const keep = useRef<HTMLButtonElement>(null);

  const dirty = name !== first.name || description !== first.description || key(tags) !== key(first.tags);

  useEffect(() => {
    dirtyFlag.current(dirty);
  }, [dirty]);
  useEffect(() => () => dirtyFlag.current(false), []);
  useEffect(() => { if (asking) keep.current?.focus(); }, [asking]);

  useEffect(() => {
    let live = true;
    setGroups('loading');
    req.current<{ groups?: Groups }>('GET', '/api/v1/taxonomy').then(
      (r) => { if (live) setGroups(r.status === 200 && r.body?.groups ? r.body.groups : 'failed'); },
      () => { if (live) setGroups('failed'); },
    );
    return () => { live = false; };
  }, [tries]);

  const leave = () => (dirty ? setAsking(true) : close());
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation(); // the shell would close the dialog and drop the edits
    if (asking) setAsking(false);
    else leave();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (state === 'saving') return;
    if (!name.trim()) { setProblem('name:required'); nameBox.current?.focus(); return; }
    setState('saving');
    setProblem('');
    try {
      const r = await req.current<Detail & Fail>('PATCH', `/api/v1/gowns/${gown.id}`, { name, attributes: tags, description }, gown.version ?? 0);
      if (r.status === 200 && r.body) {
        forgetGallery();
        shell.toast('Gown updated');
        onSaved(r.body);
        close();
      } else if (r.status === 409) setState('stale');
      else if (r.status === 404) { shell.toast('This gown no longer exists.', 'error'); close(); onReload(); }
      else if (r.status === 422) {
        const f = (r.body as Fail | null)?.fields?.[0];
        setProblem(f ? `${f.field}:${f.code}` : 'save');
        setState('idle');
      } else setState('error');
    } catch { setState('error'); /* the shell already raised the offline banner or the expiry */ }
  };

  if (asking) {
    return (
      <div onKeyDown={onKey}>
        <h3>Discard changes?</h3>
        <p className="lede">Your edits to this gown will be lost.</p>
        <div className="actions">
          <button ref={keep} type="button" className="btn" onClick={() => setAsking(false)}>Keep editing</button>
          <button type="button" className="btn danger" onClick={close}>Discard</button>
        </div>
      </div>
    );
  }

  const note = state === 'error' ? "Couldn't save. Your changes are kept here." : PROBLEMS[problem] ?? (problem ? "Couldn't save this change." : '');

  return (
    <form className="form editor" onSubmit={(e) => void submit(e)} onKeyDown={onKey} noValidate>
      <label htmlFor="eg-name">Name</label>
      <input ref={nameBox} id="eg-name" value={name} maxLength={80} aria-invalid={problem.startsWith('name') || undefined} onChange={(e) => setName(e.target.value)} />

      {groups === 'loading' && <Skeleton rows={2} height={40} />}
      {groups === 'failed' && <ErrorBlock what="tag taxonomy" onRetry={() => setTries(tries + 1)} />}
      {Array.isArray(groups) && groups.map((t) => {
        const mine = tags.filter((x) => x.type === t.type);
        const left = t.values.filter((v) => !mine.some((x) => x.value === v.value));
        const label = cap(t.type);
        return (
          <div key={t.type} className="tagfield">
            <label htmlFor={`eg-${t.type}`}>{label}</label>
            <ul className="chips" aria-label={`${label} tags`}>
              {mine.map((x) => (
                <li key={x.value} className="chip">
                  {x.value}
                  <button type="button" aria-label={`Remove ${x.value} from ${label}`} onClick={() => setTags(tags.filter((y) => y !== x))}>×</button>
                </li>
              ))}
            </ul>
            <select id={`eg-${t.type}`} value="" disabled={left.length === 0} onChange={(e) => e.target.value && setTags([...tags, { type: t.type, value: e.target.value }])}>
              <option value="">{left.length ? 'Add…' : 'All added'}</option>
              {left.map((v) => <option key={v.id} value={v.value}>{v.value}</option>)}
            </select>
          </div>
        );
      })}

      <label htmlFor="eg-desc">Description</label>
      <textarea id="eg-desc" rows={5} value={description} maxLength={2000} aria-invalid={problem.startsWith('description') || undefined} onChange={(e) => setDescription(e.target.value)} />
      <p className="hint" aria-live="off">{description.length.toLocaleString('en-US')} / 2,000</p>

      <div role="status">
        {state === 'stale' ? (
          <p className="error">
            This gown changed while you were editing. Reload to see the latest.{' '}
            <button type="button" className="link" onClick={() => { close(); onReload(); }}>Reload</button>
          </p>
        ) : note && <p className="error">{note}</p>}
      </div>

      <div className="actions">
        <button type="button" className="btn" onClick={leave}>Cancel</button>
        <button type="submit" className="btn primary" disabled={state === 'saving' || state === 'stale'}>{state === 'saving' ? 'Saving…' : 'Save changes'}</button>
      </div>
    </form>
  );
}
