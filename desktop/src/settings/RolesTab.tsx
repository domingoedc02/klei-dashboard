import { useCallback, useEffect, useRef, useState } from 'react';
import type { components } from '../api/schema';
import { useShell } from '../shell/context';
import { ErrorBlock, Skeleton } from '../shell/ui';

type Role = Required<components['schemas']['RoleView']>;
interface Matrix { permissions: string[]; roles: Role[] }

const LABELS: Record<string, string> = {
  PERM_VIEW_GALLERY: 'View gallery',
  PERM_UPLOAD_IMAGES: 'Upload images',
  PERM_EDIT_GOWN: 'Edit gown details',
  PERM_DELETE_GOWN: 'Delete gown folders',
  PERM_REPLY: 'Reply to inquiries',
  PERM_CLOSE_INQUIRY: 'Close inquiries',
  PERM_MANAGE_STAFF: 'Manage staff',
  PERM_AI_SETTINGS: 'Change AI settings',
  PERM_VIEW_AUDIT: 'View audit log',
};

export function RolesTab() {
  const shell = useShell();
  const { toast } = shell;
  // The shell's request function changes identity when the shell re-renders; a ref keeps load stable.
  const req = useRef(shell.request);
  req.current = shell.request;
  const [state, setState] = useState<'loading' | 'error' | Matrix>('loading');
  // `shown` is what the boxes display (optimistic); `saved` is the last server answer, whose version is the next If-Match.
  const shown = useRef(new Map<string, Set<string>>());
  const saved = useRef(new Map<string, Role>());
  const tails = useRef(new Map<string, Promise<void>>());

  const load = useCallback(async () => {
    try {
      const r = await req.current<Matrix>('GET', '/api/v1/admin/roles');
      if (r.status === 200 && r.body) {
        const m = { permissions: r.body.permissions ?? [], roles: (r.body.roles ?? []) as Role[] };
        shown.current = new Map(m.roles.map((x) => [x.id, new Set(x.permissions)]));
        saved.current = new Map(m.roles.map((x) => [x.id, x]));
        setState(m);
        return;
      }
    } catch { /* the shell already raised the offline banner or the expiry */ }
    setState((cur) => (typeof cur === 'object' ? cur : 'error'));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const redraw = () => setState((cur) => (typeof cur === 'object'
    ? { ...cur, roles: cur.roles.map((x) => ({ ...x, permissions: cur.permissions.filter((p) => shown.current.get(x.id)?.has(p)) })) }
    : cur));

  const save = async (id: string) => {
    const base = saved.current.get(id);
    const want = [...(shown.current.get(id) ?? [])];
    if (!base || (want.length === base.permissions.length && want.every((p) => base.permissions.includes(p)))) return;
    try {
      const r = await req.current<Role>('PUT', '/api/v1/admin/roles', { roleId: id, permissions: want }, base.version);
      if (r.status === 200 && r.body) {
        saved.current.set(id, r.body as Role);
        toast('Permission updated');
        return;
      }
      if (r.status === 409) await load();
    } catch { /* fall through to the revert */ }
    shown.current.set(id, new Set(saved.current.get(id)?.permissions));
    redraw();
    toast("Couldn't save. Try again.", 'error');
  };

  // One save at a time per Role, so each one carries the version the one before it returned.
  const toggle = (id: string, perm: string) => {
    const set = new Set(shown.current.get(id));
    if (!set.delete(perm)) set.add(perm);
    shown.current.set(id, set);
    redraw();
    tails.current.set(id, (tails.current.get(id) ?? Promise.resolve()).then(() => save(id)));
  };

  if (state === 'loading') return <Skeleton rows={5} height={44} />;
  if (state === 'error') return <ErrorBlock what="roles" onRetry={() => { setState('loading'); void load(); }} />;

  return (
    <div>
      <h2>Roles and permissions</h2>
      <p className="lede">Admin permissions are locked. Changes take effect right away.</p>
      <table className="table matrix" aria-label="Role permissions">
        <thead>
          <tr>
            <th scope="col">Permission</th>
            {state.roles.map((r) => (
              <th key={r.id} scope="col">{r.name}{r.locked && <span className="pill neutral">Locked</span>}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {state.permissions.map((p) => (
            <tr key={p}>
              <th scope="row">{LABELS[p] ?? p}</th>
              {state.roles.map((r) => (
                <td key={r.id}>
                  <input
                    type="checkbox"
                    aria-label={`${LABELS[p] ?? p} for ${r.name}`}
                    checked={r.locked || r.permissions.includes(p)}
                    disabled={r.locked}
                    onChange={() => toggle(r.id, p)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
