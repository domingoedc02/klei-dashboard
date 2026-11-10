import { useEffect, useState } from 'react';
import { NAV, type RouteId } from './permissions';

const IDS: readonly string[] = NAV.map((n) => n.id);

const parts = () => window.location.hash.replace(/^#\//, '').split('/');

function read(): RouteId {
  const h = parts()[0];
  return (IDS.includes(h) ? h : 'dashboard') as RouteId;
}

const routeOf = (hash: string) => hash.replace(/^#\//, '').split('/')[0];

// The hash the screen shows. While a guard is set, a hash change to another screen is undone and handed to the guard, which calls `leave` to repeat it.
let settled = '';
let guard: ((leave: () => void) => void) | null = null;

/** Story 11.6: set while the screen holds work that a move to another screen would lose; `null` removes it. */
export function setLeaveGuard(g: ((leave: () => void) => void) | null) {
  guard = g;
  settled = window.location.hash;
}

function allowed(): boolean {
  const next = window.location.hash;
  if (!guard || routeOf(next) === routeOf(settled)) {
    settled = next;
    return true;
  }
  const ask = guard;
  const back = settled;
  window.history.replaceState(null, '', back);
  ask(() => {
    settled = next;
    window.location.hash = next;
  });
  return false;
}

function useHash<T>(pick: () => T): T {
  const [v, set] = useState(pick);
  useEffect(() => {
    const on = () => {
      if (allowed()) set(pick());
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}

export const useRoute = (): RouteId => useHash(read);

// shortcut: at most two arguments after the screen (#/gallery/{id}, #/inquiries/client/{id}); a deeper tree arrives with the first screen that needs it.
export const useRouteArg = (n = 1): string | null => useHash(() => parts()[n] || null);
