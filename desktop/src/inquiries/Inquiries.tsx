import { useCallback, useEffect, useRef, useState } from 'react';
import listArt from '../assets/empty/empty-gown-5.png';
import paneArt from '../assets/empty/empty-gown-6.png';
import type { components } from '../api/schema';
import { formatDate } from '../format';
import { Avatar } from '../shell/Avatar';
import { useShell } from '../shell/context';
import { useRouteArg } from '../shell/route';
import { ErrorBlock } from '../shell/ui';
import { ClientProfile } from './ClientProfile';
import { POLL_MS } from './events';
import { Thread } from './Thread';

type Item = components['schemas']['InquiryItem'];
type Page = components['schemas']['InquiryPage'];
type Filter = '' | 'new' | 'replied' | 'closed';
type View = { status: 'loading' | 'error' } | { status: 'ready'; items: Item[]; next: number | null; busy: boolean };

const CHIPS: [Filter, string][] = [['', 'All'], ['new', 'New'], ['replied', 'Replied'], ['closed', 'Closed']];
const LABEL: Record<string, string> = { new: 'New', replied: 'Replied', closed: 'Closed' };
const PAGE = 25;

function Row({ i, selected }: { i: Item; selected: boolean }) {
  const unread = i.unread === true;
  return (
    <li>
    <a className="inq-row" href={`#/inquiries/${i.id}`} aria-current={selected ? 'true' : undefined} data-unread={unread || undefined}>
      <Avatar name={i.clientName ?? ''} />
      <div className="inq-main">
        <p className="inq-name">
          <span>{i.clientName}</span>
          {unread && <><span className="dot" aria-hidden="true" /><span className="sr-only">Unread</span></>}
        </p>
        <p className="inq-subject">{i.subject}</p>
        <p className="inq-preview">{i.preview}</p>
      </div>
      <div className="inq-side">
        <time dateTime={i.lastMessageAt}>{i.lastMessageAt ? formatDate(i.lastMessageAt) : ''}</time>
        <span className={`pill ${i.status === 'new' ? 'pos' : 'neutral'}`}>{LABEL[i.status ?? ''] ?? i.status}</span>
      </div>
    </a>
    </li>
  );
}

/** FR-24: the Inbox. Rows open in the thread pane from Story 7.2; the poll refetches page 1 and never trusts a `seq` watermark. */
export function Inquiries() {
  const arg = useRouteArg();
  const arg2 = useRouteArg(2);
  if (arg === 'client' && arg2) return <ClientProfile id={arg2} />;
  return <Inbox selected={arg} />;
}

function Inbox({ selected }: { selected: string | null }) {
  const shell = useShell();
  const req = useRef(shell.request);
  req.current = shell.request;
  const toast = useRef(shell.toast);
  toast.current = shell.toast;
  const [filter, setFilter] = useState<Filter>('');
  const [view, setView] = useState<View>({ status: 'loading' });
  const turn = useRef(0);

  const fetchPage = useCallback(async (f: Filter, before: number | null): Promise<Page | null> => {
    try {
      const r = await req.current<Page>('POST', '/api/v1/inquiries/query', { status: f || null, before, limit: PAGE });
      return r.status === 200 && r.body ? r.body : null;
    } catch { return null; /* the shell already raised the offline banner or the expiry */ }
  }, []);

  const first = useCallback(async (f: Filter) => {
    const mine = ++turn.current;
    setView({ status: 'loading' });
    const p = await fetchPage(f, null);
    if (mine !== turn.current) return;
    setView(p ? { status: 'ready', items: p.items ?? [], next: p.next ?? null, busy: false } : { status: 'error' });
  }, [fetchPage]);

  useEffect(() => { void first(filter); }, [filter, first]);

  // shortcut: a refresh puts page 1 on top and keeps older loaded rows below it; a row that left the filter stays until the next full load.
  const refresh = useCallback(async () => {
    const mine = turn.current;
    const p = await fetchPage(filter, null);
    if (!p || mine !== turn.current) return;
    setView((v) => {
      if (v.status !== 'ready') return v;
      const top = p.items ?? [];
      const seen = new Set(top.map((t) => t.id));
      const older = v.items.filter((o) => !seen.has(o.id));
      return { ...v, items: [...top, ...older], next: older.length === 0 ? (p.next ?? null) : v.next };
    });
  }, [filter, fetchPage]);
  useEffect(() => {
    const h = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(h);
  }, [refresh]);

  const markRead = useCallback((rid: string) => {
    setView((v) => (v.status === 'ready' ? { ...v, items: v.items.map((i) => (i.id === rid ? { ...i, unread: false } : i)) } : v));
  }, []);

  const more = async () => {
    if (view.status !== 'ready' || view.next === null || view.busy) return;
    const mine = turn.current;
    setView({ ...view, busy: true });
    const p = await fetchPage(filter, view.next);
    if (mine !== turn.current) return;
    if (!p) {
      toast.current("Couldn't load more inquiries.", 'error');
      setView({ ...view, busy: false });
      return;
    }
    setView({ status: 'ready', items: [...view.items, ...(p.items ?? [])], next: p.next ?? null, busy: false });
  };

  const firstId = view.status === 'ready' ? view.items[0]?.id : undefined;
  return (
    <section className="inquiries">
      <h1>Inquiries</h1>
      <div className="inq-panes">
        <div className="inq-list">
          <div className="inq-chips" role="group" aria-label="Filter by status">
            {CHIPS.map(([id, label]) => (
              <button key={id || 'all'} type="button" className="chip-btn" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
            ))}
          </div>
          {view.status === 'loading' && (
            <ul className="inq-rows" aria-hidden="true">
              {Array.from({ length: 6 }, (_, n) => <li key={n} className="skeleton inq-skel" />)}
            </ul>
          )}
          {view.status === 'error' && <ErrorBlock what="inquiries" onRetry={() => void first(filter)} />}
          {view.status === 'ready' && view.items.length === 0 && (
            <div className="empty compact">
              <img src={listArt} alt="" height={144} />
              <h2>{filter ? `No ${filter} inquiries` : 'No inquiries yet'}</h2>
              <p>{filter ? 'Try another filter to see more messages.' : 'Website inquiries land here as soon as they arrive.'}</p>
              {filter
                ? <button type="button" className="btn primary" onClick={() => setFilter('')}>Show all</button>
                // shortcut: the public website form is deferred (PRD), so this says so; link it when intake ships.
                : <button type="button" className="btn primary" onClick={() => toast.current("The website form isn't connected yet.")}>View website form</button>}
            </div>
          )}
          {view.status === 'ready' && view.items.length > 0 && (
            <>
              <ul className="inq-rows" aria-label="Inquiries">
                {view.items.map((i) => <Row key={i.id} i={i} selected={i.id === selected} />)}
              </ul>
              {view.next !== null && (
                <div className="more">
                  <button type="button" className="btn" disabled={view.busy} onClick={() => void more()}>Show more inquiries</button>
                </div>
              )}
            </>
          )}
        </div>
        {selected ? <Thread id={selected} onRead={markRead} onChanged={() => void refresh()} /> : (
          <div className="inq-thread">
            <div className="empty">
              <img src={paneArt} alt="" height={240} />
              <h2>Select an inquiry</h2>
              <p>Pick a message on the left to read and reply.</p>
              {firstId && <a className="btn primary" href={`#/inquiries/${firstId}`}>Open first message</a>}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
