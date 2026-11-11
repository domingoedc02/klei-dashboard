import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKey, type ReactNode } from 'react';
import { asBridgeError, bridge, type ApiResponse } from '../bridge';
import { Avatar } from './Avatar';
import { Bell } from './Bell';
import { SearchBox } from './SearchBox';
import { useConnection } from './connection';
import { setFormatPrefs, type Prefs } from '../format';
import { ShellCtx, type DialogSpec, type Me, type ShellApi, type ToastAction } from './context';
import { Assistant } from '../assistant/Assistant';
import { ASSISTANT_NEEDS, NAV, allows, startRoute, type RouteId } from './permissions';
import { useRoute, useRouteArg } from './route';
import { UNVERIFIED, useUpdate } from './useUpdate';
import { Icon } from './icons';
import { Forbidden, Pill } from './ui';
import { Dashboard } from '../dashboard/Dashboard';
import { Gallery } from '../gallery/Gallery';
import { Inquiries } from '../inquiries/Inquiries';
import { INQUIRY_EVENT, POLL_MS } from '../inquiries/events';
import { Viewer } from '../gallery/Viewer';
import { Settings } from '../settings/Settings';
import { Upload } from '../upload/Upload';

const ME = '/api/v1/me';
const MAX_TOASTS = 3;
const TOAST_MS = 3200;
const UNDO_MS = 8000;

interface Toast { id: number; text: string; kind: 'info' | 'error'; action?: ToastAction }
interface Drawer { title: string; content: ReactNode; avatar?: boolean }

async function ping(): Promise<boolean> {
  try {
    return (await bridge.request('GET', '/health/ready')).status === 200;
  } catch {
    return false;
  }
}

function ToastItem({ t, dismiss }: { t: Toast; dismiss: (id: number) => void }) {
  useEffect(() => {
    if (t.kind === 'error') return;
    const h = setTimeout(() => dismiss(t.id), t.action ? UNDO_MS : TOAST_MS);
    return () => clearTimeout(h);
  }, [t.id, t.kind, t.action, dismiss]);
  return (
    <div role={t.kind === 'error' ? 'alert' : undefined} className={`toast ${t.kind}`}>
      {t.kind === 'info' && <Icon name="check" />}
      <span className="toast-text">{t.text}</span>
      {t.action && <button type="button" className="link" onClick={() => { dismiss(t.id); t.action?.run(); }}>{t.action.label}</button>}
      <button type="button" className="link" aria-label="Dismiss" onClick={() => dismiss(t.id)}>×</button>
    </div>
  );
}

function DialogHost({ spec, close }: { spec: DialogSpec; close: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    if (spec.custom) box.current?.querySelector<HTMLElement>('input, select, button')?.focus();
    else (spec.confirm.danger ? cancel : ok).current?.focus();
    return () => opener?.focus?.();
  }, [spec]);
  const trap = (e: ReactKey) => {
    if (e.key !== 'Tab' || !box.current) return;
    const all = [...box.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)')];
    const edge = e.shiftKey ? all[0] : all[all.length - 1];
    if (document.activeElement === edge) {
      e.preventDefault();
      (e.shiftKey ? all[all.length - 1] : all[0]).focus();
    }
  };
  return (
    <div className="scrim">
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="dlg-t" className="dialog" onKeyDown={trap}>
        <h2 id="dlg-t">{spec.title}</h2>
        {spec.custom ? spec.custom(close) : <>
        <div className="lede">{spec.body}</div>
        <div className="actions">
          <button ref={cancel} type="button" className="btn" onClick={close}>{spec.cancel ?? 'Cancel'}</button>
          <button
            ref={ok}
            type="button"
            className={spec.confirm.danger ? 'btn danger' : 'btn primary'}
            onClick={() => { close(); spec.confirm.run(); }}
          >
            {spec.confirm.label}
          </button>
        </div>
        </>}
      </div>
    </div>
  );
}

function DrawerHost({ drawer, close }: { drawer: Drawer; close: () => void }) {
  const x = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    x.current?.focus();
    return () => opener?.focus?.();
  }, []);
  return (
    <aside className="drawer" aria-label={drawer.title}>
      <header>
        {drawer.avatar && <span className="drawer-av" aria-hidden="true"><Icon name="spark" /></span>}
        <h2>{drawer.title}</h2>
        <button ref={x} type="button" className="link" aria-label="Close" onClick={close}>×</button>
      </header>
      <div>{drawer.content}</div>
    </aside>
  );
}

export function Shell({ me: first, onExpired, onSignOut, children }: { me: Me; onExpired: (noAccess?: boolean) => void; onSignOut: () => void; children?: ReactNode }) {
  const route = useRoute();
  const arg = useRouteArg();
  const [me, setMe] = useState(first);
  const reloading = useRef(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [menu, setMenu] = useState(false);
  const [forbidden, setForbidden] = useState<RouteId | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const view = useRef<HTMLElement>(null);
  const menuBox = useRef<HTMLDivElement>(null);
  const next = useRef(0);
  const here = useRef(route);
  here.current = route;
  // Dates drawn by the screens below read this in the same render pass.
  setFormatPrefs(me.preferences);

  // Sign-in lands on the chosen start page; a hash the User already has (a reload, a link) is left alone.
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current) return;
    landed.current = true;
    if (window.location.hash && window.location.hash !== '#' && window.location.hash !== '#/') return;
    const to = startRoute(me.preferences?.startPage, me.permissions);
    if (to !== 'dashboard') window.location.replace(`#/${to}`);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toast = useCallback((text: string, kind: 'info' | 'error' = 'info', action?: ToastAction) => {
    setToasts((all) => {
      let kept = all;
      if (all.length >= MAX_TOASTS) {
        const drop = all.find((t) => t.kind === 'info') ?? all[0];
        kept = all.filter((t) => t !== drop);
      }
      return [...kept, { id: ++next.current, text, kind, action }];
    });
  }, []);
  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);

  // One dialog at a time: a second request while one is open is dropped.
  const openDialog = useCallback((spec: DialogSpec) => setDialog((d) => d ?? spec), []);
  const update = useUpdate(toast, openDialog);
  const checkForUpdates = useCallback(() => update.check(true), [update.check]); // eslint-disable-line react-hooks/exhaustive-deps

  const { offline, report } = useConnection(ping, useCallback(() => toast('Back online'), [toast]));

  const request = useCallback(
    async <T,>(method: string, path: string, body?: unknown, ifMatch?: number, idempotencyKey?: string): Promise<ApiResponse<T>> => {
      let r: ApiResponse<T>;
      try {
        r = await bridge.request<T>(method, path, body, ifMatch, idempotencyKey);
      } catch (e) {
        const kind = asBridgeError(e).kind;
        if (kind === 'offline' || kind === 'timeout') report();
        if (kind === 'session_expired' || kind === 'signed_out') onExpired();
        if (kind === 'no_access') onExpired(true);
        throw e;
      }
      if (r.refreshed && path !== ME && !reloading.current) {
        // A refresh means the permission epoch moved: take the new Permissions so the sidebar and routes follow.
        reloading.current = true;
        void bridge.request<Me>('GET', ME)
          .then((m) => { if (m.status === 200 && m.body) setMe(m.body); })
          .catch(() => {})
          .finally(() => { reloading.current = false; });
      }
      if (r.status === 502 || r.status === 503) report();
      if (r.status === 403) setForbidden(here.current);
      return r;
    },
    [report, onExpired],
  );

  const reloadMe = useCallback(async () => {
    try {
      const m = await bridge.request<Me>('GET', ME);
      if (m.status === 200 && m.body) setMe(m.body);
    } catch { /* the top bar keeps the last good name */ }
  }, []);

  const applyPreferences = useCallback((p: Prefs) => setMe((m) => ({ ...m, preferences: p })), []);

  useEffect(() => setForbidden(null), [route]);

  // The sidebar badge: New and unread Inquiries, read every 30 s while the User may reply (FR-24).
  const [unread, setUnread] = useState(0);
  const replies = allows(me.permissions, ['PERM_REPLY']);
  useEffect(() => {
    if (!replies) return;
    let live = true;
    const read = async () => {
      try {
        const r = await bridge.request<{ count?: number }>('GET', '/api/v1/inquiries/count');
        if (live && r?.status === 200) setUnread(r.body?.count ?? 0);
      } catch { /* the connection banner already shows it */ }
    };
    void read();
    const h = setInterval(read, POLL_MS);
    window.addEventListener(INQUIRY_EVENT, read);
    return () => { live = false; clearInterval(h); window.removeEventListener(INQUIRY_EVENT, read); };
  }, [replies, route]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (menu) setMenu(false);
        else if (dialog) setDialog(null);
        else if (drawer) setDrawer(null);
        return;
      }
      const inField = (e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
      if (!inField && (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'))) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [menu, dialog, drawer]);

  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => {
      if (!menuBox.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [menu]);

  const api = useMemo<ShellApi>(
    () => ({
      me,
      offline,
      can: (any) => allows(me.permissions, any),
      request,
      toast,
      openDialog,
      openDrawer: (title, content) => setDrawer({ title, content }),
      closeDrawer: () => setDrawer(null),
      reloadMe,
      applyPreferences,
      checkForUpdates,
      setDirty: (dirty) => { bridge.setDirty(dirty).catch(() => {}); },
    }),
    [me, offline, request, toast, openDialog, reloadMe, applyPreferences, checkForUpdates],
  );

  const items = NAV.filter((n) => allows(me.permissions, n.any));
  const current = NAV.find((n) => n.id === route)!;
  const denied = forbidden === route || !allows(me.permissions, current.any);

  return (
    <ShellCtx.Provider value={api}>
      <div className="app">
        {/* The hash is the router, so the link must not navigate: it only moves focus. */}
        <a className="skip" href="#view" onClick={(e) => { e.preventDefault(); view.current?.focus(); }}>Skip to main content</a>
        <header className="topbar">
          <SearchBox ref={search} />
          <div className="tools">
            {allows(me.permissions, ASSISTANT_NEEDS) && (
              <button
                type="button"
                className="btn"
                onClick={() => setDrawer({ title: 'AI Assistant', avatar: true, content: <Assistant /> })}
              >
                AI Assistant
              </button>
            )}
            <Bell />
            <div ref={menuBox} className="profile">
              <button type="button" className="btn profile-btn" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
                <Avatar name={me.name ?? ''} revision={me.avatar} />{me.name}
              </button>
              {menu && (
                <div role="menu" className="menu">
                  <p className="who">{me.name}<br /><span className="hint">{me.role}</span></p>
                  <a role="menuitem" href="#/settings/profile" onClick={() => setMenu(false)}>Profile settings</a>
                  <button role="menuitem" type="button" onClick={() => { setMenu(false); onSignOut(); }}>Sign out</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <div className="sidebar">
          <div className="brand"><span className="brand-mark" aria-hidden="true">K</span><span className="brand-name">Klei Bridal</span></div>
          <nav aria-label="Main">
            <span className="eyebrow">Workspace</span>
            {items.map((n) => (
              <a key={n.id} href={`#/${n.id}`} aria-current={n.id === route ? 'page' : undefined}>
                <Icon name={n.icon} large />
                <span>{n.label}</span>
                {n.id === 'inquiries' && unread > 0 && <Pill tone="info">{unread} new</Pill>}
              </a>
            ))}
          </nav>
        </div>
        <main id="view" ref={view} tabIndex={-1} className="sheet">
          {update.failed && <div role="alert" className="banner update bad">{UNVERIFIED}</div>}
          {update.ready && (
            <div role="status" className="banner update">
              <span>Version {update.ready} is ready.</span>
              <button type="button" className="btn primary" disabled={update.installing} onClick={update.install}>Install and restart</button>
              <button type="button" className="btn" disabled={update.installing} onClick={update.later}>Later</button>
            </div>
          )}
          {offline && <div role="status" className="banner">Offline. Reconnecting…</div>}
          {denied ? <Forbidden /> : route === 'settings' ? <Settings /> : route === 'upload' ? <Upload /> : route === 'gallery' ? (arg ? <Viewer id={arg} /> : <Gallery />) : route === 'inquiries' ? <Inquiries /> : <Dashboard />}
        </main>
        {drawer && <DrawerHost drawer={drawer} close={() => setDrawer(null)} />}
        {dialog && <DialogHost spec={dialog} close={() => setDialog(null)} />}
        {/* shortcut: the status role is on only while a toast shows; an always-present region would break every single-status query in the screen tests. */}
        <div className="toasts" role={toasts.length > 0 ? 'status' : undefined} aria-live="polite">
          {toasts.map((t) => <ToastItem key={t.id} t={t} dismiss={dismiss} />)}
        </div>
        {children}
      </div>
    </ShellCtx.Provider>
  );
}
