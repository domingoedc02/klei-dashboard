import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import art from '../assets/empty/empty-gown-1.png';
import art2 from '../assets/empty/empty-gown-2.png';
import type { components } from '../api/schema';
import { formatRelative } from '../format';
import { Mosaic } from '../gallery/Gallery';
import { INQUIRY_EVENT, POLL_MS } from '../inquiries/events';
import { useShell } from '../shell/context';
import { Icon } from '../shell/icons';
import { EmptyState, ErrorBlock, Pill, type PillTone } from '../shell/ui';
import { STEPS } from '../upload/Processing';
import { dateLine, greeting, replyTime, since } from './clock';

type View = components['schemas']['DashboardView'];
type State = { status: 'loading' | 'error' } | { status: 'ready'; view: View };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const Bone = ({ h, w }: { h: number; w?: string | number }) => <span className="skeleton dash-bone" style={{ height: h, width: w }} />;

const SkelRows = ({ n }: { n: number }) => (
  <ul className="dash-rows" aria-hidden="true">
    {Array.from({ length: n }, (_, i) => (
      <li key={i}>
        <div className="list-row">
          <Bone h={53} w={40} />
          <span className="dash-main dash-bones"><Bone h={14} w="60%" /><Bone h={12} w="40%" /></span>
        </div>
      </li>
    ))}
  </ul>
);

function Card({ id, title, aside, children }: { id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="dash-card" aria-labelledby={`dash-${id}`}>
      <div className="dash-card-head">
        <h2 id={`dash-${id}`}>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Stat({ id, label, state, figure, sub, retry }: { id: string; label: string; state: 'loading' | 'fail' | 'ok'; figure: string; sub: string; retry: () => void }) {
  return (
    <div className="dash-stat" role="group" aria-labelledby={`stat-${id}`}>
      <span className="stat-label" id={`stat-${id}`}>{label}</span>
      {state === 'loading' ? <Bone h={40} w="50%" /> : <span className="stat-figure">{state === 'fail' ? '—' : figure}</span>}
      <span className="stat-sub">
        {state === 'fail' ? <>Couldn't load. <button type="button" className="link" onClick={retry}>Retry</button></> : state === 'ok' ? sub : null}
      </span>
    </div>
  );
}

function Recent({ rows, canUpload }: { rows: NonNullable<View['recentGowns']>; canUpload: boolean }) {
  if (rows.length === 0) {
    return (
      <EmptyState art={art} compact title="No uploads yet" text="Upload gown photos and AI will group them for you.">
        {canUpload && <a className="btn primary" href="#/upload">Upload photos</a>}
      </EmptyState>
    );
  }
  return (
    <ul className="dash-rows">
      {rows.map((g) => {
        const count = plural(g.photos ?? 0, 'photo', 'photos');
        const sil = (g.silhouette ?? []).join(', ');
        return (
          <li key={g.id}>
            <a className="list-row" href={`#/gallery/${g.id}`}>
              <span className="dash-thumb"><Mosaic gown={g.id ?? ''} ids={(g.thumbs ?? []).slice(0, 1)} /></span>
              <span className="dash-main">
                <span className="dash-name">{g.name}</span>
                <span className="dash-meta">{sil ? `${sil} · ${count}` : count}</span>
              </span>
              {g.isNew && <Pill tone="info">New</Pill>}
              {g.addedAt && <time className="dash-when" dateTime={g.addedAt}>{formatRelative(g.addedAt)}</time>}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function Inbox({ latest }: { latest: NonNullable<View['inquiries']>['latest'] }) {
  const rows = latest ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState art={art2} compact title="No new inquiries" text="New website inquiries will appear here.">
        <a className="btn primary" href="#/inquiries">Open inbox</a>
      </EmptyState>
    );
  }
  return (
    <ul className="dash-rows">
      {rows.map((i) => (
        <li key={i.id}>
          <a className="list-row" href={`#/inquiries/${i.id}`}>
            <span className="dot" aria-hidden="true" />
            <span className="dash-main">
              <span className="dash-name">{i.clientName}</span>
              <span className="dash-meta">{i.subject}</span>
            </span>
            {i.lastMessageAt && <time className="dash-when" dateTime={i.lastMessageAt}>{formatRelative(i.lastMessageAt)}</time>}
          </a>
        </li>
      ))}
    </ul>
  );
}

const Batch = ({ total, pct }: { total: number; pct: number }) => (
  <div className="dash-batch"><span className="dash-batch-name">{total > 0 ? `Batch of ${plural(total, 'photo', 'photos')}` : 'Batch'}</span><span className="dash-meta">{pct}%</span></div>
);

const Meter = ({ pct, label }: { pct: number; label: string }) => (
  <div className="dash-meter" role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></div>
);

function Ai({ ai, canUpload }: { ai: View['aiStatus']; canUpload: boolean }) {
  const total = ai?.total ?? 0;
  if (ai?.phase === 'processing') {
    const name = STEPS[(ai.step ?? 1) - 1] ?? 'Grouping';
    const done = ai.done ?? 0;
    const pct = total > 0 ? Math.min(100, Math.max(0, Math.round((done / total) * 100))) : 0;
    return (
      <div className="dash-ai">
        {total > 0 && <Batch total={total} pct={pct} />}
        <Meter pct={pct} label={`${name} progress`} />
        <p className="dash-line">{name}{total ? ` · ${done} of ${plural(total, 'photo', 'photos')}` : ''}</p>
      </div>
    );
  }
  if (ai?.phase === 'review') {
    const n = ai.groups;
    const k = ai.lowConfidence ?? 0;
    return (
      <div className="dash-ai">
        <Batch total={total} pct={100} />
        <Meter pct={100} label="Batch progress" />
        <p className="dash-line">
          {n == null ? 'Ready for your review' : `Grouped into ${plural(n, 'gown', 'gowns')}${k > 0 ? ` · ${k} ${k === 1 ? 'needs' : 'need'} a quick look` : ''}.`}
        </p>
        {canUpload && <a className="btn" href="#/upload">Review groups</a>}
      </div>
    );
  }
  if (ai?.phase === 'error') return <p className="dash-line">The last run stopped. Open AI Upload to try again.</p>;
  return <p className="dash-line">No batches in progress. Start one by dropping photos into AI Upload.</p>;
}

const AI_PILL: Record<string, { tone: PillTone; label: string }> = {
  processing: { tone: 'info', label: 'Checking…' }, review: { tone: 'pos', label: 'Ready for review' },
  error: { tone: 'warn', label: 'Stopped' }, idle: { tone: 'neutral', label: 'Idle' },
};

/** FR-7: a greeting, four figures and three widgets from one call; a block is on screen only if the server sent its data (or named it in `errors`). */
export function Dashboard() {
  const shell = useShell();
  const req = useRef(shell.request);
  req.current = shell.request;
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = useCallback(async (quiet: boolean) => {
    if (!quiet) setState({ status: 'loading' });
    try {
      const r = await req.current<View>('GET', '/api/v1/dashboard');
      if (r.status === 200 && r.body) setState({ status: 'ready', view: r.body });
      else if (!quiet) setState({ status: 'error' });
    } catch {
      if (!quiet) setState({ status: 'error' }); // the shell already raised the offline banner or the expiry
    }
  }, []);

  useEffect(() => {
    void load(false);
    const poll = () => void load(true);
    const h = setInterval(poll, POLL_MS);
    window.addEventListener(INQUIRY_EVENT, poll);
    return () => { clearInterval(h); window.removeEventListener(INQUIRY_EVENT, poll); };
  }, [load]);

  const retry = () => void load(false);
  const now = new Date();
  const tz = shell.me.preferences?.timezone;
  const first = (shell.me.name ?? '').trim().split(/\s+/)[0];
  const wantGowns = shell.can(['PERM_VIEW_GALLERY']);
  const wantInbox = shell.can(['PERM_REPLY']);
  const canUpload = shell.can(['PERM_UPLOAD_IMAGES']);

  const head = (
    <div className="dash-head">
      <div>
        <h1>{greeting(now, tz)}{first ? `, ${first}` : ''}</h1>
        <p className="lede">{dateLine(now, tz)}</p>
      </div>
      {canUpload && <a className="btn primary" href="#/upload"><Icon name="upload" />Upload photos</a>}
    </div>
  );
  if (state.status === 'error') return <section className="dashboard">{head}<ErrorBlock what="the dashboard" onRetry={retry} /></section>;

  const view = state.status === 'ready' ? state.view : null;
  const bad = (w: string) => (view?.errors ?? []).includes(w);
  const pill = view === null ? AI_PILL.processing : !bad('ai') ? (AI_PILL[view.aiStatus?.phase ?? 'idle'] ?? AI_PILL.idle) : null;
  const widget = (w: string, what: string, loading: ReactNode, body: () => ReactNode) => (view === null ? loading : bad(w) ? <ErrorBlock what={what} onRetry={retry} /> : body());
  const mode = (w: string) => (view === null ? 'loading' : bad(w) ? 'fail' : 'ok') as 'loading' | 'fail' | 'ok';

  const total = view?.totalGowns ?? 0;
  const unread = view?.inquiries?.unread ?? 0;
  const oldest = view?.inquiries?.oldestUnreadAt;
  const photos = view?.photosThisMonth ?? 0;
  const cur = view?.avgReplySeconds;
  const prev = view?.prevAvgReplySeconds;
  const trend = cur != null && prev != null && replyTime(prev) !== replyTime(cur) ? `${cur < prev ? 'Down' : 'Up'} from ${replyTime(prev)}` : '';

  return (
    <section className="dashboard">
      {head}
      <div className="dash-stats">
        {wantGowns && <Stat id="total" label="Total gowns" state={mode('total')} figure={total.toLocaleString('en-US')} sub={total === 0 ? 'Nothing saved yet' : `+${view?.newThisWeek ?? 0} this week`} retry={retry} />}
        {wantInbox && <Stat id="unread" label="Unread inquiries" state={mode('inquiries')} figure={String(unread)} sub={unread === 0 ? 'Inbox is clear' : oldest ? `Oldest from ${since(oldest, now, tz)}` : ''} retry={retry} />}
        {wantGowns && <Stat id="photos" label="Photos this month" state={mode('total')} figure={photos.toLocaleString('en-US')} sub={photos === 0 ? 'Upload to get started' : `Across ${plural(view?.gownsThisMonth ?? 0, 'gown', 'gowns')}`} retry={retry} />}
        {wantInbox && <Stat id="reply" label="Avg. reply time" state={mode('inquiries')} figure={cur == null ? '—' : replyTime(cur)} sub={cur == null ? 'No replies yet' : trend} retry={retry} />}
      </div>
      <div className="dash-cols">
        {wantGowns && (
          <Card id="recent" title="Recent uploads" aside={<a href="#/gallery">View gallery</a>}>
            {widget('recent', 'recent uploads', <SkelRows n={4} />, () => <Recent rows={view!.recentGowns ?? []} canUpload={canUpload} />)}
          </Card>
        )}
        <div className="dash-stack">
          <Card id="ai" title="AI processing" aside={pill && <Pill tone={pill.tone}>{pill.label}</Pill>}>
            {widget('ai', 'the AI status', <div className="dash-ai" aria-hidden="true"><Bone h={8} /><Bone h={14} w="70%" /></div>, () => <Ai ai={view!.aiStatus} canUpload={canUpload} />)}
          </Card>
          {wantInbox && (
            <Card id="inbox" title="Unread inquiries" aside={<a href="#/inquiries">Open inbox</a>}>
              {widget('inquiries', 'inquiries', <SkelRows n={3} />, () => <Inbox latest={view!.inquiries?.latest} />)}
            </Card>
          )}
        </div>
      </div>
    </section>
  );
}
