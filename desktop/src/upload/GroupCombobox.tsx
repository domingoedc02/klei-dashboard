import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

export type GroupOption = { id: string; name: string; count: number };

const text = (o: GroupOption) => `${o.name} · ${o.count} ${o.count === 1 ? 'photo' : 'photos'}`;

/** Type a gown name, pick from the filtered list. Same ARIA pattern as the search box: focus stays in the input, the list follows with `aria-activedescendant`. */
export function GroupCombobox({ id, options, value, disabled, placeholder, describedBy, onChange }: {
  id: string; options: GroupOption[]; value: string; disabled: boolean; placeholder: string; describedBy: string; onChange: (id: string) => void;
}) {
  const uid = useId();
  const list = `${uid}-list`;
  const opt = (i: number) => `${uid}-o${i}`;
  const [typed, setTyped] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const chosen = options.find((o) => o.id === value);
  const shown = typed ?? chosen?.name ?? '';
  const q = (typed ?? '').trim().toLowerCase();
  const hits = q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options;
  const listed = open && hits.length > 0;
  const pop = useRef<HTMLUListElement>(null);
  // The list sits inside a scrolling pane: bring it into view instead of leaving it clipped.
  useEffect(() => { if (listed) pop.current?.scrollIntoView?.({ block: 'nearest' }); }, [listed]);

  const choose = (o: GroupOption) => { setTyped(null); setOpen(false); setActive(-1); onChange(o.id); };
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!hits.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setOpen(true);
      setActive(open ? (active + step + hits.length) % hits.length : e.key === 'ArrowDown' ? 0 : hits.length - 1);
    } else if (e.key === 'Enter') {
      const exact = hits.filter((o) => o.name.toLowerCase() === q);
      const pick = listed && active >= 0 ? hits[active] : exact.length === 1 ? exact[0] : null;
      if (pick) { e.preventDefault(); choose(pick); }
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
      setActive(-1);
    }
  };

  return (
    <div className="combo">
      <input
        id={id} type="text" role="combobox" autoComplete="off" aria-autocomplete="list" aria-expanded={listed} aria-controls={listed ? list : undefined}
        aria-activedescendant={listed && active >= 0 ? opt(active) : undefined} aria-describedby={describedBy} disabled={disabled} placeholder={placeholder}
        value={shown}
        onChange={(e) => { setTyped(e.target.value); setOpen(true); setActive(-1); if (value) onChange(''); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { setOpen(false); setActive(-1); }}
        onKeyDown={key}
      />
      {listed && (
        <ul className="combo-pop" ref={pop} id={list} role="listbox" aria-label="Gowns">
          {hits.map((o, i) => (
            <li key={o.id} id={opt(i)} role="option" aria-selected={i === active} className="combo-opt" title={text(o)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)}>
              {text(o)}
            </li>
          ))}
        </ul>
      )}
      {open && !hits.length && <p className="combo-pop combo-empty">No gown matches</p>}
      <span className="sr-only" role="status">{open ? (hits.length ? `${hits.length} ${hits.length === 1 ? 'gown matches' : 'gowns match'}` : 'No gown matches') : ''}</span>
    </div>
  );
}
