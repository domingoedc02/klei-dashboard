import { useCallback, useEffect, useRef, useState } from 'react';
import type { components } from '../api/schema';
import { asBridgeError, bridge, type RejectReason, type UploadEvent, type UploadKind, type UploadProgress } from '../bridge';
import art from '../assets/empty/empty-gown-3.png';
import { thumbUrl } from '../platform';
import { useShell } from '../shell/context';
import { ErrorBlock, Skeleton } from '../shell/ui';
import { Processing, Stopped, type Status } from './Processing';
import { Review } from './Review';

type Batch = components['schemas']['BatchView'];
type Rejection = { name: string; reason: RejectReason };

const MAX_PHOTOS = 200;
const WHY: Record<RejectReason, string> = {
  type: 'Not a JPEG, PNG or WebP',
  size: 'Over 25 MB',
  full: `Batch is full: ${MAX_PHOTOS} photos`,
  dimensions: 'Image is too large: over 40 megapixels',
  unreadable: "Couldn't read the file",
};

const HEAD = (
  <header className="upload-head">
    <h1>AI Upload</h1>
    <p className="hint">Drop photos. AI groups the same gown, tags it, and drafts a description.</p>
  </header>
);

const BATCHES = '/api/v1/uploads';
const POLL_MS = 2000;

// shortcut: the strip lists every stored photo (at most 200) and the shell caches thumbnails; add paging if the batch limit grows.
export function Upload() {
  const shell = useShell();
  const { request, toast, setDirty } = shell;
  const [batch, setBatch] = useState<{ id: string; ids: string[] } | 'loading' | 'failed'>('loading');
  const [status, setStatus] = useState<Status | null>(null);
  const [loads, setLoads] = useState(0);
  const [starting, setStarting] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [rejected, setRejected] = useState<Rejection[]>([]);
  const [over, setOver] = useState(false);
  const alive = useRef(true);
  const busy = useRef(false);
  const batchId = useRef<string | null>(null);
  const phase = status?.phase ?? 'empty';
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const load = useCallback(async () => {
    setBatch('loading');
    try {
      let r = await request<Batch>('GET', `${BATCHES}/current`);
      if (r.status === 404) r = await request<Batch>('POST', BATCHES);
      if (!alive.current) return;
      if ((r.status === 200 || r.status === 201) && r.body?.id) {
        batchId.current = r.body.id;
        setBatch({ id: r.body.id, ids: r.body.photoIds ?? [] });
        const p = r.body.phase ?? 'empty';
        if (p === 'empty') setStatus(null);
        else {
          const s = await request<Status>('GET', `${BATCHES}/${r.body.id}`);
          if (alive.current && s.status === 200 && s.body) { setStatus(s.body); setLoads((n) => n + 1); }
        }
      } else if (r.status !== 403) setBatch('failed');
    } catch {
      if (alive.current) setBatch('failed');
    }
  }, [request]);

  const addIds = useCallback((add: string[]) => {
    setBatch((b) => (typeof b === 'object' ? { ...b, ids: [...b.ids, ...add.filter((id) => !b.ids.includes(id))] } : b));
  }, []);

  const send = useCallback(
    async (kind: 'photo' | 'dropped') => {
      const id = batchId.current;
      if (!id || busy.current) return;
      busy.current = true;
      setRunning(true);
      setProgress(null);
      setDirty(true);
      try {
        const out = await bridge.uploadFiles(kind, id, (e: UploadEvent) => {
          if (e.type !== 'progress' || !alive.current) return;
          setProgress({ done: e.done, total: e.total, waiting: e.waiting, photoId: e.photoId });
          if (e.photoId) addIds([e.photoId]);
        });
        if (!alive.current) return;
        addIds(out.stored);
        setRejected(out.rejected);
        if (out.cancelled) toast(`Cancelled. ${out.stored.length} stored ${out.stored.length === 1 ? 'photo is' : 'photos are'} kept.`);
      } catch (e) {
        if (!alive.current) return;
        toast(asBridgeError(e).kind === 'no_access' ? 'You no longer have access to uploads.' : 'Upload stopped. Photos already stored are kept.', 'error');
        void load();
      } finally {
        busy.current = false;
        setDirty(false);
        if (alive.current) {
          setRunning(false);
          setProgress(null);
        }
      }
    },
    [addIds, load, setDirty, toast],
  );

  const start = useCallback(async () => {
    const id = batchId.current;
    if (!id || starting) return;
    setStarting(true);
    setRejected([]);
    try {
      const r = await request<Status>('POST', `${BATCHES}/${id}/start`);
      if (!alive.current) return;
      if (r.status === 202 && r.body) setStatus(r.body);
      else if (r.status === 422) toast('Add at least one photo before grouping.', 'error');
      else if (r.status === 409) void load();
      else toast("Couldn't start grouping. Try again.", 'error');
    } catch {
      if (alive.current) toast("Couldn't start grouping. Try again.", 'error');
    } finally {
      if (alive.current) setStarting(false);
    }
  }, [load, request, starting, toast]);

  const remove = useCallback(async (photoId: string) => {
    const id = batchId.current;
    if (!id) return;
    try {
      const r = await request('DELETE', `${BATCHES}/${id}/photos/${photoId}`);
      if (!alive.current) return;
      if (r.status === 204 || r.status === 404) setBatch((b) => (typeof b === 'object' ? { ...b, ids: b.ids.filter((x) => x !== photoId) } : b));
      else if (r.status === 409) { void load(); toast('Grouping has started. Photos can no longer be removed.', 'error'); }
      else toast("Couldn't remove the photo. Try again.", 'error');
    } catch {
      if (alive.current) toast("Couldn't remove the photo. Try again.", 'error');
    }
  }, [load, request, toast]);

  // Polls only while the screen is visible; one request in flight at a time.
  useEffect(() => {
    if (phase !== 'processing' || typeof batch !== 'object') return;
    const id = batch.id;
    let flying = false;
    const tick = async () => {
      if (flying || document.hidden) return;
      flying = true;
      try {
        const r = await request<Status>('GET', `${BATCHES}/${id}`);
        if (alive.current && r.status === 200 && r.body) setStatus(r.body);
      } catch {
        // the shell shows the connection banner; the next tick tries again
      } finally {
        flying = false;
      }
    };
    const timer = setInterval(() => void tick(), POLL_MS);
    const onVisible = () => void tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [phase, batch, request]);

  const sendRef = useRef(send);
  sendRef.current = send;

  useEffect(() => {
    alive.current = true;
    void load();
    const control = (kind: UploadKind, onEvent?: (e: UploadEvent) => void) => bridge.uploadFiles(kind, '', onEvent).catch(() => undefined);
    void control('watch', (e) => {
      if (!alive.current) return;
      if (e.type === 'drag') setOver(e.over);
      if (e.type === 'dropped') {
        setOver(false);
        if (batchId.current && !busy.current && ['empty', 'error'].includes(phaseRef.current)) void sendRef.current('dropped');
      }
    });
    return () => {
      alive.current = false;
      void control('unwatch');
    };
  }, [load]);

  if (batch === 'loading') return <section className="upload">{HEAD}<Skeleton rows={2} height={120} /></section>;
  if (batch === 'failed') return <section className="upload">{HEAD}<ErrorBlock what="the upload batch" onRetry={() => void load()} /></section>;

  const waiting = running && progress?.waiting;
  const adding = phase === 'empty' || phase === 'error';
  const canRetry = rejected.some((r) => r.reason !== 'full');
  return (
    <section className="upload">
      {HEAD}
      {phase === 'processing' && status && <Processing status={status} photos={batch.ids.length} onDiscarded={() => void load()} />}
      {phase === 'error' && status && <Stopped status={status} retrying={starting || batch.ids.length === 0} onRetry={() => void start()} />}
      {phase === 'review' && status && <Review key={loads} batchId={batch.id} groups={status.groups ?? []} onReload={() => void load()} />}
      {adding && rejected.length > 0 && (
        <div className="err-summary" role="alert">
          <b>{rejected.length === 1 ? '1 file' : `${rejected.length} files`} couldn’t be uploaded.</b>{' '}
          <ul role="list" aria-label="Files not uploaded">
            {rejected.map((r, i) => (
              <li key={`${r.name}-${i}`}><span className="name">{r.name}</span> <span className="hint">{WHY[r.reason]}</span></li>
            ))}
          </ul>
          {canRetry && <span> Remove them or convert to JPG or PNG, then retry.</span>}
        </div>
      )}
      {adding && (
        <div className={`dropzone${over ? ' over' : ''}`}>
          <div className="drop-inner">
            <img className="illo" src={art} alt="" />
            <h2>Drop gown photos here</h2>
            <p className="lede">JPG, PNG or WebP up to 25 MB each. Upload up to {MAX_PHOTOS} at once and AI groups them.</p>
            <button type="button" className="btn primary" disabled={running} onClick={() => { setRejected([]); void send('photo'); }}>
              {canRetry ? 'Retry upload' : 'Choose photos'}
            </button>
          </div>
        </div>
      )}

      {running && (
        <div className="queue">
          <p role="status">
            {progress && progress.total > 0 ? `Uploading ${progress.done} of ${progress.total}` : 'Preparing photos…'}
            {waiting && ' · Waiting for the connection. Uploads continue on their own.'}
          </p>
          <progress aria-label="Upload progress" max={progress?.total || 1} value={progress?.done ?? 0} />
          <div className="actions">
            <button type="button" className="btn" onClick={() => void bridge.uploadFiles('cancel', batch.id).catch(() => undefined)}>Cancel</button>
          </div>
        </div>
      )}

      {adding && batch.ids.length > 0 && (
        <div className="stored">
          <h2>In this batch</h2>
          <p className="hint">{batch.ids.length} of {MAX_PHOTOS} photos stored</p>
          {phase === 'empty' && !running && (
            <button type="button" className="btn primary" disabled={starting} onClick={() => void start()}>Start grouping</button>
          )}
          <ul className="strip" aria-label="Stored photos">
            {batch.ids.map((p, i) => (
              <li key={p}>
                <img src={thumbUrl(batch.id, p)} alt={`Photo ${i + 1}`} loading="lazy" width={96} height={96} />
                {!running && (
                  <button type="button" className="strip-remove" aria-label={`Remove photo ${i + 1}`} onClick={() => void remove(p)}>×</button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
