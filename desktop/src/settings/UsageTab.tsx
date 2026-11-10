import { useCallback, useEffect, useRef, useState } from 'react';
import art from '../assets/empty/empty-gown-3.png';
import type { components } from '../api/schema';
import { formatBytes, formatDateTime } from '../format';
import { useShell } from '../shell/context';
import { ErrorBlock, Skeleton } from '../shell/ui';

type Row = Required<Pick<components['schemas']['AiUsageRow'], 'id' | 'time' | 'user' | 'purpose' | 'outcome' | 'durationMs'>> & { model?: string | null; size?: number | null };
interface Page { items: Row[]; page: number; pages: number }

const PURPOSES: Record<string, string> = { test: 'Test connection', embed: 'Photo matching', describe: 'Description', chat: 'Assistant', verify: 'Grouping check' };
const OUTCOMES: Record<string, { text: string; tone: string }> = {
  ok: { text: 'OK', tone: 'pos' },
  error: { text: 'Error', tone: 'warn' },
  timeout: { text: 'Timed out', tone: 'warn' },
  refused: { text: 'Refused', tone: 'warn' },
};

const when = formatDateTime;
const seconds = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

export function UsageTab() {
  const shell = useShell();
  const req = useRef(shell.request);
  req.current = shell.request;
  const [state, setState] = useState<'loading' | 'error' | Page>('loading');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (page: number) => {
    setBusy(true);
    try {
      const r = await req.current<components['schemas']['AiUsagePage']>('GET', `/api/v1/admin/ai/usage?page=${page}`);
      if (r.status === 200 && r.body) {
        setState({ items: (r.body.items ?? []) as Row[], page: r.body.page ?? page, pages: r.body.pages ?? 1 });
        return;
      }
    } catch { /* the shell already raised the offline banner or the expiry */ } finally { setBusy(false); }
    setState((cur) => (typeof cur === 'object' ? cur : 'error'));
  }, []);

  useEffect(() => { void load(1); }, [load]);

  if (state === 'loading') return <Skeleton rows={6} height={40} />;
  if (state === 'error') return <ErrorBlock what="the AI usage log" onRetry={() => { setState('loading'); void load(1); }} />;

  const { items, page, pages } = state;
  if (items.length === 0 && page === 1) return (
    <div className="empty">
      <img src={art} alt="" width={160} />
      <p className="lede">No AI requests yet</p>
    </div>
  );

  return (
    <div>
      <table className="table" aria-label="AI usage">
        <thead>
          <tr>
            <th scope="col">Time</th><th scope="col">User</th><th scope="col">Purpose</th><th scope="col">Model</th>
            <th scope="col">Size</th><th scope="col">Outcome</th><th scope="col">Duration</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => {
            const o = OUTCOMES[r.outcome] ?? { text: r.outcome, tone: 'neutral' };
            return (
              <tr key={r.id}>
                <td>{when(r.time)}</td>
                <td>{r.user}</td>
                <td>{PURPOSES[r.purpose] ?? r.purpose}</td>
                <td>{r.model ?? '–'}</td>
                <td>{formatBytes(r.size)}</td>
                <td><span className={`pill ${o.tone}`}>{o.text}</span></td>
                <td>{seconds(r.durationMs)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <nav className="bar pager" aria-label="AI usage pages">
        <button type="button" className="link" disabled={busy || page <= 1} onClick={() => void load(page - 1)}>Previous</button>
        <span aria-live="polite">Page {page} of {pages}</span>
        <button type="button" className="link" disabled={busy || page >= pages} onClick={() => void load(page + 1)}>Next</button>
      </nav>
    </div>
  );
}
