import { useCallback, useEffect, useRef, useState } from 'react';
import type { components } from '../api/schema';
import { useShell } from '../shell/context';
import { ErrorBlock, Skeleton } from '../shell/ui';

type Status = Required<Pick<components['schemas']['KeyStatus'], 'active' | 'highest' | 'configured'>> & {
  rows: { dataKey: Record<string, number>; storedObject: Record<string, number> };
  run: { state: string; done: number; total: number; dataKey: number; storedObject: number };
};

export const KEYS_POLL_MS = 1500;
const count = (n: number) => n.toLocaleString('en-US');

export function KeysTab() {
  const shell = useShell();
  const req = useRef(shell.request);
  req.current = shell.request;
  const toast = useRef(shell.toast);
  toast.current = shell.toast;
  const [state, setState] = useState<'loading' | 'error' | Status>('loading');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await req.current<Status>('GET', '/api/v1/admin/keys/status');
      if (r.status === 200 && r.body) { setState(r.body); return; }
    } catch { /* the shell already raised the offline banner or the expiry */ }
    setState((cur) => (typeof cur === 'object' ? cur : 'error'));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const running = typeof state === 'object' && state.run.state === 'running';
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => void load(), KEYS_POLL_MS);
    return () => clearInterval(t);
  }, [running, load]);

  const start = async () => {
    setBusy(true);
    try {
      const r = await req.current('POST', '/api/v1/admin/keys/rewrap');
      if (r.status === 200 || r.status === 202 || r.status === 409) {
        if (r.status === 409) toast.current('A re-wrap is already running, or the new key is not active yet.', 'error');
        await load();
      } else toast.current("Couldn't start the re-wrap. Try again.", 'error');
    } catch { toast.current("Couldn't start the re-wrap. Try again.", 'error'); } finally { setBusy(false); }
  };

  if (state === 'loading') return <Skeleton rows={4} height={40} />;
  if (state === 'error') return <ErrorBlock what="the key status" onRetry={() => { setState('loading'); void load(); }} />;

  const { active, highest, rows, run } = state;
  const versions = [...new Set([...state.configured, ...Object.keys(rows.dataKey).map(Number), ...Object.keys(rows.storedObject).map(Number)])].sort((a, b) => a - b);
  const at = (v: number) => (rows.dataKey[String(v)] ?? 0) + (rows.storedObject[String(v)] ?? 0);
  const pending = versions.filter((v) => v < active).reduce((n, v) => n + at(v), 0);
  const blocked = active < highest ? 'Make the newest key the active one and deploy before re-wrapping.' : pending === 0 ? 'Nothing to re-wrap.' : '';

  return (
    <div>
      <p className="lede">
        Each photo and record is locked with its own data key, and the data keys are locked with a master key.
        Re-wrapping moves the data keys to the active master key so an old master key can be retired. Nothing is re-encrypted and nothing is unavailable while it runs.
      </p>
      <table className="table" aria-label="Keys">
        <thead>
          <tr><th scope="col">Master key</th><th scope="col">Data keys</th><th scope="col">Stored files</th><th scope="col">Status</th></tr>
        </thead>
        <tbody>
          {versions.map((v) => {
            const left = at(v);
            const label = v === active ? { text: 'Active', tone: 'pos' } : left > 0 ? { text: 'In use', tone: 'warn' } : { text: 'Not needed', tone: 'neutral' };
            return (
              <tr key={v}>
                <th scope="row">Version {v}</th>
                <td>{count(rows.dataKey[String(v)] ?? 0)}</td>
                <td>{count(rows.storedObject[String(v)] ?? 0)}</td>
                <td><span className={`pill ${label.tone}`}>{label.text}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="bar">
        <button type="button" className="btn primary" disabled={busy || running || blocked !== ''} onClick={() => void start()}>Re-wrap now</button>
        <p className="hint" role="status" aria-live="polite">
          {run.state === 'running' && `Re-wrapping: ${count(run.done)} of ${count(run.total)} done.`}
          {run.state === 'done' && `Done. ${count(run.done)} keys now use master key version ${active}. Remove an old key from the server settings once it shows Not needed.`}
          {run.state === 'failed' && 'The re-wrap stopped early. Press Re-wrap now to continue where it left off.'}
          {run.state !== 'running' && run.state !== 'done' && run.state !== 'failed' && blocked}
        </p>
      </div>
    </div>
  );
}
