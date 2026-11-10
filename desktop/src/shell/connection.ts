import { useCallback, useEffect, useState } from 'react';

export const PING_MS = 5000;

/** Offline flag plus the 5 s health poll that runs only while offline. `ping` resolves true when the server answers ready. */
export function useConnection(ping: () => Promise<boolean>, onBack: () => void) {
  const [offline, setOffline] = useState(false);
  const report = useCallback(() => setOffline(true), []);
  useEffect(() => {
    if (!offline) return;
    let live = true;
    let busy = false;
    const timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      const up = await ping();
      busy = false;
      if (up && live) {
        setOffline(false);
        onBack();
      }
    }, PING_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [offline, ping, onBack]);
  return { offline, report };
}
