import { useEffect, useRef, useState } from 'react';
import type { components } from '../api/schema';
import { formatBytes, formatDateTime } from '../format';
import { Avatar } from '../shell/Avatar';
import { useShell } from '../shell/context';
import { Icon } from '../shell/icons';
import { ErrorBlock, Pill, Skeleton } from '../shell/ui';
import { Composer } from './Composer';
import { CustomerCard } from './CustomerCard';
import { INQUIRY_EVENT } from './events';
import { sanitizeHtml } from './sanitize';

type Detail = components['schemas']['InquiryDetail'];
type Msg = components['schemas']['DetailMessage'];
type View = { status: 'loading' } | { status: 'error' } | { status: 'missing' } | { status: 'ready'; d: Detail };

const LABEL: Record<string, string> = { new: 'New', replied: 'Replied', closed: 'Closed' };
export const READ_AFTER_MS = 1000;
const NO_CLOSE = "You don't have permission to close inquiries.";

/** FR-20 and FR-21: the whole conversation and the Reply composer. FR-22: the status select, Close and Reopen. */
export function Thread({ id, onRead, onChanged }: { id: string; onRead: (id: string) => void; onChanged?: () => void }) {
  const shell = useShell();
  const req = useRef(shell.request);
  req.current = shell.request;
  const [view, setView] = useState<View>({ status: 'loading' });
  const [turn, setTurn] = useState(0);
  const [busy, setBusy] = useState(false);
  const canClose = shell.can(['PERM_CLOSE_INQUIRY']);

  useEffect(() => {
    let live = true;
    setView({ status: 'loading' });
    (async () => {
      try {
        const r = await req.current<Detail>('GET', `/api/v1/inquiries/${id}`);
        if (!live) return;
        setView(r.status === 200 && r.body ? { status: 'ready', d: r.body } : { status: r.status === 404 ? 'missing' : 'error' });
      } catch {
        if (live) setView({ status: 'error' });
      }
    })();
    return () => { live = false; };
  }, [id, turn]);

  // Opening clears the flag for the whole Workspace (A3), but only once the thread has been on screen for a second.
  const unread = view.status === 'ready' && view.d.unread === true;
  useEffect(() => {
    if (!unread) return;
    const h = setTimeout(async () => {
      try {
        const r = await req.current('POST', `/api/v1/inquiries/${id}/read`);
        if (r.status === 204 || r.status === 200) {
          onRead(id);
          setView((v) => (v.status === 'ready' ? { status: 'ready', d: { ...v.d, unread: false } } : v));
          window.dispatchEvent(new Event(INQUIRY_EVENT));
        }
      } catch { /* stays unread; the next open tries again */ }
    }, READ_AFTER_MS);
    return () => clearTimeout(h);
  }, [unread, id, onRead]);

  const sent = (m: Msg) => {
    setView((v) => (v.status === 'ready' ? { status: 'ready', d: { ...v.d, status: 'replied', unread: false, messages: [...(v.d.messages ?? []), m] } } : v));
    window.dispatchEvent(new Event(INQUIRY_EVENT));
    onChanged?.();
    void syncVersion();
    if (m.mailState === 'failed') failed(m);
    else shell.toast(`Reply sent to ${(view.status === 'ready' ? view.d.client?.name ?? '' : '').split(' ')[0]}`);
  };
  // A Reply moves the status on the server, so the version this screen holds is old until it asks again.
  const syncVersion = async () => {
    try {
      const r = await req.current<Detail>('GET', `/api/v1/inquiries/${id}`);
      if (r.status === 200 && r.body) {
        const b = r.body;
        setView((v) => (v.status === 'ready' ? { status: 'ready', d: { ...v.d, version: b.version ?? v.d.version } } : v));
      }
    } catch { /* the next change answers 409 and reloads */ }
  };
  // shortcut: the pill and list change when the server answers, not before; add an optimistic update if that feels slow.
  const change = async (to: string) => {
    if (view.status !== 'ready' || busy || to === view.d.status) return;
    setBusy(true);
    try {
      const r = await req.current<{ status?: string; version?: number }>('PATCH', `/api/v1/inquiries/${id}`, { status: to }, view.d.version ?? 0);
      if (r.status === 200 && r.body) {
        const b = r.body;
        setView((v) => (v.status === 'ready' ? { status: 'ready', d: { ...v.d, status: b.status ?? to, version: b.version ?? v.d.version } } : v));
        window.dispatchEvent(new Event(INQUIRY_EVENT));
        onChanged?.();
        shell.toast(to === 'closed' ? 'Inquiry closed' : `Marked ${LABEL[to] ?? to}`);
      } else if (r.status === 403) shell.toast(NO_CLOSE, 'error');
      else if (r.status === 409) { shell.toast('This inquiry changed. Showing the latest.', 'error'); setTurn((t) => t + 1); }
      else if (r.status === 404) { shell.toast('This inquiry no longer exists.', 'error'); onChanged?.(); setTurn((t) => t + 1); }
      else shell.toast("Couldn't change the status. Try again.", 'error');
    } catch { /* the shell already raised the offline banner or the expiry */ } finally { setBusy(false); }
  };
  const failed = (m: Msg) => shell.toast("The reply couldn't be emailed.", 'error', { label: 'Retry', run: () => void retry(m) });
  const retry = async (m: Msg) => {
    try {
      const r = await req.current<Msg>('POST', `/api/v1/messages/${m.id}/retry`);
      if (r.status === 200 && r.body) {
        const next = r.body;
        setView((v) => (v.status === 'ready' ? { status: 'ready', d: { ...v.d, messages: (v.d.messages ?? []).map((x) => (x.id === next.id ? next : x)) } } : v));
        if (next.mailState === 'failed') failed(next);
        else shell.toast('Reply sent');
      } else shell.toast(r.status === 409 ? 'That reply was already sent.' : "Couldn't retry. Try again.", 'error');
    } catch { shell.toast("Couldn't retry. Try again.", 'error'); }
  };

  if (view.status === 'loading') return <div className="inq-thread"><Skeleton rows={4} height={72} /></div>;
  if (view.status === 'missing') return <div className="inq-thread"><p className="lede">This inquiry no longer exists.</p></div>;
  if (view.status === 'error') return <div className="inq-thread"><ErrorBlock what="this inquiry" onRetry={() => setTurn(turn + 1)} /></div>;
  const d = view.d;
  const closed = d.status === 'closed';
  return (
    <section className="inq-thread" aria-label="Conversation">
      <header className="thread-head">
        <h2>{d.subject}</h2>
        <div className="thread-meta">
          <CustomerCard client={d.client ?? {}} />
          <span className="muted">{(d.messages ?? []).length} message{(d.messages ?? []).length === 1 ? '' : 's'}</span>
          <Pill tone={d.status === 'new' ? 'pos' : 'neutral'}>{LABEL[d.status ?? ''] ?? d.status}</Pill>
        </div>
        <div className="thread-tools">
          <label>
            <span className="sr-only">Status</span>
            <select value={d.status} disabled={busy || (closed && !canClose)} title={closed && !canClose ? NO_CLOSE : undefined} aria-label="Status" onChange={(e) => void change(e.target.value)}>
              {Object.entries(LABEL).map(([k, v]) => <option key={k} value={k} disabled={k === 'closed' && !canClose}>{v}</option>)}
            </select>
          </label>
          {!closed && <button type="button" className="btn" disabled={busy || !canClose} title={canClose ? undefined : NO_CLOSE} onClick={() => void change('closed')}><Icon name="check" />Close inquiry</button>}
        </div>
      </header>
      <ol className="messages" aria-label="Messages">
        {(d.messages ?? []).map((m) => {
          const name = m.direction === 'in' ? d.client?.name ?? '' : m.author ?? 'Studio';
          return (
            <li key={m.id} className="message" data-direction={m.direction}>
              <Avatar name={name} />
              <div>
                <p className="message-head"><strong>{name}</strong> <time dateTime={m.createdAt}>{m.createdAt ? formatDateTime(m.createdAt) : ''}</time></p>
                {m.html
                  ? <div className="message-body rich" dangerouslySetInnerHTML={{ __html: sanitizeHtml(m.body ?? '') }} />
                  : <p className="message-body">{m.body}</p>}
                {(m.attachments ?? []).length > 0 && (
                  <ul className="message-files" aria-label="Attachments">
                    {(m.attachments ?? []).map((f) => <li key={f.id}>{f.name} <span className="muted">{formatBytes(f.size)}</span></li>)}
                  </ul>
                )}
                {m.direction === 'out' && m.mailState === 'failed' && (
                  <p className="message-state error" role="status">
                    Not sent. <button type="button" className="link" onClick={() => void retry(m)}>Retry</button>
                  </p>
                )}
                {m.direction === 'out' && m.mailState === 'pending' && <p className="message-state hint" role="status">Sending…</p>}
              </div>
            </li>
          );
        })}
      </ol>
      {closed ? (
        <div className="banner info composer-note">
          <Icon name="info" />
          <span>This inquiry is closed. Reopen it to reply.</span>
          <button type="button" className="btn" disabled={busy || !canClose} title={canClose ? undefined : NO_CLOSE} onClick={() => void change('new')}><Icon name="refresh" />Reopen</button>
        </div>
      ) : (
        <Composer inquiryId={id} to={{ name: d.client?.name ?? '', email: d.client?.email ?? '' }} subject={d.subject ?? ''} onSent={sent} />
      )}
    </section>
  );
}
