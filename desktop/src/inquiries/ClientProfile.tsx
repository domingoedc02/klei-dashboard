import { useEffect, useRef, useState } from 'react';
import type { components } from '../api/schema';
import { formatDate, formatDay } from '../format';
import { Avatar } from '../shell/Avatar';
import { useShell } from '../shell/context';
import { Icon } from '../shell/icons';
import { ErrorBlock, Pill, Skeleton } from '../shell/ui';
import { EditClient } from './EditClient';

type Client = components['schemas']['ClientDetail'];
type View = { status: 'loading' } | { status: 'error' } | { status: 'missing' } | { status: 'ready'; c: Client };

const LABEL: Record<string, string> = { new: 'New', replied: 'Replied', closed: 'Closed' };

function Fact({ label, value }: { label: string; value?: string | null }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value ? <span className="note-text">{value}</span> : <span className="muted"><span aria-hidden="true">—</span><span className="sr-only">Not set</span></span>}</dd>
    </>
  );
}

const crumb = (name: string) => (
  <nav className="crumb" aria-label="Breadcrumb"><a href="#/inquiries">Inquiries</a><Icon name="chevron" /><span aria-current="page">{name}</span></nav>
);

/** FR-23, screen I2: who the Customer is (the API and code say `client`) and what they have written. Edit changes the five facts; name and email stay as written. */
export function ClientProfile({ id }: { id: string }) {
  const shell = useShell();
  const req = useRef(shell.request);
  req.current = shell.request;
  const [view, setView] = useState<View>({ status: 'loading' });
  const [turn, setTurn] = useState(0);

  useEffect(() => {
    let live = true;
    setView({ status: 'loading' });
    (async () => {
      try {
        const r = await req.current<Client>('GET', `/api/v1/clients/${id}`);
        if (!live) return;
        setView(r.status === 200 && r.body ? { status: 'ready', c: r.body } : { status: r.status === 404 ? 'missing' : 'error' });
      } catch {
        if (live) setView({ status: 'error' });
      }
    })();
    return () => { live = false; };
  }, [id, turn]);

  if (view.status === 'loading') return <section><Skeleton rows={4} height={56} /></section>;
  if (view.status === 'missing') return <section>{crumb('Unknown customer')}<h1>Customer not found</h1><p className="lede">This customer no longer exists.</p></section>;
  if (view.status === 'error') return <section>{crumb('Customer')}<ErrorBlock what="this customer" onRetry={() => setTurn(turn + 1)} /></section>;
  const c = view.c;
  const edit = () =>
    shell.openDialog({
      title: 'Edit customer',
      custom: (close) => <EditClient client={c} close={close} onSaved={(next) => setView({ status: 'ready', c: next })} onReload={() => setTurn(turn + 1)} />,
    });
  const first = (c.name ?? '').split(' ')[0];
  const rows = c.inquiries ?? [];
  const where = [c.city, c.weddingDate ? `Wedding ${formatDay(c.weddingDate)}` : ''].filter(Boolean).join(' · ');
  return (
    <section className="client-profile">
      {crumb(c.name ?? '')}
      <header className="client-head">
        <Avatar name={c.name ?? ''} large />
        <div>
          <h1>{c.name}</h1>
          {where && <p className="lede">{where}</p>}
        </div>
        <div className="client-actions">
          <a className="btn" href={`mailto:${c.email}`}><Icon name="mail" />Email {first}</a>
          <button type="button" className="btn" onClick={edit}><Icon name="edit" />Edit</button>
        </div>
      </header>
      <div className="cprof">
        <section className="card" aria-labelledby="pd-h">
          <h2 id="pd-h">Personal details</h2>
          <dl className="kv">
            <Fact label="Full name" value={c.name} />
            <Fact label="Email" value={c.email} />
            <Fact label="Phone" value={c.phone} />
            <Fact label="City" value={c.city} />
            <Fact label="Wedding date" value={c.weddingDate ? formatDay(c.weddingDate) : null} />
            <Fact label="Heard about us" value={c.source} />
            <Fact label="Customer since" value={c.createdAt ? formatDate(c.createdAt) : null} />
            <Fact label="Notes" value={c.note} />
          </dl>
        </section>
        <section className="card" aria-labelledby="ai-h">
          <h2 id="ai-h">All inquiries <span className="muted">({rows.length})</span></h2>
          <ul className="cprof-rows">
            {rows.map((i) => (
              <li key={i.id}>
                <a className="cprof-row" href={`#/inquiries/${i.id}`}>
                  <span className="cprof-main">
                    <span className="cprof-subject">{i.subject}</span>
                    <span className="cprof-preview">{i.preview}</span>
                  </span>
                  <time className="muted" dateTime={i.lastMessageAt}>{i.lastMessageAt ? formatDate(i.lastMessageAt) : ''}</time>
                  <Pill tone={i.status === 'new' ? 'pos' : 'neutral'}>{LABEL[i.status ?? ''] ?? i.status}</Pill>
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  );
}
