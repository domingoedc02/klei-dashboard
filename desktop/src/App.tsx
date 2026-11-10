import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { components } from './api/schema';
import { asBridgeError, bridge, type ErrorKind } from './bridge';
import { keychainLabel } from './platform';
import { Shell } from './shell/Shell';

type Me = components['schemas']['MeResponse'];
type Phase = 'booting' | 'signedOut' | 'waiting' | 'failed' | 'keychain' | 'unreachable' | 'expired' | 'noAccess' | 'signedIn';

const ON_LOAD_ERROR: Partial<Record<ErrorKind, Phase>> = {
  signed_out: 'signedOut',
  session_expired: 'expired',
  no_access: 'noAccess',
  keychain_unavailable: 'keychain',
};

function Screen({ children }: { children: ReactNode }) {
  return (
    <main className="screen">
      <div className="col">
        <p className="auth-brand"><span className="brand-mark" aria-hidden="true">K</span>Klei Bridal</p>
        <div className="auth-card">{children}</div>
      </div>
    </main>
  );
}

function Button({ primary, ...p }: { primary?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className={primary ? 'btn primary' : 'btn'} {...p} />;
}

export function App() {
  const [phase, setPhase] = useState<Phase>('booting');
  const [me, setMe] = useState<Me | null>(null);
  const attempt = useRef(0);

  const load = useCallback(async () => {
    setPhase('booting');
    try {
      const r = await bridge.request<Me>('GET', '/api/v1/me');
      if (r.status === 200 && r.body) {
        setMe(r.body);
        setPhase('signedIn');
      } else {
        setPhase('unreachable');
      }
    } catch (e) {
      setPhase(ON_LOAD_ERROR[asBridgeError(e).kind] ?? 'unreachable');
    }
  }, []);

  const signIn = useCallback(async () => {
    const mine = ++attempt.current;
    setPhase('waiting');
    try {
      await bridge.signIn();
      if (mine === attempt.current) await load();
    } catch (e) {
      if (mine !== attempt.current) return;
      const kind = asBridgeError(e).kind;
      setPhase(kind === 'keychain_unavailable' ? 'keychain' : kind === 'cancelled' ? 'signedOut' : 'failed');
    }
  }, [load]);

  const continueWithoutSaving = useCallback(async () => {
    await bridge.sessionOnly();
    await signIn();
  }, [signIn]);

  const leave = useCallback(async () => {
    attempt.current++;
    setMe(null);
    try {
      await bridge.signOut();
      setPhase('signedOut');
    } catch {
      setPhase('keychain');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  switch (phase) {
    case 'booting':
      return <Screen><p role="status" className="lede">Loading…</p></Screen>;
    case 'signedOut':
      return (
        <Screen>
          <h1>Welcome back</h1>
          <p className="lede">Sign in to manage gowns and inquiries.</p>
          <Button primary onClick={signIn}>Sign in</Button>
        </Screen>
      );
    case 'waiting':
      return (
        <Screen>
          <h1 className="sr-only">Klei Bridal</h1>
          <p role="status" className="lede">Finish signing in in your browser</p>
          <div className="actions">
            <Button onClick={signIn}>Open browser again</Button>
            <Button onClick={leave}>Cancel</Button>
          </div>
        </Screen>
      );
    case 'failed':
      return (
        <Screen>
          <h1 className="sr-only">Klei Bridal</h1>
          <p role="alert" className="error">Sign-in didn't finish. Try again.</p>
          <Button primary onClick={signIn}>Retry</Button>
        </Screen>
      );
    case 'keychain':
      return (
        <Screen>
          <h1 className="sr-only">Klei Bridal</h1>
          <p role="alert" className="error">
            Can't reach your system keychain. Klei Bridal needs it to keep you signed in.
          </p>
          <p className="hint">Check that {keychainLabel()} is unlocked.</p>
          <Button primary onClick={load}>Try again</Button>
          <Button onClick={continueWithoutSaving}>Continue without saving</Button>
          <p className="hint">You will sign in again the next time you open the app.</p>
        </Screen>
      );
    case 'unreachable':
      return (
        <Screen>
          <h1 className="sr-only">Klei Bridal</h1>
          <p role="alert" className="error">Can't reach the server. Check your connection.</p>
          <Button primary onClick={load}>Try again</Button>
        </Screen>
      );
    case 'expired':
      return (
        <Screen>
          <div role="alertdialog" aria-modal="true" aria-labelledby="exp-t" aria-describedby="exp-d" className="dialog">
            <h1 id="exp-t">Session expired</h1>
            <p id="exp-d" className="lede">You've been signed out. Sign in to continue.</p>
            <Button primary onClick={signIn}>Sign in</Button>
          </div>
        </Screen>
      );
    case 'noAccess':
      return (
        <Screen>
          <h1 className="sr-only">Klei Bridal</h1>
          <p role="alert" className="error">Your account has no access yet. Ask an admin.</p>
          <Button primary onClick={signIn}>Sign in again</Button>
        </Screen>
      );
    case 'signedIn':
      return me && <Shell me={me} onExpired={(noAccess) => { setMe(null); setPhase(noAccess ? 'noAccess' : 'expired'); }} onSignOut={leave} />;
  }
}
