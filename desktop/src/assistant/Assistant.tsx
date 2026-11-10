import { useCallback, useEffect, useRef, useState } from 'react';
import type { components } from '../api/schema';
import { Mosaic } from '../gallery/Gallery';
import { useShell } from '../shell/context';
import { useRoute, useRouteArg } from '../shell/route';
import { ErrorBlock, Skeleton } from '../shell/ui';

type Line = components['schemas']['ChatLine'];
type View = components['schemas']['ChatView'];
type Detail = components['schemas']['InquiryDetail'];

const GREETING = 'Hi! I can summarize inquiries, draft replies and suggest gowns from your gallery.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNREACHABLE = "The assistant can't reach your AI provider. Check AI settings.";

/** FR-25..27: the global chat drawer. It only reads and answers; nothing here sends mail or changes a record. */
export function Assistant() {
  const shell = useShell();
  const [lines, setLines] = useState<Line[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [first, setFirst] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const req = useRef(shell.request);
  req.current = shell.request;
  const route = useRoute();
  const arg = useRouteArg();
  const thread = route === 'inquiries' && arg && UUID.test(arg) ? arg : null;

  // The chip may name only a first name the staff member already sees on the open thread; an email-like name never goes in.
  useEffect(() => {
    setFirst(null);
    if (!thread) return;
    let live = true;
    req.current<Detail>('GET', `/api/v1/inquiries/${thread}`).then((r) => {
      const f = r.status === 200 ? r.body?.client?.name?.trim().split(/\s+/)[0] : undefined;
      if (live && f && !f.includes('@')) setFirst(f);
    }).catch(() => {});
    return () => { live = false; };
  }, [thread]);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const r = await req.current<View>('GET', '/api/v1/assistant/chat');
      if (r.status === 200) setLines(r.body?.messages ?? []);
      else setFailed(true);
    } catch { setFailed(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [lines, busy]);

  const send = async (said: string, inquiryId?: string) => {
    const t = said.trim();
    if (!t || busy) return;
    setBusy(true); setProblem(null);
    try {
      const r = await req.current<View>('POST', '/api/v1/assistant/chat/messages', inquiryId ? { text: t, inquiryId } : { text: t });
      if (r.status === 201) { setLines((l) => [...(l ?? []), ...(r.body?.messages ?? [])]); setText(''); }
      else setProblem(r.status === 409 || r.status === 502 ? UNREACHABLE : "Couldn't send that. Try again.");
    } catch { setProblem("Couldn't send that. Try again."); } finally { setBusy(false); }
  };

  const draft = first ? `Draft a reply to ${first}` : 'Draft a reply';
  const chips = ['Summarize new inquiries', draft, 'Suggest gowns for a beach wedding'];
  const enter = !!shell.me.preferences?.enterToSend;

  const fresh = async () => {
    const r = await req.current('DELETE', '/api/v1/assistant/chat');
    if (r.status === 204) { setLines([]); setProblem(null); } else shell.toast("Couldn't start a new chat.", 'error');
  };

  const copy = async (s: string) => {
    try { await navigator.clipboard.writeText(s); shell.toast('Copied'); } catch { shell.toast("Couldn't copy. Select the text instead.", 'error'); }
  };

  const keys = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    if (e.metaKey || e.ctrlKey || (shell.me.preferences?.enterToSend && !e.shiftKey)) { e.preventDefault(); void send(text); }
  };

  return (
    <div className="assist">
      <p className="hint assist-note">Messages and the inquiry and gown text they need are sent to your AI provider. Nothing is sent by email or changed for you.</p>
      {lines === null && !failed && <Skeleton rows={3} height={40} />}
      {failed && <ErrorBlock what="the conversation" onRetry={() => void load()} />}
      {lines && (
        <>
          <div ref={log} className="assist-log" role="log" aria-label="Conversation" aria-live="polite">
            <div className="assist-line" data-role="assistant"><p>{GREETING}</p></div>
            {lines.map((l) => (
              <div key={l.id} className="assist-line" data-role={l.role}>
                <p>{l.text}</p>
                {l.gowns && l.gowns.length > 0 && (
                  <ul className="assist-gowns">
                    {l.gowns.map((g) => (
                      <li key={g.id}>
                        <Mosaic gown={g.id!} ids={g.thumbs ?? []} />
                        <a href={`#/gallery/${g.id}`}>{g.name}</a>
                      </li>
                    ))}
                  </ul>
                )}
                {l.role === 'assistant' && <button type="button" className="link" onClick={() => void copy(l.text ?? '')}>Copy</button>}
              </div>
            ))}
            {busy && <div className="assist-line assist-typing" data-role="assistant" role="status" aria-label="The assistant is typing"><i /><i /><i /></div>}
          </div>
          {problem && (
            <p role="alert" className="error">
              {problem}{' '}
              {problem === UNREACHABLE && shell.can(['PERM_AI_SETTINGS']) && <a href="#/settings" onClick={shell.closeDrawer}>Open settings</a>}
            </p>
          )}
          {!busy && !lines.some((l) => l.role === 'user') && (
            <div className="assist-chips">
              {chips.map((c) => <button key={c} type="button" className="chip-btn" onClick={() => void send(c, c === draft ? thread ?? undefined : undefined)}>{c}</button>)}
            </div>
          )}
          <form className="assist-form" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
            <textarea aria-label="Message" placeholder="Ask anything about your inquiries or gowns…" rows={2} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} onKeyDown={keys} />
            <p className="hint assist-keys">{enter ? 'Enter to send · Shift+Enter for a new line' : 'Ctrl/⌘ + Enter to send'}</p>
            <div className="actions">
              <button type="submit" className="btn primary" disabled={busy || !text.trim()}>Send</button>
              <button type="button" className="link" disabled={busy || lines.length === 0} onClick={() => void fresh()}>New chat</button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
