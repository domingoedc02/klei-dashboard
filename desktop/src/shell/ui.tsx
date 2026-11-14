import type { ReactNode } from 'react';

/** Status chip. `info` blue, `pos` green, `neutral` gray, `warn` orange, `neg` red; always carries a word, never colour alone. */
export type PillTone = 'info' | 'pos' | 'neutral' | 'warn' | 'neg';
export function Pill({ tone = 'neutral', children, title }: { tone?: PillTone; children: ReactNode; title?: string }) {
  return <span className={`pill ${tone}`} title={title}>{children}</span>;
}

/** Centred illustration, heading, line and optional action; `compact` is the 144 px version for menus and panes. */
export function EmptyState({ art, title, text, compact, children }: { art: string; title: string; text: string; compact?: boolean; children?: ReactNode }) {
  return (
    <div className={`empty-state${compact ? ' compact' : ''}`}>
      <img className="illo" src={art} alt="" />
      <h2>{title}</h2>
      <p>{text}</p>
      {children}
    </div>
  );
}

export function Skeleton({ rows = 3, height = 48 }: { rows?: number; height?: number }) {
  return (
    <div aria-hidden="true" className="skeletons">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height }} />
      ))}
    </div>
  );
}

/** The one place a failed read is shown: what failed, when data was last good, Retry. */
export function ErrorBlock({ what, lastGood, onRetry }: { what: string; lastGood?: string; onRetry: () => void }) {
  return (
    <div role="alert" className="failed">
      <p className="error">Couldn't load {what}.</p>
      {lastGood && <p className="hint">Last updated {lastGood}</p>}
      <button type="button" className="link" onClick={onRetry}>Retry</button>
    </div>
  );
}

export function Forbidden() {
  return (
    <div className="failed">
      <h1>You don't have access</h1>
      <p className="lede">Your role doesn't include this page. Ask an admin if you need it.</p>
      <a className="btn" href="#/dashboard">Back to Dashboard</a>
    </div>
  );
}

export function Sheet({ title, className, children }: { title: string; className?: string; children?: ReactNode }) {
  return (
    <section className={className}>
      <h1>{title}</h1>
      {children}
    </section>
  );
}
