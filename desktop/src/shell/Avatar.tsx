import { useState } from 'react';
import { avatarUrl } from '../platform';

const initials = (name: string) => {
  const w = name.trim().split(/\s+/).filter(Boolean);
  const first = (x = '') => String.fromCodePoint(x.codePointAt(0) ?? 32).trim();
  return (w.length > 1 ? first(w[0]) + first(w[w.length - 1]) : first(w[0])).toUpperCase();
};

/** The person's photo when `revision` is given (only the signed-in User's own is served), else their initials (first letter of the first and last word). */
export function Avatar({ name, revision, large, small }: { name: string; revision?: number | null; large?: boolean; small?: boolean }) {
  const [broken, setBroken] = useState<number | null>(null);
  const cls = large ? 'avatar large' : small ? 'avatar small' : 'avatar';
  if (revision && broken !== revision) return <img className={cls} src={avatarUrl(revision)} alt="" onError={() => setBroken(revision)} />;
  return <span className={cls} aria-hidden="true">{initials(name)}</span>;
}
