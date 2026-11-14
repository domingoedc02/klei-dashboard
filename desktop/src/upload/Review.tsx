import { useCallback, useEffect, useRef, useState } from 'react';
import type { components } from '../api/schema';
import { fullUrl, thumbUrl } from '../platform';
import { forgetGallery } from '../gallery/memory';
import { useShell } from '../shell/context';
import { Icon } from '../shell/icons';
import { Lightbox } from '../shell/Lightbox';
import { setLeaveGuard } from '../shell/route';
import { ErrorBlock, Skeleton } from '../shell/ui';
import { GroupCombobox } from './GroupCombobox';

type Group = components['schemas']['GroupView'];
type Tag = { type: string; value: string };
type Taxonomy = { groups: { type: string; values: { id: string; value: string }[] }[] };
type Op =
  | { kind: 'move'; photos: string[]; to: string }
  | { kind: 'split'; photos: string[] }
  | { kind: 'merge'; from: string; into: string }
  | { kind: 'discard'; photos: string[] };
/** A group as the screen holds it. `loaded` ones came from the server with their `version`; the others were made here by Move or Split. */
type Staged = { id: string; loaded: boolean; version?: number; name: string; tags: Tag[]; description: string; photoIds: string[]; confidence: number; band: string };
type Draft = { groups: Staged[]; discarded: string[]; selected?: string };
/** `past` is the undo stack (local only); `typing` is the field being typed in, so one run of keystrokes is one undo step. */
type History = { cur: Draft; past: Draft[]; typing: string | null };

const BATCHES = '/api/v1/uploads';
const BAND: Record<string, [label: string, tone: string]> = { high: ['High', 'pos'], medium: ['Medium', 'neutral'], low: ['Low · check', 'warn'] };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const photosIn = (gs: Staged[]) => gs.reduce((n, g) => n + g.photoIds.length, 0);
const meta = (g: Staged) =>
  [plural(g.photoIds.length, 'photo', 'photos'), ...['silhouette', 'fabric'].map((t) => g.tags.filter((x) => x.type === t).map((x) => x.value).join(', ')).filter(Boolean)].join(' · ');

const start = (groups: Group[]): History => ({
  cur: {
    groups: groups.map((g) => ({
      id: g.id ?? '', loaded: true, version: g.version, name: g.name ?? '', tags: (g.tags ?? []) as Tag[],
      description: g.description ?? '', photoIds: g.photoIds ?? [], confidence: g.confidence ?? 0, band: g.band ?? 'low',
    })),
    discarded: [],
    selected: groups[0]?.id,
  },
  past: [],
  typing: null,
});

const splitName = (name: string) => `${name.slice(0, 77)} II`;

const made = (name: string, photos: string[], from: Staged): Staged => ({
  id: crypto.randomUUID(), loaded: false, name, tags: from.tags, description: from.description, photoIds: photos, confidence: 70, band: 'low',
});

/** The staged edit of Story 11.6: pure, so Undo is a pop. A group left without photos goes; the second value is the toast. */
function apply(s: Draft, op: Op): [Draft, string] {
  const done = (groups: Staged[], selected: string | undefined, discarded = s.discarded): Draft => {
    const kept = groups.filter((g) => g.photoIds.length > 0);
    return { groups: kept, discarded, selected: kept.some((g) => g.id === selected) ? selected : kept[0]?.id };
  };
  if (op.kind === 'merge') {
    const from = s.groups.find((g) => g.id === op.from)!;
    const into = s.groups.find((g) => g.id === op.into)!;
    const groups = s.groups.filter((g) => g !== from).map((g) => (g === into ? { ...g, photoIds: [...g.photoIds, ...from.photoIds] } : g));
    return [done(groups, into.id), `Merged into ${into.name}`];
  }
  const src = s.groups.find((g) => g.photoIds.includes(op.photos[0]))!;
  const rest = s.groups.map((g) => (g === src ? { ...g, photoIds: g.photoIds.filter((p) => !op.photos.includes(p)) } : g));
  if (op.kind === 'discard') return [done(rest, s.selected, [...s.discarded, ...op.photos]), op.photos.length === 1 ? 'Photo discarded' : `${op.photos.length} photos discarded`];
  if (op.kind === 'split') {
    const born = made(splitName(src.name), op.photos, src);
    return [done(rest.flatMap((g) => (g.id === src.id ? [g, born] : [g])), born.id), 'Split into a new gown. Check its tags.'];
  }
  const to = rest.find((g) => g.id === op.to)!;
  return [done(rest.map((g) => (g === to ? { ...g, photoIds: [...g.photoIds, ...op.photos] } : g)), s.selected), `Moved ${plural(op.photos.length, 'photo', 'photos')} to ${to.name}`];
}

/**
 * U1 review (FR-10, FR-11, FR-12): the groups on the left, one editor on the right. Every edit stays in this component until
 * Confirm and save sends it as one request; Undo steps back through a local stack. A reload or a crash loses the edits, so a leave
 * guard asks first (Story 11.6).
 */
export function Review({ batchId, groups: first, onReload }: { batchId: string; groups: Group[]; onReload: () => void }) {
  const { request, toast, openDialog, setDirty } = useShell();
  const [h, setH] = useState<History>(() => start(first));
  const [busy, setBusy] = useState<'save' | 'discard' | 'rewrite' | null>(null);
  const [problem, setProblem] = useState<'stale' | 'failed' | null>(null);
  const [taxonomy, setTaxonomy] = useState<Taxonomy | 'loading' | 'failed'>('loading');
  const { cur } = h;
  const dirty = h.past.length > 0;
  const group = cur.groups.find((g) => g.id === cur.selected) ?? cur.groups[0];
  const uploaded = first.reduce((n, g) => n + (g.photoIds?.length ?? 0), 0);

  const loadTaxonomy = useCallback(async () => {
    setTaxonomy('loading');
    const r = await request<Taxonomy>('GET', '/api/v1/taxonomy');
    setTaxonomy(r.status === 200 && r.body?.groups ? r.body : 'failed');
  }, [request]);
  useEffect(() => void loadTaxonomy(), [loadTaxonomy]);

  const setDirtyRef = useRef(setDirty);
  setDirtyRef.current = setDirty;
  useEffect(() => {
    setDirtyRef.current(dirty);
    return () => setDirtyRef.current(false);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    setLeaveGuard((leave) =>
      openDialog({ title: 'Leave without saving?', body: 'Your changes to this batch will be lost.', cancel: 'Keep reviewing', confirm: { label: 'Leave', danger: true, run: leave } }),
    );
    const unload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', unload);
    return () => {
      setLeaveGuard(null);
      window.removeEventListener('beforeunload', unload);
    };
  }, [dirty, openDialog]);

  const stage = (op: Op) => {
    const [next, text] = apply(cur, op);
    setH({ cur: next, past: [...h.past, cur], typing: null });
    toast(text);
  };
  const edit = (id: string, patch: Partial<Staged>, typing?: string) =>
    setH((p) => ({
      cur: { ...p.cur, groups: p.cur.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) },
      past: typing && typing === p.typing ? p.past : [...p.past, p.cur],
      typing: typing ?? null,
    }));
  const undo = () => {
    setH((p) => {
      const prev = p.past[p.past.length - 1];
      if (!prev) return p;
      return { cur: prev, past: p.past.slice(0, -1), typing: null };
    });
    toast('Undone');
  };
  const select = (id: string) => setH((p) => ({ ...p, cur: { ...p.cur, selected: id }, typing: null }));

  const confirm = async () => {
    setBusy('save');
    setProblem(null);
    try {
      const body: components['schemas']['CommitBody'] = {
        groups: cur.groups.map((g) => ({ ...(g.loaded ? { id: g.id, version: g.version } : {}), name: g.name, attributes: g.tags, description: g.description, photoIds: g.photoIds })),
        removed: first.filter((f) => !cur.groups.some((g) => g.id === f.id)).map((f) => ({ id: f.id, version: f.version })),
        discarded: cur.discarded,
      };
      let r: { status: number; body?: { saved?: number; fields?: { field: string; code: string }[] } | null };
      try {
        r = await request<{ saved?: number; fields?: { field: string; code: string }[] }>('POST', `${BATCHES}/${batchId}/commit`, body);
      } catch {
        r = { status: 0 };
      }
      if (r.status === 200) {
        forgetGallery();
        toast(`${plural(r.body?.saved ?? cur.groups.length, 'gown', 'gowns')} saved to Gallery`);
        onReload();
      } else if (r.status === 422) {
        const bad = /^groups\[(\d+)\]\./.exec(r.body?.fields?.[0]?.field ?? '');
        const hit = bad ? cur.groups[Number(bad[1])] : undefined;
        if (hit) select(hit.id);
        toast(r.body?.fields?.[0]?.field.endsWith('.attributes') ? 'A tag is no longer in the tag taxonomy. Remove it to save.' : 'Every gown needs a name before it can be saved.', 'error');
      } else setProblem(r.status === 404 || r.status === 409 ? 'stale' : 'failed');
    } finally {
      setBusy(null);
    }
  };

  const rewrite = async (g: Staged) => {
    setBusy('rewrite');
    try {
      let r: { status: number; body?: { description?: string } | null };
      try {
        r = await request<{ description?: string }>('POST', `${BATCHES}/${batchId}/groups/${g.id}/rewrite`, { photoIds: g.photoIds });
      } catch {
        r = { status: 0 };
      }
      if (r.status === 200 && r.body?.description) edit(g.id, { description: r.body.description });
      else toast("Couldn't rewrite. Try again.", 'error');
    } finally {
      setBusy(null);
    }
  };

  const discardAll = () =>
    openDialog({
      title: 'Discard this batch?',
      body: `The ${plural(uploaded, 'uploaded photo', 'uploaded photos')} and every AI group will be removed. This can’t be undone.`,
      cancel: 'Keep reviewing',
      confirm: {
        label: 'Discard batch',
        danger: true,
        run: async () => {
          setBusy('discard');
          try {
            const r = await request('DELETE', `${BATCHES}/${batchId}`);
            if (r.status === 204 || r.status === 404) {
              toast('Batch discarded');
              onReload();
            } else toast("Couldn't discard the batch. Try again.", 'error');
          } catch {
            toast("Couldn't discard the batch. Try again.", 'error');
          } finally {
            setBusy(null);
          }
        },
      },
    });

  const live = photosIn(cur.groups);
  const low = cur.groups.filter((g) => g.band === 'low').length;
  const locked = busy !== null;

  return (
    <div className="review">
      <div className="banner">
        <Icon name="spark" />
        <span>
          <b>{plural(live, 'photo', 'photos')} → {plural(cur.groups.length, 'gown', 'gowns')}.</b>{' '}
          {low ? `${plural(low, 'group', 'groups')} with low confidence, worth a look.` : 'All groups look confident.'} Nothing is saved until you confirm.
        </span>
      </div>
      <div className="rv">
        <div className="rv-side">
          <h2>Gown groups</h2>
          <ul className="rv-list" aria-label="Groups">
            {cur.groups.map((g) => {
              const [label, tone] = BAND[g.band] ?? BAND.low;
              return (
                <li key={g.id}>
                  <button type="button" className="gl" aria-current={g.id === group?.id ? 'true' : undefined} onClick={() => select(g.id)}>
                    <span className="gl-top">
                      <span className="name">{g.name}</span>
                      <span className={`pill ${tone}`} title={`${g.confidence}% confidence`}>{label}</span>
                    </span>
                    <span className="strip" aria-hidden="true">
                      {g.photoIds.slice(0, 5).map((p) => <img key={p} src={thumbUrl(batchId, p)} alt="" width={40} height={53} loading="lazy" />)}
                    </span>
                    <span className="gl-meta">{meta(g)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        {group ? (
          <Editor
            key={group.id} batchId={batchId} group={group} others={cur.groups.filter((g) => g.id !== group.id)} taxonomy={taxonomy}
            onRetryTaxonomy={() => void loadTaxonomy()} onEdit={(patch, typing) => edit(group.id, patch, typing)} onOp={stage}
            onRewrite={() => void rewrite(group)} rewriting={busy === 'rewrite'} locked={locked}
          />
        ) : <p className="hint">No photos left. Undo the last change or discard the batch.</p>}
      </div>
      {problem && (
        <p role="alert" className="error">
          {problem === 'stale' ? 'This batch changed elsewhere. Reload to see the latest.' : "Couldn't save. Try again."}
          {problem === 'stale' && <> <button type="button" className="link" onClick={onReload}>Reload</button></>}
        </p>
      )}
      <div className="savebar">
        <span className="hint">{plural(cur.groups.length, 'gown', 'gowns')} · {plural(live, 'photo', 'photos')} will be added to Gallery</span>
        <div className="actions">
          <button type="button" className="btn" disabled={!dirty || locked} onClick={undo}>Undo</button>
          <button type="button" className="btn" disabled={locked} onClick={discardAll}>Discard batch</button>
          <button type="button" className="btn primary" disabled={locked || cur.groups.length === 0} aria-busy={busy === 'save'} onClick={() => void confirm()}>
            {busy === 'save' && <span className="spinner" aria-hidden="true" />}
            {busy === 'save' ? 'Saving…' : `Confirm and save ${plural(cur.groups.length, 'gown', 'gowns')}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The editor holds no text of its own: every change goes up as a staged edit, and nothing is sent until Confirm and save. */
function Editor({ batchId, group, others, taxonomy, onRetryTaxonomy, onEdit, onOp, onRewrite, rewriting, locked }: {
  batchId: string; group: Staged; others: Staged[]; taxonomy: Taxonomy | 'loading' | 'failed'; onRetryTaxonomy: () => void;
  onEdit: (patch: Partial<Staged>, typing?: string) => void; onOp: (op: Op) => void; onRewrite: () => void; rewriting: boolean; locked: boolean;
}) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [mvto, setMvto] = useState('');
  const [mgto, setMgto] = useState('');
  const opener = useRef<HTMLElement | null>(null);
  const photos = group.photoIds;
  const picked = photos.filter((p) => sel.includes(p));
  const n = picked.length;
  const target = (id: string) => (others.some((o) => o.id === id) ? id : '');
  const [label, tone] = BAND[group.band] ?? BAND.low;
  const run = (op: Op) => {
    onOp(op);
    setSel([]);
    setMvto('');
    setMgto('');
    // The pressed button disables and Merge/Split remount the editor: park focus on the photos heading so the keyboard keeps its place.
    setTimeout(() => document.getElementById('g-photos')?.focus(), 0);
  };
  const toggle = (p: string) => setSel((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));
  const gowns = (value: string, set: (v: string) => void, id: string) => (
    <GroupCombobox
      id={id} describedBy={`${id}-h`} value={target(value)} disabled={others.length === 0} onChange={set}
      placeholder={others.length ? 'Choose a gown…' : 'No other gowns yet'}
      options={others.map((o) => ({ id: o.id, name: o.name, count: o.photoIds.length }))}
    />
  );

  return (
    <div className="editor form">
      <div className="editor-head">
        <div className="field">
          <label htmlFor="g-name">Gown name <span className="hint">(auto-named, editable)</span></label>
          <input id="g-name" value={group.name} maxLength={80} onChange={(e) => onEdit({ name: e.target.value }, `name:${group.id}`)} />
        </div>
        <div className="conf">
          <span>Confidence {group.confidence}%</span>
          <div className={group.confidence < 80 ? 'meter gray' : 'meter'} role="img" aria-label={`AI confidence ${group.confidence} percent, ${label}`}>
            <i style={{ width: `${group.confidence}%` }} />
          </div>
          <span className={`pill ${tone}`}>{label}</span>
        </div>
      </div>

      <div>
        <div className="sec-head">
          <h3 id="g-photos" tabIndex={-1}>Photos in this group ({photos.length})</h3>
          <span className="hint">Select photos to move or split</span>
        </div>
        <ul className="thumbs" aria-labelledby="g-photos">
          {photos.map((p, i) => (
            <li key={p} className="th-cell">
              <button type="button" className="th" aria-pressed={sel.includes(p)} aria-label={`Photo ${i + 1}`} onClick={() => toggle(p)}>
                <img src={thumbUrl(batchId, p)} alt="" width={96} height={128} loading="lazy" />
                <span className="tick" aria-hidden="true">{sel.includes(p) && <Icon name="check" />}</span>
              </button>
              <button type="button" className="th-open" aria-label={`Open photo ${i + 1} of ${photos.length}`} onClick={(e) => { opener.current = e.currentTarget; setLightbox(i); }}>
                <Icon name="eye" />
              </button>
            </li>
          ))}
        </ul>
        <span className="sr-only" aria-live="polite">{n ? `${plural(n, 'photo', 'photos')} selected.` : ''}</span>
        <div className="org" role="group" aria-label="Organize this group">
          <div className="org-row">
            <label className="lbl" htmlFor="mvto">Move selected photos to</label>
            <span className="help" id="mvto-h">{n ? `${plural(n, 'photo', 'photos')} selected. Choose a gown.` : 'Select photos above first, then choose a gown.'}</span>
            <div className="org-ctl">
              {gowns(mvto, setMvto, 'mvto')}
              <button type="button" className="btn" disabled={locked || !n || !target(mvto)} onClick={() => run({ kind: 'move', photos: picked, to: target(mvto) })}>
                <Icon name="move" />Move{n ? ` ${n}` : ''}
              </button>
            </div>
          </div>
          <div className="org-row">
            <label className="lbl" htmlFor="mgto">Merge this whole gown into</label>
            <span className="help" id="mgto-h">Moves all {plural(photos.length, 'photo', 'photos')} into the gown you pick and removes this group.</span>
            <div className="org-ctl">
              {gowns(mgto, setMgto, 'mgto')}
              <button type="button" className="btn" disabled={locked || !target(mgto)} onClick={() => run({ kind: 'merge', from: group.id, into: target(mgto) })}>
                <Icon name="merge" />Merge
              </button>
            </div>
          </div>
          <div className="org-row">
            <span className="lbl">Split selected photos into a new gown</span>
            <span className="help" id="split-h">
              {n >= photos.length ? 'Leave at least one photo in this gown.' : n ? `Creates “${splitName(group.name)}” from the ${n} selected.` : 'Select photos above first. They become a separate gown.'}
            </span>
            <div className="org-actions">
              <button type="button" className="btn" aria-describedby="split-h" disabled={locked || !n || n >= photos.length} onClick={() => run({ kind: 'split', photos: picked })}>
                <Icon name="split" />Split into new gown
              </button>
              <button type="button" className="btn" disabled={locked || !n} onClick={() => run({ kind: 'discard', photos: picked })}>
                <Icon name="trash" />Discard selected
              </button>
            </div>
          </div>
        </div>
      </div>

      {taxonomy === 'loading' && <Skeleton rows={2} height={40} />}
      {taxonomy === 'failed' && <ErrorBlock what="tag taxonomy" onRetry={onRetryTaxonomy} />}
      {typeof taxonomy === 'object' && (
        <div className="tags-grid">
          {taxonomy.groups.map((t) => {
            const mine = group.tags.filter((x) => x.type === t.type);
            const left = t.values.filter((v) => !mine.some((x) => x.value === v.value));
            const name = cap(t.type);
            return (
              <div key={t.type} className="tagfield">
                <label htmlFor={`g-${t.type}`}>{name}</label>
                <ul className="chips" aria-label={`${name} tags`}>
                  {mine.map((x) => (
                    <li key={x.value} className="chip">
                      {x.value}
                      <button type="button" aria-label={`Remove ${x.value} from ${name}`} onClick={() => onEdit({ tags: group.tags.filter((y) => y !== x) })}>×</button>
                    </li>
                  ))}
                </ul>
                <select id={`g-${t.type}`} value="" disabled={left.length === 0} onChange={(e) => e.target.value && onEdit({ tags: [...group.tags, { type: t.type, value: e.target.value }] })}>
                  <option value="">{left.length ? 'Add…' : 'All added'}</option>
                  {left.map((v) => <option key={v.id} value={v.value}>{v.value}</option>)}
                </select>
              </div>
            );
          })}
        </div>
      )}

      <div className="desc-head">
        <label htmlFor="g-desc">AI-written description</label>
        <button type="button" className="btn ghost" disabled={rewriting} aria-busy={rewriting} onClick={onRewrite}>
          {rewriting ? <span className="spinner" aria-hidden="true" /> : <Icon name="spark" />}
          {rewriting ? 'Rewriting…' : 'Rewrite'}
        </button>
      </div>
      <textarea id="g-desc" rows={5} value={group.description} maxLength={2000} onChange={(e) => onEdit({ description: e.target.value }, `desc:${group.id}`)} />

      <p className="hint">Edit freely. Your changes are kept when you save.</p>
      <p className="hint" aria-live="off">{group.description.length.toLocaleString('en-US')} / 2,000</p>

      {lightbox !== null && photos[lightbox] && (
        <Lightbox src={fullUrl(batchId, photos[lightbox])} index={lightbox} total={photos.length} onMove={(d) => setLightbox((i) => (i === null ? i : i + d))} onClose={() => { setLightbox(null); opener.current?.focus(); }} />
      )}
    </div>
  );
}
