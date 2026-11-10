import type { components } from '../api/schema';
import { formatDateTime } from '../format';
import { useShell } from '../shell/context';

export type Status = components['schemas']['StatusView'];

export const STEPS = ['Reading', 'Grouping', 'Tagging', 'Writing'] as const;

const CAUSE: Record<string, string> = {
  not_configured: "AI isn't set up yet. An admin can add the provider in Settings.",
  unauthorized: 'The AI provider refused the key. An admin can check it in Settings.',
  refused: 'The AI address is not allowed. An admin can check it in Settings.',
  timed_out: 'The AI provider took too long to answer.',
  unreachable: "The AI provider couldn't be reached.",
  interrupted: 'The app server restarted while grouping.',
  busy: 'Too many batches are being grouped. Try again in a minute.',
  bad_response: "The AI provider's answer could not be read.",
  http_error: 'The AI provider returned an error.',
  too_large: 'The AI provider sent back too much data.',
};

const when = (t?: string | number | null) => (t ? formatDateTime(t) : null);

/** What each step does, in the words of the prototype. [STEPS] stays the short name `Stopped` and the Dashboard show. */
export function stepLabel(n: number, total: number): string {
  if (n === 1) return `Reading ${total} ${total === 1 ? 'photo' : 'photos'}`;
  return ['Grouping images of the same gown', 'Tagging silhouette, fabric, neckline', 'Writing descriptions'][n - 2] ?? '';
}

/** The share of the whole run that is done: four equal steps, the current one by its own count. */
export function overallPct(step: number, done: number, total: number): number {
  return Math.floor((100 * (step - 1 + Math.min(done / Math.max(total, 1), 1))) / STEPS.length);
}

/** U1: the four steps with the current one marked and earlier ones checked; one bar for the whole run. */
export function Processing({ status, photos, onDiscarded }: { status: Status; photos: number; onDiscarded: () => void }) {
  const { request, toast, openDialog } = useShell();
  const step = status.step ?? 1;
  const total = status.total ?? 0;
  const pct = overallPct(step, status.done ?? 0, total);
  const cancel = () =>
    openDialog({
      title: 'Cancel grouping?',
      body: `This removes the ${photos} ${photos === 1 ? 'photo' : 'photos'} from this batch. You can upload them again.`,
      cancel: 'Keep grouping',
      confirm: {
        label: 'Cancel and remove photos',
        danger: true,
        run: async () => {
          try {
            const r = await request('DELETE', `/api/v1/uploads/${status.id}`);
            if (r.status === 204 || r.status === 404) {
              toast('Batch discarded');
              onDiscarded();
            } else toast("Couldn't cancel grouping. Try again.", 'error');
          } catch {
            toast("Couldn't cancel grouping. Try again.", 'error');
          }
        },
      },
    });
  return (
    <div className="processing">
      <div className="proc-head">
        <h2>AI is grouping images</h2>
        <span className="pct">{pct}%</span>
      </div>
      <ol className="steps" aria-label="Grouping steps">
        {STEPS.map((name, i) => {
          const n = i + 1;
          const state = n < step ? 'done' : n === step ? 'current' : 'todo';
          return (
            <li key={name} className={state} aria-current={state === 'current' ? 'step' : undefined}>
              <span aria-hidden="true" className="mark">{state === 'done' ? '✓' : state === 'current' ? '●' : '○'}</span>
              {stepLabel(n, total)}
              {state === 'done' && <span className="sr-only"> (done)</span>}
            </li>
          );
        })}
      </ol>
      <progress aria-label="Overall progress" max={100} value={pct} />
      <div className="proc-grid" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton" />)}
      </div>
      <p className="hint">You can leave this screen. Progress shows on the Dashboard.</p>
      <p className="hint">Photo thumbnails are sent to your AI provider.</p>
      <div className="actions">
        <button type="button" className="btn" onClick={cancel}>Cancel</button>
      </div>
    </div>
  );
}

/** Retry resumes from the failed step; photos that already have a vector are not read again. */
export function Stopped({ status, onRetry, retrying }: { status: Status; onRetry: () => void; retrying: boolean }) {
  const e = status.error;
  const last = when(e?.lastGood);
  const step = e?.step ?? 1;
  return (
    <div role="alert" className="failed">
      <p className="error">
        Grouping stopped at step {step} ({STEPS[step - 1] ?? 'Grouping'}).{last ? ` Last good ${last}.` : ''}
      </p>
      <p className="hint">{CAUSE[e?.code ?? ''] ?? "The AI provider didn't answer as expected."}</p>
      <button type="button" className="btn primary" disabled={retrying} onClick={onRetry}>Retry</button>
    </div>
  );
}
