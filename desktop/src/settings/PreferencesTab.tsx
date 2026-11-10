import { useRef, useState } from 'react';
import { formatDate, type Prefs } from '../format';
import { useShell } from '../shell/context';
import { START_PAGES } from '../shell/permissions';

const FORMATS = ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'] as const;
const DEFAULTS: Prefs = { timezone: null, dateFormat: 'MM/DD/YYYY', startPage: 'dashboard', enterToSend: false, newInquiry: true, aiFinished: true, teamActivity: true, emailNewInquiry: false, emailAiFinished: false, emailTeamActivity: false, digest: 'never', version: 0 };
const FAIL = "Couldn't save. Try again.";
const STALE = 'This changed in another window. Reload to see the latest.';

const zones = (): string[] => {
  try { return Intl.supportedValuesOf('timeZone'); } catch { return []; }
};
const here = (): string => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; } };

/** Autosave: each change sends the whole set with the version read last. The controls follow what the server answered, so a failure leaves them as they were. */
function usePrefs() {
  const shell = useShell();
  const p = shell.me.preferences ?? DEFAULTS;
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const shellRef = useRef(shell);
  shellRef.current = shell;

  const change = async (patch: Partial<Prefs>, done = 'Preference saved') => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    const { toast, request, applyPreferences } = shellRef.current;
    const { version, ...rest } = { ...p, ...patch };
    try {
      const r = await request<Prefs>('PUT', '/api/v1/me/preferences', rest, version ?? 0);
      if (r.status === 200 && r.body) { applyPreferences(r.body); toast(done); }
      else if (r.status === 409) { await shellRef.current.reloadMe(); toast(STALE, 'error'); }
      else toast(FAIL, 'error');
    } catch { toast(FAIL, 'error'); } finally { busy.current = false; setSaving(false); }
  };
  return { p, saving, change, can: shell.can };
}

export function PreferencesTab() {
  const { p, saving, change, can } = usePrefs();
  const { checkForUpdates } = useShell();
  const all = zones();
  const list = p.timezone && !all.includes(p.timezone) ? [p.timezone, ...all] : all;
  const pages = START_PAGES.filter((s) => can(s.any));
  const page = pages.some((s) => s.id === p.startPage) ? p.startPage : 'dashboard';
  return (
    <form className="form" aria-label="Preferences" onSubmit={(e) => e.preventDefault()}>
      <h2>Language and region</h2>

      <label htmlFor="pref-zone">Timezone</label>
      <select id="pref-zone" value={p.timezone ?? ''} disabled={saving} onChange={(e) => void change({ timezone: e.target.value || null })}>
        <option value="">This computer ({here()})</option>
        {list.map((z) => <option key={z} value={z}>{z}</option>)}
      </select>

      <label htmlFor="pref-date">Date format</label>
      <select id="pref-date" value={p.dateFormat} disabled={saving} aria-describedby="pref-date-hint" onChange={(e) => void change({ dateFormat: e.target.value })}>
        {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
      </select>
      <p id="pref-date-hint" className="hint">Today shows as {formatDate(Date.now())}.</p>

      <label htmlFor="pref-start">Start page</label>
      <select id="pref-start" value={page} disabled={saving} onChange={(e) => void change({ startPage: e.target.value })}>
        {pages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>

      <label htmlFor="pref-lang">Language</label>
      <select id="pref-lang" value="en-US" disabled aria-describedby="pref-lang-hint">
        <option value="en-US">English (US)</option>
      </select>
      <p id="pref-lang-hint" className="hint">More languages are not available yet.</p>

      <h2>Inquiries</h2>
      <label className="switch">
        <input type="checkbox" role="switch" checked={!!p.enterToSend} disabled={saving} onChange={(e) => void change({ enterToSend: e.target.checked })} />
        Press Enter to send
      </label>
      <p className="hint">Replies and Assistant messages send with Enter. Shift+Enter starts a new line.</p>

      <h3 id="upd-h">Updates</h3>
      <p className="hint">The app looks for a new version when it opens and once a day.</p>
      <button type="button" className="btn" aria-describedby="upd-h" onClick={() => void checkForUpdates()}>Check for updates</button>
    </form>
  );
}

const EVENTS = [
  { key: 'NewInquiry', label: 'New inquiry', help: 'When a client submits the website form', show: (can: (a: string[]) => boolean) => can(['PERM_REPLY']) },
  { key: 'AiFinished', label: 'AI finished', help: 'When a batch is ready to review', show: () => true },
  { key: 'TeamActivity', label: 'Team activity', help: 'Invites accepted and role changes', show: () => true },
] as const;
const DIGESTS = [['realtime', 'Real-time'], ['hourly', 'Hourly'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['never', 'Never']] as const;

export function NotificationsTab() {
  const { p, saving, change, can } = usePrefs();
  const digest = DIGESTS.find(([v]) => v === p.digest) ?? DIGESTS[4];
  return (
    <form className="form" aria-labelledby="notif-h" onSubmit={(e) => e.preventDefault()}>
      <h2 id="notif-h">Notifications</h2>
      <p className="hint">Choose what reaches you inside the app and by email.</p>
      <table className="table matrix" aria-label="Notification events">
        <thead>
          <tr><th scope="col">Event</th><th scope="col">Email</th><th scope="col">In-app</th></tr>
        </thead>
        <tbody>
          {EVENTS.filter((e) => e.show(can)).map((e) => {
            const mail = `email${e.key}` as 'emailNewInquiry', app = `${e.key[0].toLowerCase()}${e.key.slice(1)}` as 'newInquiry';
            return (
              <tr key={e.key}>
                <th scope="row">{e.label}<span className="lede">{e.help}</span></th>
                <td><input type="checkbox" role="switch" aria-label={`${e.label} by email`} checked={!!p[mail]} disabled={saving} onChange={(ev) => void change({ [mail]: ev.target.checked })} /></td>
                <td><input type="checkbox" role="switch" aria-label={`${e.label} in-app`} checked={!!p[app]} disabled={saving} onChange={(ev) => void change({ [app]: ev.target.checked })} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h3>Email digest</h3>
      <label htmlFor="pref-digest">Email digest</label>
      <select id="pref-digest" value={digest[0]} disabled={saving} aria-describedby="pref-digest-hint" onChange={(e) => void change({ digest: e.target.value }, `Digest set to ${DIGESTS.find(([v]) => v === e.target.value)?.[1]}`)}>
        {DIGESTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <p id="pref-digest-hint" className="hint">Real-time sends one email per event. Hourly, Daily (8:00) and Weekly (Monday 8:00) send one email of titles, in your timezone. Never sends no email, whatever the switches say.</p>
    </form>
  );
}
