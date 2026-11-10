import { useState } from 'react';
import { avatarUrl } from '../platform';

/** The person's photo when `revision` is given (only the signed-in User's own is served), else their initial. */
export function Avatar({ name, revision, large, small }: { name: string; revision?: number | null; large?: boolean; small?: boolean }) {
  const [broken, setBroken] = useState<number | null>(null);
  const cls = large ? 'avatar large' : small ? 'avatar small' : 'avatar';
  if (revision && broken !== revision) return <img className={cls} src={avatarUrl(revision)} alt="" onError={() => setBroken(revision)} />;
  return <span className={cls} aria-hidden="true">{name.trim().slice(0, 1).toUpperCase()}</span>;
}
