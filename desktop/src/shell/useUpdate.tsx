import { useCallback, useEffect, useRef, useState } from 'react';
import { asBridgeError, bridge } from '../bridge';
import type { DialogSpec } from './context';

const DAY_MS = 24 * 60 * 60 * 1000;
export const UNVERIFIED = "The update couldn't be verified. Nothing was changed.";
export const DIRTY = 'You have unsent work. Finish or discard it first.';

export interface UpdateView {
  /** The version waiting, or null when there is none or the User chose Later. */
  ready: string | null;
  failed: boolean;
  installing: boolean;
  install(): void;
  later(): void;
  check(manual: boolean): Promise<void>;
}

/** FR-43: look when the window opens and every 24 h; a failed look stays quiet unless the User asked for it. */
export function useUpdate(toast: (text: string, kind?: 'info' | 'error') => void, openDialog: (spec: DialogSpec) => void): UpdateView {
  const [found, setFound] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [failed, setFailed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const looking = useRef(false);

  const check = useCallback(async (manual: boolean) => {
    if (looking.current) return;
    looking.current = true;
    try {
      const r = await bridge.checkUpdate();
      if (r.status === 'available') { setFound(r.version); setHidden(false); setFailed(false); }
      else { setFound(null); if (manual) toast("You're on the latest version."); }
    } catch {
      if (manual) toast("Couldn't check for updates. Try again later.", 'error');
    } finally {
      looking.current = false;
    }
  }, [toast]);

  useEffect(() => {
    void check(false);
    const h = setInterval(() => void check(false), DAY_MS);
    return () => clearInterval(h);
  }, [check]);

  const install = useCallback(() => {
    setInstalling(true);
    setFailed(false);
    bridge.installUpdate().then(
      () => setInstalling(false),
      (e) => {
        setInstalling(false);
        const kind = asBridgeError(e).kind;
        if (kind === 'update_refused') {
          openDialog({
            title: "Can't install yet",
            custom: (close) => (
              <>
                <div className="lede">{DIRTY}</div>
                <div className="actions"><button type="button" className="btn primary" onClick={close}>OK</button></div>
              </>
            ),
          });
        } else if (kind === 'update_unverified') {
          setFailed(true);
        } else {
          toast("Couldn't install the update. Try again later.", 'error');
        }
      },
    );
  }, [openDialog, toast]);

  return { ready: hidden ? null : found, failed, installing, install, later: () => setHidden(true), check };
}
