import { useCallback, useEffect, useRef, useState } from 'react';
import type { components } from '../api/schema';
import { formatDate } from '../format';
import { gownFullUrl, gownThumbUrl } from '../platform';
import { useShell } from '../shell/context';
import { Icon } from '../shell/icons';
import { Lightbox } from '../shell/Lightbox';
import { ErrorBlock, Pill, type PillTone } from '../shell/ui';
import { DownloadStatus, useDownload } from './download';
import { EditGown } from './EditGown';
import { deleteOneSpec, removeGowns } from './remove';

type Detail = components['schemas']['GownDetail'];
type View = { status: 'loading' } | { status: 'error' } | { status: 'missing' } | { status: 'ready'; gown: Detail };

const BAND: Record<string, [label: string, tone: string]> = { high: ['High', 'pos'], medium: ['Medium', 'warn'], low: ['Low · check', 'neg'] };

const added = formatDate;

/** G2 (FR-15): one Gown, read only. Photos on the left with a strip, the facts and the description on the right. */
export function Viewer({ id }: { id: string }) {
  const shell = useShell();
  const req = useRef(shell.request);
  req.current = shell.request;
  const toast = useRef(shell.toast);
  toast.current = shell.toast;

  const [view, setView] = useState<View>({ status: 'loading' });
  const [at, setAt] = useState(0);
  const [tries, setTries] = useState(0);
  const [failed, setFailed] = useState(false);
  const [full, setFull] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const download = useDownload();

  const load = useCallback(async () => {
    setView({ status: 'loading' });
    setAt(0);
    try {
      const r = await req.current<Detail>('GET', `/api/v1/gowns/${id}`);
      if (r.status === 200 && r.body) setView({ status: 'ready', gown: r.body });
      else setView({ status: r.status === 404 ? 'missing' : 'error' });
    } catch { setView({ status: 'error' }); /* the shell already raised the offline banner or the expiry */ }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setFailed(false); setTries(0); }, [at, id]);

  const photos = view.status === 'ready' ? view.gown.photos ?? [] : [];
  const n = photos.length;

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (full || (t && ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName))) return;
      if (e.key === 'ArrowLeft') setAt((i) => Math.max(0, i - 1));
      else if (e.key === 'ArrowRight') setAt((i) => Math.min(n - 1, i + 1));
    };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, [n, full]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.current('Description copied');
    } catch { toast.current("Couldn't copy the description.", 'error'); }
  };

  const edit = (gown: Detail) =>
    shell.openDialog({
      title: 'Edit gown',
      custom: (close) => <EditGown gown={gown} close={close} onSaved={(g) => setView({ status: 'ready', gown: g })} onReload={() => void load()} />,
    });

  const remove = (gown: Detail) =>
    shell.openDialog(deleteOneSpec(gown.name ?? 'This gown', gown.photoCount ?? 0, async () => {
      if (await removeGowns(shell, [gown.id ?? id], true)) location.hash = '#/gallery';
    }));

  const crumb = (name: string) => (
    <nav aria-label="Breadcrumb" className="crumb">
      <a href="#/gallery">Gallery</a> <Icon name="chevron" /> <span aria-current="page">{name}</span>
    </nav>
  );

  if (view.status === 'error') return <section className="viewer">{crumb('Gown')}<ErrorBlock what="this gown" onRetry={() => void load()} /></section>;
  if (view.status === 'missing') {
    return (
      <section className="viewer">
        {crumb('Gown')}
        <div className="empty">
          <p className="lede">This gown no longer exists</p>
          <a className="btn" href="#/gallery">Back to the gallery</a>
        </div>
      </section>
    );
  }
  if (view.status === 'loading') {
    return (
      <section className="viewer" aria-busy="true">
        {crumb('Loading…')}
        <div className="viewer-body" aria-hidden="true">
          <div className="skeleton stage" />
          <div className="skeleton details" />
        </div>
      </section>
    );
  }

  const g = view.gown;
  const [label, tone] = BAND[g.band ?? 'low'] ?? BAND.low;
  const attr = (type: string) => (g.attributes ?? []).find((a) => a.type === type)?.values?.join(', ') || 'None';
  const current = photos[at];

  return (
    <section className="viewer">
      {crumb(g.name ?? 'Gown')}
      <div className="viewer-body">
        <div className="photos-pane">
          <div className="stage">
            {!current ? (
              <p className="lede">This gown has no photos.</p>
            ) : failed ? (
              <div role="alert" className="failed">
                <p className="error">This photo couldn't be loaded.</p>
                <button type="button" className="btn" onClick={() => { setFailed(false); setTries(tries + 1); }}>Retry</button>
              </div>
            ) : (
              <img src={`${gownFullUrl(g.id ?? id, current.id ?? '')}?r=${tries}`} alt={`${g.name}, photo ${at + 1} of ${n}`} onError={() => setFailed(true)} />
            )}
          </div>
          {n > 0 && (
            <>
              <div className="stage-bar">
                <button type="button" className="btn" disabled={at === 0} onClick={() => setAt(at - 1)}>Previous</button>
                <span aria-live="polite">{at + 1} of {n}</span>
                <button type="button" className="btn" disabled={at === n - 1} onClick={() => setAt(at + 1)}>Next</button>
                <button type="button" className="btn" onClick={(e) => { opener.current = e.currentTarget; setFull(true); }}>Full view</button>
              </div>
              <ul className="strip" aria-label="Photos">
                {photos.map((p, i) => (
                  <li key={p.id}>
                    <button type="button" aria-label={`Show photo ${i + 1} of ${n}`} aria-current={i === at ? 'true' : undefined} onClick={() => setAt(i)}>
                      <img src={gownThumbUrl(g.id ?? id, p.id ?? '')} alt="" width={64} height={64} loading="lazy" />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <aside className="details" aria-label="Details">
          <h1>{g.name}</h1>
          <div className="actions">
            {shell.can(['PERM_EDIT_GOWN']) && <button type="button" className="btn" onClick={() => edit(g)}><Icon name="edit" /> Edit</button>}
            <button type="button" className="btn" disabled={download.running} onClick={() => void download.start([g.id ?? id])}><Icon name="download" /> Download .zip</button>
            {g.description && <button type="button" className="btn" onClick={() => void copy(g.description ?? '')}><Icon name="copy" /> Copy description</button>}
            {shell.can(['PERM_DELETE_GOWN']) && <button type="button" className="btn" onClick={() => remove(g)}><Icon name="trash" /> Delete folder</button>}
          </div>
          <DownloadStatus {...download} />
          <dl className="facts">
            <dt>Silhouette</dt><dd>{attr('silhouette')}</dd>
            <dt>Fabric</dt><dd>{attr('fabric')}</dd>
            <dt>Neckline</dt><dd>{attr('neckline')}</dd>
            <dt>Sleeve</dt><dd>{attr('sleeve')}</dd>
            <dt>Train</dt><dd>{attr('train')}</dd>
            <dt>Photos</dt><dd>{g.photoCount}</dd>
            <dt>Added</dt><dd>{added(g.addedAt ?? '')}</dd>
            <dt>Confidence</dt><dd>{g.confidence}% <Pill tone={tone as PillTone}>{label}</Pill></dd>
          </dl>
          <h2>Description</h2>
          {g.description ? <p className="description">{g.description}</p> : <p className="lede">No description yet.</p>}
        </aside>
      </div>
      {full && current && (
        <Lightbox
          src={gownFullUrl(g.id ?? id, current.id ?? '')} index={at} total={n}
          onMove={(d) => setAt((i) => Math.min(n - 1, Math.max(0, i + d)))} onClose={() => { setFull(false); opener.current?.focus(); }}
        />
      )}
    </section>
  );
}
