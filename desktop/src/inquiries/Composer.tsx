import { useCallback, useEffect, useRef, useState } from 'react';
import type { components } from '../api/schema';
import { bridge, asBridgeError } from '../bridge';
import { formatBytes } from '../format';
import { useShell } from '../shell/context';
import { Icon, type IconName } from '../shell/icons';
import { isBlank, sanitizeHtml } from './sanitize';

type Msg = components['schemas']['DetailMessage'];
type Draft = components['schemas']['DraftView'];
type Sig = components['schemas']['SignatureView'];
type File = components['schemas']['AttachmentView'];
type Save = 'idle' | 'saving' | 'saved' | 'failed';

export const DRAFT_MS = 1500;
const LINK = /^(https?:\/\/|mailto:)\S+$/i;

// The real cap is the Reply's 20 MB (Story 7.3, enforced by the app and the server); the prototype's 10 MB is a mock.
const ATTACH_MB = 20;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN = /^[\w-]+(\.[\w-]+)+(\/\S*)?$/;

const FORMATS: [string, string, IconName | null][] = [
  ['bold', 'Bold', 'bold'], ['italic', 'Italic', 'italic'], ['underline', 'Underline', 'underline'],
  ['insertUnorderedList', 'Bulleted list', 'list'], ['insertOrderedList', 'Numbered list', null],
];
// No numbered-list glyph in the shared icon set yet; same stroke rules as Icon.
const Numbered = () => (
  <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1v4M3.5 13.5a1.5 1.5 0 013 0c0 1-3 1.5-3 3h3" />
  </svg>
);

/** FR-21: write and send a Reply. The text is kept as a Draft while typing; the server sanitizes again whatever this sends. */
export function Composer({ inquiryId, to, subject, onSent }: { inquiryId: string; to: { name: string; email: string }; subject: string; onSent: (m: Msg) => void }) {
  const shell = useShell();
  const req = useRef(shell.request);
  req.current = shell.request;
  const toast = useRef(shell.toast);
  toast.current = shell.toast;
  const setDirty = useRef(shell.setDirty);
  setDirty.current = shell.setDirty;
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const dirty = useRef(false);
  const attempt = useRef<{ sig: string; key: string } | null>(null);
  const range = useRef<Range | null>(null);
  const [load, setLoad] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [turn, setTurn] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  const [blank, setBlank] = useState(true);
  const [save, setSave] = useState<Save>('idle');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [signature, setSignature] = useState('');
  const [attaching, setAttaching] = useState(false);

  const mark = (on: boolean) => {
    if (dirty.current !== on) { dirty.current = on; setDirty.current(on); }
  };
  // The editor is gone by the time the unmount cleanup runs, so the text it saves comes from here.
  const latest = useRef('');
  const html = () => sanitizeHtml(box.current?.innerHTML ?? '');

  // Saves run one after the other so a late autosave can never land after a Send and bring the sent text back as a Draft.
  const put = useCallback((body: string) => {
    const run = async () => {
      setSave('saving');
      try {
        const r = await req.current<unknown>('PUT', `/api/v1/inquiries/${inquiryId}/draft`, { body });
        if (r.status === 200) { setSave('saved'); if (body === latest.current) mark(false); } else setSave('failed');
      } catch { setSave('failed'); }
    };
    chain.current = chain.current.then(run, run);
    return chain.current;
  }, [inquiryId]); // eslint-disable-line react-hooks/exhaustive-deps

  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);
  const schedule = useCallback(() => {
    flush();
    timer.current = setTimeout(() => { timer.current = null; void put(latest.current); }, DRAFT_MS);
  }, [flush, put]);

  useEffect(() => {
    let live = true;
    setLoad('loading');
    (async () => {
      try {
        const [d, s] = await Promise.all([
          req.current<Draft>('GET', `/api/v1/inquiries/${inquiryId}/draft`),
          req.current<Sig>('GET', '/api/v1/me/signature').catch(() => null),
        ]);
        if (!live) return;
        if (d.status !== 200 || !d.body) { setLoad('failed'); return; }
        latest.current = sanitizeHtml(d.body.body ?? '');
        if (box.current) box.current.innerHTML = latest.current;
        setBlank(isBlank(d.body.body ?? ''));
        setFiles(d.body.attachments ?? []);
        setSignature(s?.status === 200 && s.body?.enabled ? s.body.preview ?? '' : '');
        setLoad('ready');
      } catch { if (live) setLoad('failed'); }
    })();
    return () => { live = false; };
  }, [inquiryId, turn]);

  useEffect(() => {
    document.execCommand?.('defaultParagraphSeparator', false, 'div');
    return () => {
      // Leaving the thread saves what was typed in the last second and a half.
      if (timer.current) { clearTimeout(timer.current); void put(latest.current); }
      mark(false);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const typed = () => {
    latest.current = html();
    setBlank(isBlank(latest.current));
    setError('');
    mark(true);
    schedule();
  };
  const format = (cmd: string) => { box.current?.focus(); document.execCommand?.(cmd); typed(); };

  const openLink = () => {
    const s = window.getSelection();
    range.current = s && s.rangeCount && box.current?.contains(s.anchorNode) ? s.getRangeAt(0).cloneRange() : null;
    setLink('');
  };
  const applyLink = () => {
    let url = (link ?? '').trim();
    if (EMAIL.test(url)) url = `mailto:${url}`;
    else if (DOMAIN.test(url)) url = `https://${url}`;
    if (!LINK.test(url)) { setError('Use a link that starts with http://, https:// or mailto:.'); return; }
    box.current?.focus();
    const s = window.getSelection();
    if (range.current && s) { s.removeAllRanges(); s.addRange(range.current); }
    if (range.current?.collapsed ?? true) {
      const a = document.createElement('a');
      a.href = url;
      a.textContent = url;
      document.execCommand?.('insertHTML', false, a.outerHTML);
    } else document.execCommand?.('createLink', false, url);
    setLink(null);
    typed();
  };

  const attach = async () => {
    if (attaching) return;
    setAttaching(true);
    try {
      const s = await bridge.uploadFiles('attachment', inquiryId);
      if (s.rejected.length) {
        const [r] = s.rejected;
        toast.current(
          s.rejected.length === 1 && r.reason === 'size' ? `${r.name} is over ${ATTACH_MB} MB` : `${r.name}${s.rejected.length > 1 ? ` and ${s.rejected.length - 1} more` : ''} couldn't be attached.`,
          'error',
        );
      }
      if (s.stored.length) {
        const d = await req.current<Draft>('GET', `/api/v1/inquiries/${inquiryId}/draft`);
        if (d.status === 200) setFiles(d.body?.attachments ?? []);
      }
    } catch (e) {
      if (asBridgeError(e).kind !== 'cancelled') toast.current("Couldn't attach the files. Try again.", 'error');
    } finally { setAttaching(false); }
  };
  const detach = async (f: File) => {
    try {
      const r = await req.current<unknown>('DELETE', `/api/v1/inquiries/${inquiryId}/attachments/${f.id}`);
      if (r.status === 204 || r.status === 404) setFiles((all) => all.filter((x) => x.id !== f.id));
      else toast.current(`Couldn't remove ${f.name}.`, 'error');
    } catch { toast.current(`Couldn't remove ${f.name}.`, 'error'); }
  };

  const discard = async () => {
    const body = html();
    flush();
    await chain.current;
    try {
      const r = await req.current<unknown>('DELETE', `/api/v1/inquiries/${inquiryId}/draft`);
      if (r.status !== 204) throw new Error('discard');
    } catch { toast.current("Couldn't discard the draft. Try again.", 'error'); return; }
    latest.current = '';
    if (box.current) box.current.innerHTML = '';
    setBlank(true); setFiles([]); setError(''); setSave('idle'); mark(false);
    // shortcut: Undo brings the text back, not the attached files (the server dropped them); add if staff ask.
    toast.current('Draft discarded.', 'info', {
      label: 'Undo',
      run: () => {
        if (!box.current) return;
        box.current.innerHTML = body;
        typed();
      },
    });
  };

  const send = async () => {
    if (sending || shell.offline || load !== 'ready') return;
    const body = html();
    if (isBlank(body)) { setError('Write a message before sending.'); box.current?.focus(); return; }
    setError('');
    setSending(true);
    flush();
    await chain.current;
    const sig = `${body}|${files.map((f) => f.id).join(',')}`;
    // The same text and files retried keep their key, so a reply the server already took is not sent twice.
    if (attempt.current?.sig !== sig) attempt.current = { sig, key: crypto.randomUUID() };
    try {
      const r = await req.current<Msg>('POST', `/api/v1/inquiries/${inquiryId}/reply`, { body }, undefined, attempt.current.key);
      if ((r.status === 201 || r.status === 200) && r.body) {
        attempt.current = null;
        latest.current = '';
        if (box.current) box.current.innerHTML = '';
        setBlank(true); setFiles([]); setSave('idle'); mark(false);
        onSent(r.body);
      } else if (r.status === 422) setError('That reply is too long or empty. Shorten it and try again.');
      else if (r.status === 409) toast.current('This inquiry is closed. Reopen it to reply.', 'error');
      else if (r.status === 404) toast.current('This inquiry no longer exists.', 'error');
      else { toast.current("Couldn't send the reply. Try again.", 'error'); mark(true); schedule(); }
    } catch {
      toast.current("Couldn't reach the server. Your reply is kept; try again.", 'error');
      mark(true); schedule();
    } finally { setSending(false); }
  };

  const keys = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    const quick = e.metaKey || e.ctrlKey;
    if (quick || (shell.me.preferences?.enterToSend && !e.shiftKey)) { e.preventDefault(); void send(); }
  };
  const paste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    document.execCommand?.('insertText', false, e.clipboardData.getData('text/plain'));
  };

  const ready = load === 'ready';
  return (
    <form className="composer" aria-label="Reply" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <dl className="composer-meta">
        <dt>To</dt><dd>{to.name} &lt;{to.email}&gt;</dd>
        <dt>Subject</dt><dd>{subject}</dd>
      </dl>
      {load === 'failed' && (
        <div role="alert" className="failed">
          <p className="error">Couldn't load your draft.</p>
          <button type="button" className="btn" onClick={() => setTurn(turn + 1)}>Retry</button>
        </div>
      )}
      <div role="toolbar" aria-label="Formatting" className="composer-bar">
        {FORMATS.map(([cmd, label, icon]) => (
          <button key={cmd} type="button" className="tb-btn" aria-label={label} title={label} disabled={!ready} onMouseDown={(e) => e.preventDefault()} onClick={() => format(cmd)}>
            {icon ? <Icon name={icon} /> : <Numbered />}
          </button>
        ))}
        <span className="tb-sep" aria-hidden="true" />
        <button type="button" className="tb-btn" aria-label="Insert link" title="Insert link" disabled={!ready} onMouseDown={(e) => e.preventDefault()} onClick={openLink}><Icon name="link" /></button>
        <button type="button" className="tb-btn" aria-label="Attach files" title="Attach files" disabled={!ready || attaching} onClick={() => void attach()}><Icon name="clip" /></button>
      </div>
      {link !== null && (
        <div className="composer-link">
          <label>
            <span className="sr-only">Link address</span>
            <input type="text" inputMode="url" value={link} placeholder="https://example.com" autoFocus onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setLink(null); }
            }} />
          </label>
          <button type="button" className="btn" onClick={applyLink}>Apply</button>
          <button type="button" className="tb-btn" aria-label="Cancel link" title="Cancel link" onClick={() => setLink(null)}><Icon name="close" /></button>
        </div>
      )}
      <div
        ref={box}
        role="textbox"
        aria-multiline="true"
        aria-label="Reply"
        aria-invalid={error ? true : undefined}
        className="composer-body"
        contentEditable={ready}
        suppressContentEditableWarning
        data-empty={blank || undefined}
        data-placeholder="Write your reply…"
        onInput={typed}
        onKeyDown={keys}
        onPaste={paste}
      />
      {error && <p role="alert" className="error"><Icon name="alert" />{error}</p>}
      {signature && (
        <div className="composer-sig">
          <p className="hint">Added when you send</p>
          <pre>{signature}</pre>
        </div>
      )}
      {files.length > 0 && (
        <ul className="composer-files" aria-label="Attachments">
          {files.map((f) => (
            <li key={f.id}>
              <span>{f.name} <span className="muted">{formatBytes(f.size)}</span></span>
              <button type="button" className="link" aria-label={`Remove ${f.name}`} onClick={() => void detach(f)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <div className="composer-foot">
        <button type="button" className="btn" disabled={!ready || (blank && files.length === 0)} onClick={() => void discard()}>Discard</button>
        <span role="status" className="hint composer-saved">{save === 'saving' ? 'Saving…' : save === 'saved' ? 'Saved as draft' : save === 'failed' ? 'Draft not saved' : ''}</span>
        <button type="submit" className="btn primary" disabled={!ready || sending || shell.offline} title={shell.offline ? 'You are offline.' : undefined}><Icon name="send" />{sending ? 'Sending…' : 'Send'}</button>
      </div>
      <p className="hint composer-keys">{shell.me.preferences?.enterToSend ? 'Enter to send · Shift+Enter for a new line' : 'Ctrl/⌘ + Enter to send'}{signature ? ' · Signature added on send' : ''}</p>
    </form>
  );
}
