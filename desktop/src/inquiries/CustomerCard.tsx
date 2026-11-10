import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { components } from '../api/schema';
import { formatDay } from '../format';
import { Avatar } from '../shell/Avatar';
import { useShell } from '../shell/context';

type Full = components['schemas']['ClientDetail'];

export const OPEN_MS = 250;
export const CLOSE_MS = 150;

const Row = ({ k, v }: { k: string; v?: string | number | null }) => (
  <>
    <dt>{k}</dt>
    <dd>{v || v === 0 ? v : <span className="muted"><span aria-hidden="true">—</span><span className="sr-only">Not set</span></span>}</dd>
  </>
);

/**
 * The customer's name as a link to the profile. Resting the mouse on it for 250 ms, or focusing it, shows a card with the facts
 * (read once from the same endpoint as the profile). shortcut: mouse and focus only, no touch; staff on touch use the link.
 */
export function CustomerCard({ client }: { client: { id?: string; name?: string; email?: string } }) {
  const shell = useShell();
  const req = useRef(shell.request);
  req.current = shell.request;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const asked = useRef(false);
  const link = useRef<HTMLAnchorElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const [full, setFull] = useState<Full | null>(null);

  const arm = (fn: () => void, ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(fn, ms);
  };
  const stop = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const hide = () => { stop(); setShown(false); };
  const show = () => {
    stop();
    setShown(true);
    if (asked.current || !client.id) return;
    asked.current = true;
    req.current<Full>('GET', `/api/v1/clients/${client.id}`)
      .then((r) => { if (r.status === 200 && r.body) setFull(r.body); })
      .catch(() => { asked.current = false; /* the card still shows name and email; the next open tries again */ });
  };

  // Below the name, or above it when the card would leave the window; never off the left or right edge.
  useLayoutEffect(() => {
    const el = card.current, t = link.current;
    if (!el || !t) return;
    const r = t.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
    el.style.top = `${r.bottom + 6 + h > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6}px`;
  }, [shown, full]);

  useEffect(() => {
    if (!shown) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => stop, []);

  const name = client.name ?? '';
  const href = `#/inquiries/client/${client.id}`;
  return (
    <span
      className="cust"
      onMouseEnter={() => (shown ? stop() : arm(show, OPEN_MS))}
      onMouseLeave={() => arm(hide, CLOSE_MS)}
      onFocus={show}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) arm(hide, CLOSE_MS); }}
    >
      <a ref={link} className="cust-link" href={href}>{name}</a>
      {shown && (
        <div ref={card} className="hc" role="group" aria-label={`Customer: ${name}`}>
          <div className="hc-head">
            <Avatar name={name} />
            <div>
              <p className="hc-name">{name}</p>
              <p className="hc-mail">{client.email}</p>
            </div>
          </div>
          {full && (
            <dl className="kv">
              <Row k="Phone" v={full.phone} />
              <Row k="City" v={full.city} />
              <Row k="Wedding" v={full.weddingDate ? formatDay(full.weddingDate) : null} />
              <Row k="Inquiries" v={(full.inquiries ?? []).length} />
            </dl>
          )}
          <a className="btn" href={href} onClick={hide}>View profile</a>
        </div>
      )}
    </span>
  );
}
