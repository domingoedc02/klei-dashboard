import { useEffect, useState, type KeyboardEvent } from 'react';
import { useShell } from '../shell/context';
import { Icon, type IconName } from '../shell/icons';
import { Sheet } from '../shell/ui';
import { AiTab } from './AiTab';
import { AuditTab } from './AuditTab';
import { AwayCard } from './AwayCard';
import { KeysTab } from './KeysTab';
import { NotificationsTab, PreferencesTab } from './PreferencesTab';
import { ProfileTab } from './ProfileTab';
import { UsageTab } from './UsageTab';
import { RolesTab } from './RolesTab';
import { SignatureTab } from './SignatureTab';
import { StaffTab } from './StaffTab';

const TABS: readonly { id: string; label: string; icon: IconName }[] = [
  { id: 'profile', label: 'Profile', icon: 'user' },
  { id: 'signature', label: 'Signature', icon: 'edit' },
  { id: 'preferences', label: 'Preferences', icon: 'settings' },
  { id: 'notifications', label: 'Notifications', icon: 'bell' },
];
const ADMIN = { id: 'admin', label: 'Admin', icon: 'shield' } as const;
const SUBS = [
  { id: 'staff', label: 'Staff', any: ['PERM_MANAGE_STAFF'] },
  { id: 'roles', label: 'Roles & permissions', any: ['PERM_MANAGE_STAFF'] },
  { id: 'ai', label: 'AI settings', any: ['PERM_AI_SETTINGS'] },
  { id: 'usage', label: 'AI usage', any: ['PERM_AI_SETTINGS'] },
  { id: 'keys', label: 'Keys', any: ['PERM_KEY_ROTATE'] },
  { id: 'away', label: 'Away message', any: ['PERM_AWAY'] },
  { id: 'audit', label: 'Audit log', any: ['PERM_VIEW_AUDIT'] },
] as const;

// #/settings/{tab}, #/settings/admin/{sub}; a bare sub id (#/settings/staff) opens it under Admin.
function fromHash(): [string, string | null] {
  const [a, b] = window.location.hash.replace(/^#\//, '').split('/').slice(1);
  return SUBS.some((s) => s.id === a) ? ['admin', a] : [a || 'profile', b || null];
}

export function Settings() {
  const { can } = useShell();
  const subs = SUBS.filter((s) => can(s.any));
  const tabs = subs.length ? [...TABS, ADMIN] : TABS;
  const [[picked, subPicked], pick] = useState(fromHash);
  useEffect(() => {
    const on = () => pick(fromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const tab = tabs.find((t) => t.id === picked) ?? tabs[0];
  const sub = subs.find((s) => s.id === subPicked) ?? subs[0];
  const go = (id: string, s: string | null = null) => {
    window.history.replaceState(null, '', `#/settings/${id}${s ? `/${s}` : ''}`);
    pick([id, s]);
  };
  const move = (e: KeyboardEvent) => {
    const n = tabs.length;
    const i = tabs.indexOf(tab);
    const j = ({ ArrowRight: (i + 1) % n, ArrowLeft: (i + n - 1) % n, Home: 0, End: n - 1 } as Record<string, number>)[e.key];
    if (j === undefined) return;
    e.preventDefault();
    go(tabs[j].id);
    document.getElementById(`tab-${tabs[j].id}`)?.focus();
  };
  return (
    <Sheet title="Settings">
      <p className="lede">{subs.length ? 'Manage your account and workspace.' : 'Manage your account.'}</p>
      <div role="tablist" aria-label="Settings sections" className="tabs" onKeyDown={move}>
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            id={`tab-${t.id}`}
            aria-selected={t.id === tab.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={t.id === tab.id ? 0 : -1}
            onClick={() => go(t.id)}
          >
            <Icon name={t.icon} />
            {t.label}
            {t.id === 'admin' && <span className="role-badge">Admin only</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab.id}`} aria-labelledby={`tab-${tab.id}`}>
        {tab.id === 'admin' && (
          <div role="group" aria-label="Admin sections" className="mini-tabs">
            {subs.map((s) => (
              <button key={s.id} type="button" aria-pressed={s.id === sub.id} onClick={() => go('admin', s.id)}>
                {s.label}
              </button>
            ))}
          </div>
        )}
        {tab.id === 'admin' && sub.id === 'staff' && <StaffTab />}
        {tab.id === 'admin' && sub.id === 'roles' && <RolesTab />}
        {tab.id === 'admin' && sub.id === 'ai' && <AiTab />}
        {tab.id === 'admin' && sub.id === 'usage' && <UsageTab />}
        {tab.id === 'admin' && sub.id === 'keys' && <KeysTab />}
        {tab.id === 'admin' && sub.id === 'away' && <AwayCard />}
        {tab.id === 'admin' && sub.id === 'audit' && <AuditTab />}
        {tab.id === 'profile' && <ProfileTab />}
        {tab.id === 'signature' && <SignatureTab />}
        {tab.id === 'preferences' && <PreferencesTab />}
        {tab.id === 'notifications' && <NotificationsTab />}
      </div>
    </Sheet>
  );
}
