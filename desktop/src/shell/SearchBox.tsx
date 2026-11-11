import { forwardRef, useEffect, useId, useRef, useState } from 'react';
import type { components } from '../api/schema';
import art from '../assets/empty/empty-gown-6.png';
import { Mosaic } from '../gallery/Gallery';
import { useShell } from './context';
import { Icon } from './icons';
import { EmptyState, Skeleton } from './ui';

type Hit = components['schemas']['SearchHit'];
type View = { status: 'idle' } | { status: 'loading' } | { status: 'error' } | { status: 'ready'; hits: Hit[] };

export const SEARCH_DEBOUNCE_MS = 200;
const NEEDS = ['PERM_VIEW_GALLERY', 'PERM_REPLY'];
const where = (h: Hit) => (h.kind === 'gown' ? `#/gallery/${h.id}` : `#/inquiries/${h.id}`);

/** FR-28 (X2): the top-bar box. Whole words only; Gowns first, then Inquiries, at most six. The words travel in a POST body, never a URL. */
export const SearchBox = forwardRef<HTMLInputElement>(function SearchBox(_, ref) {
  const shell = useShell();
  const req = useRef(shell.request);
  req.current = shell.request;
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>({ status: 'idle' });
  const [active, setActive] = useState(0);
  const [turn, setTurn] = useState(0);
  const allowed = shell.can(NEEDS);

  // Debounced; a slower answer to an older word never replaces a newer one (`live`).
  useEffect(() => {
    if (!allowed || q.trim() === '') { setView({ status: 'idle' }); return; }
    let live = true;
    setView({ status: 'loading' });
    const h = setTimeout(async () => {
      try {
        const r = await req.current<{ items?: Hit[] }>('POST', '/api/v1/search', { q });
        if (!live) return;
        if (r.status === 200 && r.body) { setView({ status: 'ready', hits: r.body.items ?? [] }); setActive(0); }
        else setView({ status: 'error' });
      } catch {
        if (live) setView({ status: 'error' });
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => { live = false; clearTimeout(h); };
  }, [q, turn, allowed]);

  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, [open]);

  const hits = view.status === 'ready' ? view.hits : [];
  const go = (h: Hit) => { window.location.hash = where(h); setOpen(false); setQ(''); };
  const clear = () => { setQ(''); setOpen(false); };
  const optionId = (i: number) => `${id}-o${i}`;
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (!open || hits.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((active + 1) % hits.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((active - 1 + hits.length) % hits.length); }
    else if (e.key === 'Enter') { e.preventDefault(); go(hits[active]); }
  };

  const group = (kind: string, label: string) => {
    const rows = hits.map((h, i) => ({ h, i })).filter((x) => x.h.kind === kind);
    if (rows.length === 0) return null;
    return (
      <div role="group" aria-label={label} key={kind}>
        <div className="search-group" aria-hidden="true">{label}</div>
        {rows.map(({ h, i }) => (
          <div
            key={h.id} id={optionId(i)} role="option" aria-selected={i === active} className="search-hit"
            onMouseDown={(e) => e.preventDefault()} onClick={() => go(h)} onMouseMove={() => setActive(i)}
          >
            {kind === 'gown' && <Mosaic gown={h.id ?? ''} ids={h.thumbs ?? []} />}
            <span className="search-text"><strong>{h.title}</strong>{h.subtitle && <span className="hint">{h.subtitle}</span>}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="searchbox" ref={box}>
      <Icon name="search" />
      <input
        ref={ref} type="search" className="search" aria-label="Search gowns and inquiries" placeholder="Search gowns, inquiries…"
        value={q} disabled={!allowed} autoComplete="off" aria-autocomplete="list" aria-controls={open ? `${id}-pop` : undefined}
        aria-activedescendant={open && hits.length > 0 ? optionId(active) : undefined}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => q.trim() !== '' && setOpen(true)} onKeyDown={onKey}
      />
      {open && view.status !== 'idle' && (
        <div className="search-pop" id={`${id}-pop`}>
          {view.status === 'loading' && <Skeleton rows={3} height={44} />}
          {view.status === 'error' && (
            <p className="search-note" role="alert">
              Search is unavailable. <button type="button" className="link" onClick={() => setTurn(turn + 1)}>Try again</button>
            </p>
          )}
          {view.status === 'ready' && hits.length === 0 && (
            <EmptyState art={art} compact title={`No results for “${q.trim()}”`} text="Check the spelling or try a gown name, fabric, or client.">
              <button type="button" className="btn primary" onClick={clear}>Clear search</button>
            </EmptyState>
          )}
          {hits.length > 0 && <div role="listbox" aria-label="Search results">{group('gown', 'Gowns')}{group('inquiry', 'Inquiries')}</div>}
          <p className="sr-only" role="status">{view.status === 'ready' ? `${hits.length} results` : ''}</p>
        </div>
      )}
    </div>
  );
});
