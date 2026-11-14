import { useEffect, useRef, useState, type KeyboardEvent as ReactKey } from 'react';

/** The original photo, fetched only while this is open. Esc closes (and goes no further, so the shell does not also act on it); arrows move within bounds; Tab stays inside. A failed photo says so and can be retried. */
export function Lightbox({ src, index, total, onMove, onClose }: { src: string; index: number; total: number; onMove: (d: -1 | 1) => void; onClose: () => void }) {
  const [tries, setTries] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setTries(0); setFailed(false); }, [src]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.querySelector<HTMLElement>('button')?.focus(), []);
  // Previous and Next switch off at the ends; if the one holding focus did, move focus to a button that still works instead of losing it to the page.
  useEffect(() => {
    const at = document.activeElement as HTMLButtonElement | null;
    if (!box.current?.contains(at) || at?.disabled) box.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  }, [index]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && index > 0) onMove(-1);
      else if (e.key === 'ArrowRight' && index < total - 1) onMove(1);
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, [onClose, onMove, index, total]);

  const trap = (e: ReactKey) => {
    if (e.key !== 'Tab') return;
    const all = [...(box.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])];
    const end = e.shiftKey ? all[0] : all[all.length - 1];
    if (document.activeElement === end) {
      e.preventDefault();
      (e.shiftKey ? all[all.length - 1] : all[0])?.focus();
    }
  };

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={`Photo ${index + 1} of ${total}`} ref={box} onKeyDown={trap}>
      <div className="lightbox-bar">
        <button type="button" className="btn" onClick={onClose}>Close</button>
        <button type="button" className="btn" disabled={index === 0} onClick={() => onMove(-1)}>Previous</button>
        <button type="button" className="btn" disabled={index === total - 1} onClick={() => onMove(1)}>Next</button>
      </div>
      {failed ? (
        <div role="alert" className="failed">
          <p className="error">This photo couldn't be loaded.</p>
          <button type="button" className="btn" onClick={() => { setFailed(false); setTries(tries + 1); }}>Retry</button>
        </div>
      ) : (
        <img src={`${src}?r=${tries}`} alt={`Photo ${index + 1} of ${total}`} onError={() => setFailed(true)} />
      )}
    </div>
  );
}
