import { useCallback, useEffect, useRef, useState } from 'react';
import type { components } from '../api/schema';
import art from '../assets/empty/empty-gown-5.png';
import { formatRelative } from '../format';
import { POLL_MS } from '../inquiries/events';
import { useShell } from './context';
import { Icon } from './icons';
import { EmptyState, ErrorBlock, Skeleton } from './ui';

const INQUIRY_NEEDS = ['PERM_REPLY', 'PERM_CLOSE_INQUIRY'];
type Bell = components['schemas']['NotificationList'];
type Item = components['schemas']['NotificationItem'];
type View = { status: 'loading' } | { status: 'error' } | { status: 'ready'; items: Item[]; unread: number };

/** FR-29: the bell in the top bar. The 20 newest lines of this User, a dot while any is unread, one click to read and go. */
export function Bell() {
  const shell = useShell();
  const req = useRef(shell.request);
  req.current = shell.request;
  const toast = useRef(shell.toast);
  toast.current = shell.toast;
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>({ status: 'loading' });

  const load = useCallback(async () => {
    try {
      const r = await req.current<Bell>('GET', '/api/v1/notifications');
      if (r.status === 200 && r.body) setView({ status: 'ready', items: r.body.items ?? [], unread: r.body.unread ?? 0 });
      else setView((v) => (v.status === 'ready' ? v : { status: 'error' }));
    } catch {
      setView((v) => (v.status === 'ready' ? v : { status: 'error' }));
    }
  }, []);

  useEffect(() => {
    void load();
    const h = setInterval(load, POLL_MS);
    return () => clearInterval(h);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    void load();
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open, load]);

  const unread = view.status === 'ready' ? view.unread : 0;

  const go = async (n: Item) => {
    setOpen(false);
    if (!n.read) {
      setView((v) => (v.status === 'ready' ? { status: 'ready', items: v.items.map((x) => (x.id === n.id ? { ...x, read: true } : x)), unread: Math.max(0, v.unread - 1) } : v));
      try { await req.current('POST', '/api/v1/notifications/read', { ids: [n.id] }); } catch { /* the next poll shows the truth */ }
    }
    if (n.target) window.location.hash = `#/${n.target}`;
  };

  const clear = async () => {
    try {
      const r = await req.current('DELETE', '/api/v1/notifications');
      if (r.status === 204 || r.status === 200) {
        setView({ status: 'ready', items: [], unread: 0 });
        toast.current('Notifications cleared');
      } else toast.current("Couldn't clear notifications. Try again.", 'error');
    } catch { /* the shell already raised the offline banner or the expiry */ }
  };

  return (
    <div ref={box} className="bell">
      <button
        type="button"
        className="btn icon-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        onClick={() => setOpen(!open)}
      >
        <Icon name="bell" large />
        {unread > 0 && <span className="dot" aria-hidden="true" />}
      </button>
      {open && (
        <div role="menu" aria-label="Notifications" className="menu bell-menu">
          <div className="menu-head">
            <strong>Notifications</strong>
            {view.status === 'ready' && view.items.length > 0 && (
              <button type="button" role="menuitem" className="link" onClick={() => void clear()}>Clear all</button>
            )}
          </div>
          {view.status === 'loading' && <Skeleton rows={3} height={40} />}
          {view.status === 'error' && <ErrorBlock what="notifications" onRetry={() => { setView({ status: 'loading' }); void load(); }} />}
          {view.status === 'ready' && view.items.length === 0 && (
            <EmptyState art={art} compact title="You’re all caught up" text="New inquiries and AI results will show up here.">
              {shell.can(INQUIRY_NEEDS) && <a role="menuitem" className="btn primary" href="#/inquiries" onClick={() => setOpen(false)}>Go to Inquiries</a>}
            </EmptyState>
          )}
          {view.status === 'ready' && view.items.map((n) => (
            <button key={n.id} type="button" role="menuitem" className={`notice${n.read ? '' : ' unread'}`} onClick={() => void go(n)}>
              <span className="notice-title">{n.title}</span>
              <time className="hint" dateTime={n.createdAt}>{formatRelative(n.createdAt ?? '')}</time>
            </button>
          ))}
          {shell.can(INQUIRY_NEEDS) && !(view.status === 'ready' && view.items.length === 0) && (
            <a role="menuitem" className="menu-foot" href="#/inquiries" onClick={() => setOpen(false)}>Go to Inquiries</a>
          )}
        </div>
      )}
    </div>
  );
}
