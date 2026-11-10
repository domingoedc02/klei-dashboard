import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import art from '../assets/empty/empty-gown-3.png';
import type { components } from '../api/schema';
import { formatDateTime } from '../format';
import { useShell } from '../shell/context';
import { ErrorBlock, Skeleton } from '../shell/ui';

type Row = Required<components['schemas']['StaffRow']>;
type Role = Required<components['schemas']['RoleRef']>;
interface Staff { items: Row[]; roles: Role[] }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LAST_ADMIN = 'A studio needs at least one admin.';

const when = (iso: string | null) => (iso ? formatDateTime(iso) : 'Never');

function StaffForm({ row, roles, reload, close }: { row?: Row; roles: Role[]; reload: () => Promise<Staff | null>; close: () => void }) {
  const { request, toast, can } = useShell();
  const [name, setName] = useState(row?.name ?? '');
  const [email, setEmail] = useState(row?.email ?? '');
  const [roleId, setRoleId] = useState(row?.roleId ?? roles.find((r) => r.name === 'Staff')?.id ?? roles[0]?.id ?? '');
  const [err, setErr] = useState<{ name?: string; email?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const pinned = row?.lastAdmin === true;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    const m = email.trim();
    const bad = {
      name: n && n.length <= 100 ? undefined : 'Enter a name of up to 100 characters.',
      email: EMAIL.test(m) ? undefined : 'Enter a valid email address.',
    };
    if (bad.name || bad.email) return setErr(bad);
    const patch: Record<string, string> = {};
    if (row) {
      if (n !== row.name) patch.name = n;
      if (m !== row.email) patch.email = m;
      if (roleId !== row.roleId) patch.roleId = roleId;
      if (Object.keys(patch).length === 0) return close();
    }
    setBusy(true);
    setErr({});
    try {
      const r = row
        ? await request('PATCH', `/api/v1/admin/users/${row.id}`, patch, row.version)
        : await request('POST', '/api/v1/admin/users', { name: n, email: m, roleId });
      if (r.status === 200 || r.status === 201) {
        toast(row ? 'Changes saved' : `Invite sent to ${m}`);
        close();
        await reload();
      } else if (r.status === 409) {
        // The same 409 means "stale" or "email taken": a changed version on a fresh read tells them apart.
        const fresh = row ? await reload() : null;
        const cur = fresh?.items.find((i) => i.id === row?.id);
        if (row && !cur) { toast('That person no longer exists.', 'error'); close(); }
        else if (row && cur && cur.version !== row.version) { toast('Someone else changed this person. Review and try again.', 'error'); close(); }
        else if (row && !patch.email) setErr({ form: LAST_ADMIN });
        else setErr({ email: 'Someone already has that email.' });
      } else if (r.status === 422) {
        setErr({ form: 'Check the name, email and role, then try again.' });
      } else if (r.status === 403) {
        close();
      } else {
        setErr({ form: "Couldn't save. Try again." });
      }
    } catch {
      setErr({ form: "Couldn't reach the server. Try again." });
    } finally {
      setBusy(false);
    }
  };

  const reset2fa = async () => {
    try {
      const r = await request('POST', `/api/v1/admin/users/${row?.id}/2fa/reset`);
      if (r.status === 204) { toast(`Two-factor reset for ${row?.name}`); close(); await reload(); }
      else if (r.status === 409) { toast('Two-factor is already off for this person.', 'error'); close(); await reload(); }
      else if (r.status !== 403) setErr({ form: "Couldn't reset two-factor. Try again." });
    } catch { setErr({ form: "Couldn't reach the server. Try again." }); }
  };

  return (
    <form onSubmit={submit} noValidate className="form">
      <label htmlFor="sf-name">Name</label>
      <input id="sf-name" value={name} maxLength={100} autoComplete="off" onChange={(e) => setName(e.target.value)} aria-invalid={!!err.name} aria-describedby={err.name ? 'sf-name-err' : undefined} />
      {err.name && <p id="sf-name-err" className="error">{err.name}</p>}
      <label htmlFor="sf-email">Email</label>
      <input id="sf-email" type="email" value={email} autoComplete="off" onChange={(e) => setEmail(e.target.value)} aria-invalid={!!err.email} aria-describedby={err.email ? 'sf-email-err' : undefined} />
      {err.email && <p id="sf-email-err" className="error">{err.email}</p>}
      <label htmlFor="sf-role">Role</label>
      <select id="sf-role" value={roleId} disabled={pinned} onChange={(e) => setRoleId(e.target.value)} aria-describedby={pinned ? 'sf-role-hint' : undefined}>
        {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      {pinned && <p id="sf-role-hint" className="hint">{LAST_ADMIN}</p>}
      {row?.status === 'invited' && <p className="hint">Changing the email or role sends a new invite.</p>}
      {row?.twoFactor && can(['PERM_MANAGE_STAFF']) && (
        <>
          <p className="hint">Two-factor sign-in is on for this person.</p>
          <button type="button" className="btn" onClick={() => void reset2fa()}>Reset two-factor</button>
        </>
      )}
      {err.form && <p role="alert" className="error">{err.form}</p>}
      <div className="actions">
        <button type="button" className="btn" onClick={close}>Cancel</button>
        <button type="submit" className="btn primary" disabled={busy}>{row ? 'Save changes' : 'Send invite'}</button>
      </div>
    </form>
  );
}

export function StaffTab() {
  const shell = useShell();
  const { openDialog, toast } = shell;
  // The shell's request function changes identity when the shell re-renders; a ref keeps load stable.
  const req = useRef(shell.request);
  req.current = shell.request;
  const [state, setState] = useState<'loading' | 'error' | Staff>('loading');

  const load = useCallback(async (): Promise<Staff | null> => {
    try {
      const r = await req.current<components['schemas']['StaffList']>('GET', '/api/v1/admin/users');
      if (r.status === 200 && r.body) {
        const s = { items: (r.body.items ?? []) as Row[], roles: (r.body.roles ?? []) as Role[] };
        setState(s);
        return s;
      }
    } catch { /* the shell already raised the offline banner or the expiry */ }
    setState((cur) => (typeof cur === 'object' ? cur : 'error'));
    return null;
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (state === 'loading') return <Skeleton rows={4} height={44} />;
  if (state === 'error') return <ErrorBlock what="staff" onRetry={() => { setState('loading'); void load(); }} />;

  const { items, roles } = state;
  const form = (row?: Row) => openDialog({
    title: row ? 'Edit staff member' : 'Invite staff',
    custom: (close) => <StaffForm row={row} roles={roles} reload={load} close={close} />,
  });

  const resend = async (row: Row) => {
    try {
      const r = await shell.request('POST', `/api/v1/admin/users/${row.id}/resend`);
      if (r.status === 204) toast(`Invite re-sent to ${row.email}`);
      else toast("Couldn't resend the invite. Try again.", 'error');
    } catch { toast("Couldn't resend the invite. Try again.", 'error'); }
  };

  const remove = (row: Row) => openDialog({
    title: `Delete ${row.name}?`,
    body: `${row.name} will lose access immediately. Their uploads and replies stay in the workspace. This can’t be undone.`,
    confirm: {
      label: 'Delete',
      danger: true,
      run: async () => {
        try {
          const r = await shell.request('DELETE', `/api/v1/admin/users/${row.id}`);
          if (r.status === 204) toast(`Deleted ${row.name}`);
          else if (r.status === 409) toast(LAST_ADMIN, 'error');
          else if (r.status !== 404) toast("Couldn't delete. Try again.", 'error');
        } catch { toast("Couldn't delete. Try again.", 'error'); return; }
        await load();
      },
    },
  });

  return (
    <div>
      <div className="bar">
        <h2>Staff ({items.length})</h2>
        <button type="button" className="btn primary" onClick={() => form()}>Invite staff</button>
      </div>
      <table className="table" aria-label="Staff">
        <thead>
          <tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last active</th><th><span className="sr">Actions</span></th></tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id}>
              <td><span className="avatar" aria-hidden="true">{r.name.slice(0, 1).toUpperCase()}</span>{r.name}</td>
              <td>{r.email}</td>
              <td><span className="pill neutral">{r.role}</span></td>
              <td><span className={r.status === 'active' ? 'pill pos' : 'pill warn'}>{r.status === 'active' ? 'Active' : 'Invited'}</span></td>
              <td>{r.status === 'invited' ? '—' : when(r.lastActive)}</td>
              <td className="row-actions">
                <button type="button" className="link" aria-label={`Edit ${r.name}`} onClick={() => form(r)}>Edit</button>
                {r.status === 'invited' && (
                  <button type="button" className="link" aria-label={`Resend invite to ${r.name}`} onClick={() => void resend(r)}>Resend invite</button>
                )}
                <button
                  type="button"
                  className="link danger"
                  aria-label={`Delete ${r.name}`}
                  aria-disabled={r.lastAdmin || undefined}
                  title={r.lastAdmin ? LAST_ADMIN : undefined}
                  onClick={() => { if (!r.lastAdmin) remove(r); }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length <= 1 && (
        <div className="empty">
          <img src={art} alt="" width={160} />
          <h3>No staff yet</h3>
          <p className="lede">Invite teammates so they can upload gowns and reply to clients.</p>
        </div>
      )}
    </div>
  );
}
