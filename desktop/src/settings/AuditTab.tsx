import { useCallback, useEffect, useRef, useState } from 'react';
import art from '../assets/empty/empty-gown-3.png';
import type { components } from '../api/schema';
import { formatDateTime } from '../format';
import { useShell } from '../shell/context';
import { ErrorBlock, Skeleton } from '../shell/ui';

type Row = Required<Pick<components['schemas']['AuditRow'], 'id' | 'ts' | 'actor' | 'action'>> & { detail?: string | null; ip?: string | null };
interface Page { items: Row[]; page: number; pages: number }

const ACTIONS: Record<string, string> = {
  sign_in_locked: 'Sign-in locked',
  sign_in_no_access: 'Sign-in refused, no access',
  refresh_reuse: 'Session ended, token reused',
  forbidden: 'Request refused',
  bootstrap_admin: 'First admin created',
  user_invited: 'Invited staff',
  user_invite_resent: 'Invite resent',
  user_updated: 'Staff edited',
  user_role_changed: 'Staff role changed',
  user_deleted: 'Staff deleted',
  email_verified: 'Email verified',
  password_reset: 'Password reset',
  password_changed: 'Password changed',
  role_permissions_changed: 'Role permissions changed',
  ai_settings_changed: 'AI settings changed',
  taxonomy_changed: 'Tag taxonomy changed',
  upload_saved: 'Upload saved',
  upload_discarded: 'Upload discarded',
  gown_edited: 'Gown edited',
  gown_deleted: 'Gown deleted',
  inquiry_status_changed: 'Inquiry status changed',
  reply_sent: 'Reply sent',
  key_rotation: 'Keys re-wrapped',
  away_changed: 'Away message changed',
  twofa_enabled: 'Two-factor turned on',
  twofa_disabled: 'Two-factor turned off',
  twofa_reset: 'Two-factor reset by an admin',
  sign_in_twofa_failed: 'Sign-in code refused',
};

const when = formatDateTime;

export function AuditTab() {
  const shell = useShell();
  const req = useRef(shell.request);
  req.current = shell.request;
  const [state, setState] = useState<'loading' | 'error' | Page>('loading');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (page: number) => {
    setBusy(true);
    try {
      const r = await req.current<components['schemas']['AuditPage']>('GET', `/api/v1/admin/audit?page=${page}`);
      if (r.status === 200 && r.body) {
        setState({ items: (r.body.items ?? []) as Row[], page: r.body.page ?? page, pages: r.body.pages ?? 1 });
        return;
      }
    } catch { /* the shell already raised the offline banner or the expiry */ } finally { setBusy(false); }
    setState((cur) => (typeof cur === 'object' ? cur : 'error'));
  }, []);

  useEffect(() => { void load(1); }, [load]);

  if (state === 'loading') return <Skeleton rows={6} height={40} />;
  if (state === 'error') return <ErrorBlock what="the audit log" onRetry={() => { setState('loading'); void load(1); }} />;

  const { items, page, pages } = state;
  if (items.length === 0 && page === 1) return (
      <div className="empty">
        <img src={art} alt="" width={160} />
        <p className="lede">No activity yet</p>
      </div>
    );

  return (
    <div>
      <table className="table" aria-label="Audit log">
        <thead>
          <tr><th scope="col">Time</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col">IP</th></tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id}>
              <td>{when(r.ts)}</td>
              <td>{r.actor}</td>
              <td>
                {ACTIONS[r.action] ?? r.action}
                {r.detail && <span className="lede">{r.detail}</span>}
              </td>
              <td>{r.ip ?? '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <nav className="bar pager" aria-label="Audit pages">
        <button type="button" className="link" disabled={busy || page <= 1} onClick={() => void load(page - 1)}>Previous</button>
        <span aria-live="polite">Page {page} of {pages}</span>
        <button type="button" className="link" disabled={busy || page >= pages} onClick={() => void load(page + 1)}>Next</button>
      </nav>
    </div>
  );
}
