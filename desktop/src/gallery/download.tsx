import { useCallback, useEffect, useRef, useState } from 'react';
import { asBridgeError, bridge, type ExportProgress } from '../bridge';
import { useShell } from '../shell/context';

/** FR-17: one Download .zip at a time. The file is written by the shell where the person chose; this only starts, shows and stops it. */
export function useDownload() {
  const shell = useShell();
  const toast = useRef(shell.toast);
  toast.current = shell.toast;
  const alive = useRef(true);
  const busy = useRef(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => () => { alive.current = false; }, []);

  /** Resolves true when the archive was saved. */
  const start = useCallback(async (ids: string[]): Promise<boolean> => {
    if (busy.current || ids.length === 0) return false;
    busy.current = true;
    setRunning(true);
    setProgress(null);
    try {
      const out = await bridge.exportGowns('start', ids, (e) => { if (alive.current) setProgress(e); });
      if (out.cancelled) return false;
      toast.current('Download saved');
      return true;
    } catch (e) {
      const kind = asBridgeError(e).kind;
      if (kind === 'too_large') toast.current('Too many to download at once. Select fewer.', 'error');
      else if (kind === 'no_access') toast.current('You no longer have access to the gallery.', 'error');
      else toast.current('Download failed. Try again.', 'error');
      return false;
    } finally {
      busy.current = false;
      if (alive.current) { setRunning(false); setProgress(null); }
    }
  }, []);

  const cancel = useCallback(() => { void bridge.exportGowns('cancel', []).catch(() => undefined); }, []);

  return { running, progress, start, cancel };
}

export function DownloadStatus({ running, progress, cancel }: { running: boolean; progress: ExportProgress | null; cancel: () => void }) {
  if (!running) return null;
  return (
    <div className="download" role="status">
      <span>{progress && progress.total > 1 ? `Downloading ${progress.done} of ${progress.total} gowns…` : 'Downloading…'}</span>
      <progress aria-label="Download progress" max={progress?.total || 1} value={progress?.done ?? 0} />
      <button type="button" className="btn" onClick={cancel}>Cancel download</button>
    </div>
  );
}
