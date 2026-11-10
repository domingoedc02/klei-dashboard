import { useCallback, useEffect, useRef, useState } from 'react';
import art from '../assets/empty/empty-gown-1.png';
import type { components } from '../api/schema';
import { formatDate } from '../format';
import { gownThumbUrl } from '../platform';
import { useShell } from '../shell/context';
import { Icon } from '../shell/icons';
import { ErrorBlock, Pill } from '../shell/ui';
import { DownloadStatus, useDownload } from './download';
import { deleteSpec, MAX_DELETE, removeGowns } from './remove';
import { NONE, recall, remember, type Card, type Filters, type Loaded } from './memory';

type Page = components['schemas']['GownPage'];
type Taxonomy = { groups: { type: string; values: { id: string; value: string }[] }[] };
type View = { status: 'loading' | 'error' } | ({ status: 'ready'; busy: boolean } & Loaded);

const PAGE = 48;
const DAYS: [number, string][] = [[0, 'All time'], [7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days']];

const added = formatDate;
const same = (a: Filters, b: Filters) => a.silhouette === b.silhouette && a.fabric === b.fabric && a.days === b.days;

export function Mosaic({ gown, ids }: { gown: string; ids: string[] }) {
  return (
    <div className="mosaic" data-n={ids.length}>
      {ids.map((p) => <img key={p} src={gownThumbUrl(gown, p)} alt="" loading="lazy" />)}
    </div>
  );
}

function GownCardView({ g, picked, toggle }: { g: Card; picked: boolean; toggle: () => void }) {
  const tags = [...g.silhouette, ...g.fabric].join(' · ');
  return (
    <li className="gown" data-picked={picked || undefined}>
      <label className="folder-chk"><input type="checkbox" aria-label={`Select ${g.name}`} checked={picked} onChange={toggle} /></label>
      {g.isNew && <span className="gown-new"><Pill tone="info">New</Pill></span>}
      <Mosaic gown={g.id} ids={g.thumbs} />
      <h2><a href={`#/gallery/${g.id}`}>{g.name}</a></h2>
      {tags && <p>{tags}</p>}
      <p>{g.photos} {g.photos === 1 ? 'photo' : 'photos'} · {added(g.addedAt)}</p>
    </li>
  );
}

export function Gallery() {
  const shell = useShell();
  const req = useRef(shell.request);
  req.current = shell.request;
  const toast = useRef(shell.toast);
  toast.current = shell.toast;
  const mine = shell.me.id ?? '';

  const saved = useRef(recall(mine)).current;
  const [filters, setFilters] = useState<Filters>(saved?.filters ?? NONE);
  const [view, setView] = useState<View>(saved ? { status: 'ready', busy: false, ...saved.loaded } : { status: 'loading' });
  const [taxonomy, setTaxonomy] = useState<Taxonomy['groups']>([]);
  const loadedFor = useRef<Filters | null>(saved?.filters ?? null);
  const turn = useRef(0);
  const download = useDownload();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const allBox = useRef<HTMLInputElement>(null);

  const fetchPage = useCallback(async (f: Filters, before: number | null): Promise<Page | null> => {
    try {
      const r = await req.current<Page>('POST', '/api/v1/gowns/query', {
        silhouette: f.silhouette ? [f.silhouette] : [], fabric: f.fabric ? [f.fabric] : [], days: f.days, before, limit: PAGE,
      });
      return r.status === 200 && r.body ? r.body : null;
    } catch { return null; /* the shell already raised the offline banner or the expiry */ }
  }, []);

  const first = useCallback(async (f: Filters) => {
    const mineTurn = ++turn.current;
    setView({ status: 'loading' });
    const p = await fetchPage(f, null);
    if (mineTurn !== turn.current) return;
    loadedFor.current = f;
    setView(p ? { status: 'ready', busy: false, items: (p.items ?? []) as Card[], next: p.next ?? null, total: p.total ?? 0, matching: p.matching ?? 0 } : { status: 'error' });
  }, [fetchPage]);

  useEffect(() => {
    if (loadedFor.current && same(loadedFor.current, filters) && view.status === 'ready') return;
    void first(filters);
  }, [filters, first]);

  useEffect(() => {
    if (view.status === 'ready') remember(mine, filters, { items: view.items, next: view.next, total: view.total, matching: view.matching });
  }, [view, filters, mine]);

  useEffect(() => {
    let live = true;
    void req.current<Taxonomy>('GET', '/api/v1/taxonomy').then((r) => { if (live && r.status === 200 && r.body?.groups) setTaxonomy(r.body.groups); }, () => undefined);
    return () => { live = false; };
  }, []);

  const more = async () => {
    if (view.status !== 'ready' || view.next === null || view.busy) return;
    const mineTurn = turn.current;
    setView({ ...view, busy: true });
    const p = await fetchPage(filters, view.next);
    if (mineTurn !== turn.current) return;
    if (!p) {
      toast.current("Couldn't load more gowns.", 'error');
      setView({ ...view, busy: false });
      return;
    }
    setView({ ...view, busy: false, items: [...view.items, ...((p.items ?? []) as Card[])], next: p.next ?? null, total: p.total ?? view.total, matching: p.matching ?? view.matching });
  };

  const values = (type: string) => taxonomy.find((g) => g.type === type)?.values ?? [];
  const active = !same(filters, NONE);
  const pick = (patch: Partial<Filters>) => { setPicked(new Set()); setFilters({ ...filters, ...patch }); };
  const clear = () => { setPicked(new Set()); setFilters(NONE); };
  const items = view.status === 'ready' ? view.items : [];
  const allPicked = items.length > 0 && items.every((g) => picked.has(g.id));
  useEffect(() => { if (allBox.current) allBox.current.indeterminate = picked.size > 0 && !allPicked; });
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (!n.delete(id)) n.add(id); return n; });
  const downloadPicked = async () => { if (await download.start([...picked])) setPicked(new Set()); };
  const deletePicked = () => {
    const ids = [...picked];
    if (ids.length > MAX_DELETE) { toast.current(`Delete up to ${MAX_DELETE} gowns at a time.`, 'error'); return; }
    const cards = view.status === 'ready' ? view.items.filter((g) => picked.has(g.id)) : [];
    shell.openDialog(deleteSpec(cards.map((g) => g.name), cards.reduce((n, g) => n + g.photos, 0), async () => {
      if (await removeGowns(shell, ids)) { setPicked(new Set()); void first(filters); }
    }));
  };

  return (
    <section className="gallery">
      <div className="gallery-head">
        <div>
          <h1>Gallery</h1>
          {view.status === 'ready' && view.total > 0 && <p className="count" aria-live="polite">{view.matching} of {view.total} gowns · latest upload first</p>}
        </div>
        {(view.status !== 'ready' || view.total > 0) && shell.can(['PERM_UPLOAD_IMAGES']) && <a className="btn primary" href="#/upload">Upload photos</a>}
      </div>
      <div className="filters" role="group" aria-label="Filters">
        <label>Silhouette
          <select value={filters.silhouette} onChange={(e) => pick({ silhouette: e.target.value })}>
            <option value="">All silhouettes</option>
            {values('silhouette').map((v) => <option key={v.id} value={v.id}>{v.value}</option>)}
          </select>
        </label>
        <label>Fabric
          <select value={filters.fabric} onChange={(e) => pick({ fabric: e.target.value })}>
            <option value="">All fabrics</option>
            {values('fabric').map((v) => <option key={v.id} value={v.id}>{v.value}</option>)}
          </select>
        </label>
        <label>Date added
          <select value={filters.days} onChange={(e) => pick({ days: Number(e.target.value) })}>
            {DAYS.map(([d, label]) => <option key={d} value={d}>{label}</option>)}
          </select>
        </label>
        {active && <button type="button" className="link" onClick={clear}>Clear filters</button>}
        <span className="sort-chip"><Icon name="clock" /> Latest upload first</span>
      </div>

      {view.status === 'loading' && (
        <ul className="grid" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => <li key={i} className="skeleton tall" />)}
        </ul>
      )}
      {view.status === 'error' && <ErrorBlock what="the gallery" onRetry={() => void first(filters)} />}
      {view.status === 'ready' && view.total === 0 && (
        <div className="empty">
          <img src={art} alt="" width={160} />
          <p className="lede">Your gallery is empty</p>
          <p className="sub">Saved gowns appear here as albums, newest first.</p>
          {shell.can(['PERM_UPLOAD_IMAGES']) && <a className="btn primary" href="#/upload">Upload photos</a>}
        </div>
      )}
      {view.status === 'ready' && view.total > 0 && (
        <>
          {view.matching > 0 && (
            <div className="bulk" role="group" aria-label="Selection">
              <label className="check">
                <input ref={allBox} type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(items.map((g) => g.id)))} /> Select all
              </label>
              <span aria-live="polite">{picked.size === 0 ? 'None selected' : `${picked.size} selected`}</span>
              <span className="bulk-act">
                <button type="button" className="btn" disabled={picked.size === 0 || download.running} onClick={() => void downloadPicked()}><Icon name="download" /> Download .zip</button>
                {shell.can(['PERM_DELETE_GOWN']) && <button type="button" className="btn" disabled={picked.size === 0 || download.running} onClick={deletePicked}><Icon name="trash" /> Delete</button>}
              </span>
            </div>
          )}
          <DownloadStatus {...download} />
          {view.matching === 0 ? (
            <div className="empty">
              <img src={art} alt="" width={160} />
              <p className="lede">No gowns match these filters</p>
              <p className="sub">Try a different silhouette, fabric, or date range.</p>
              <button type="button" className="btn" onClick={clear}>Clear filters</button>
            </div>
          ) : (
            <ul className="grid" aria-label="Gowns">
              {view.items.map((g) => <GownCardView key={g.id} g={g} picked={picked.has(g.id)} toggle={() => toggle(g.id)} />)}
            </ul>
          )}
          {view.next !== null && (
            <div className="more">
              <button type="button" className="btn" disabled={view.busy} onClick={() => void more()}>Show more gowns</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
