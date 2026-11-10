import { useCallback, useEffect, useRef, useState } from 'react';
import type { components } from '../api/schema';
import { useShell } from '../shell/context';
import { ErrorBlock, Skeleton } from '../shell/ui';

type Item = Required<components['schemas']['TaxonomyItem']>;
type View = { groups: { type: string; values: Item[] }[] };
type Fail = { fields?: { field: string; code: string }[]; extensions?: { usedBy?: number } };

const TITLES: Record<string, string> = { silhouette: 'Silhouette', fabric: 'Fabric', neckline: 'Neckline', sleeve: 'Sleeve', train: 'Train' };
const MESSAGES: Record<string, string> = {
  required: 'Enter a name.',
  duplicate: 'That tag already exists.',
  too_long: 'Use 60 characters or fewer.',
  invalid: 'Check this value.',
};

/** Tag taxonomy cards (S7). Adds and removes save at once; they do not wait for the AI settings Save bar. */
export function TaxonomyCards() {
  const shell = useShell();
  const { toast, openDialog } = shell;
  const req = useRef(shell.request);
  req.current = shell.request;
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [view, setView] = useState<View | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await req.current<View>('GET', '/api/v1/taxonomy');
      if (r.status === 200 && r.body && (r.body as View).groups) { setView(r.body as View); setState('ready'); return; }
    } catch { /* the shell already raised the offline banner or the expiry */ }
    setState((cur) => (cur === 'ready' ? cur : 'error'));
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (state === 'loading') return <Skeleton rows={3} height={44} />;
  if (state === 'error' || !view) return <ErrorBlock what="tag taxonomy" onRetry={() => { setState('loading'); void load(); }} />;

  const send = async (type: string, body: object, version: number | undefined, done: string) => {
    setBusy(true);
    setProblems((p) => ({ ...p, [type]: '' }));
    try {
      const r = await req.current<View | Fail>('PUT', '/api/v1/taxonomy', body, version);
      if (r.status === 200 && r.body) { setView(r.body as View); toast(done); return true; }
      const fail = (r.body ?? {}) as Fail;
      if (r.status === 409 && fail.extensions?.usedBy !== undefined) {
        const n = fail.extensions.usedBy;
        openDialog({
          title: 'Tag in use',
          custom: (close) => (
            <>
              <p className="lede">Used by {n} gowns. Reassign them first.</p>
              <div className="actions"><button type="button" className="btn primary" onClick={close}>OK</button></div>
            </>
          ),
        });
      } else if (r.status === 409) {
        toast('Tags changed elsewhere. The list was reloaded.', 'error');
        void load();
      } else if (r.status === 422) {
        const code = fail.fields?.[0]?.code ?? 'invalid';
        setProblems((p) => ({ ...p, [type]: MESSAGES[code] ?? MESSAGES.invalid }));
      } else setProblems((p) => ({ ...p, [type]: "Couldn't save. Try again." }));
    } catch {
      setProblems((p) => ({ ...p, [type]: "Couldn't reach the server. Try again." }));
    } finally {
      setBusy(false);
    }
    return false;
  };

  const add = async (type: string) => {
    const value = (drafts[type] ?? '').trim();
    if (!value || busy) return;
    if (await send(type, { op: 'add', type, value }, undefined, `Added ${value}`)) setDrafts((d) => ({ ...d, [type]: '' }));
  };
  const remove = (item: Item) => void send(item.type, { op: 'remove', id: item.id }, item.version, `Removed ${item.value}`);

  return (
    <>
      <h2>Tag taxonomy</h2>
      <p className="hint">Tags the AI may choose from, and staff pick in the Gallery. Changes here save at once.</p>
      <div className="taxonomy">
        {view.groups.map((g) => {
          const title = TITLES[g.type] ?? g.type;
          const err = problems[g.type];
          return (
            <section key={g.type} className="card" aria-labelledby={`tax-${g.type}`}>
              <h3 id={`tax-${g.type}`}>{title}</h3>
              <ul className="chips" aria-label={`${title} tags`}>
                {g.values.map((v) => (
                  <li key={v.id} className="chip">
                    <span>{v.value}</span>
                    <button type="button" aria-label={`Remove ${v.value}`} disabled={busy} onClick={() => remove(v)}>×</button>
                  </li>
                ))}
              </ul>
              <div className="keyrow">
                <input
                  value={drafts[g.type] ?? ''} placeholder="Add a tag" aria-label={`Add ${title} tag`} autoComplete="off"
                  aria-invalid={!!err} aria-describedby={err ? `tax-${g.type}-err` : undefined}
                  onChange={(e) => setDrafts((d) => ({ ...d, [g.type]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add(g.type); } }}
                />
                <button type="button" className="btn" aria-label={`Add to ${title}`} disabled={busy || !(drafts[g.type] ?? '').trim()} onClick={() => void add(g.type)}>Add</button>
              </div>
              {err && <p id={`tax-${g.type}-err`} className="error">{err}</p>}
            </section>
          );
        })}
      </div>
    </>
  );
}
