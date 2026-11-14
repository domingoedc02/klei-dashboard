import { useCallback, useEffect, useRef, useState } from 'react';
import type { components } from '../api/schema';
import { useShell } from '../shell/context';
import { ErrorBlock, Skeleton } from '../shell/ui';
import { TaxonomyCards } from './TaxonomyCards';

type View = Required<components['schemas']['AiSettingsView']>;
type Result = Required<components['schemas']['AiTestResult']>;
type ModelList = components['schemas']['AiModelsResult'];
type ModelKey = 'chatModel' | 'visionModel' | 'visionModelAdv' | 'embeddingModel';

const MODELS_DEBOUNCE_MS = 600;
const isHttp = (u: string) => { try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; } };
const sameOrigin = (a: string, b: string) => { try { return new URL(a).origin === new URL(b).origin; } catch { return false; } };

const PRESETS: { id: string; label: string; url: string }[] = [
  { id: 'litellm', label: 'LiteLLM (default)', url: 'https://nextgen-ai.enlinka.co' },
  { id: 'openai', label: 'OpenAI', url: 'https://api.openai.com/v1' },
  { id: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
  { id: 'groq', label: 'Groq', url: 'https://api.groq.com/openai/v1' },
  { id: 'ollama', label: 'Ollama (local, no key)', url: 'http://localhost:11434/v1' },
  { id: 'custom', label: 'Custom', url: '' },
];

interface Form {
  preset: string; baseUrl: string; embeddingBaseUrl: string; organization: string; chatModel: string; visionModel: string; visionModelAdv: string; embeddingModel: string;
  temperature: string; maxTokens: string; sensitivity: number; tone: string; advanced: boolean;
}
type TextKey = 'baseUrl' | 'embeddingBaseUrl' | 'organization' | 'temperature' | 'maxTokens';

const SENSITIVITY = ['Very loose', 'Loose', 'Balanced', 'Strict', 'Very strict'];
const TONES: { id: string; label: string; help: string }[] = [
  { id: 'warm', label: 'Warm', help: 'Friendly and personal' },
  { id: 'editorial', label: 'Editorial', help: 'Polished, magazine-style' },
  { id: 'factual', label: 'Factual', help: 'Short and specific' },
];
const toForm = (v: View): Form => ({
  preset: v.preset, baseUrl: v.baseUrl, embeddingBaseUrl: v.embeddingBaseUrl ?? '', organization: v.organization ?? '', chatModel: v.chatModel ?? '', visionModel: v.visionModel ?? '', visionModelAdv: v.visionModelAdv ?? '',
  embeddingModel: v.embeddingModel, temperature: String(v.temperature), maxTokens: String(v.maxTokens),
  sensitivity: v.sensitivity, tone: v.tone, advanced: v.advanced,
});

const STATUS: Record<string, { text: string; tone: string }> = {
  not_tested: { text: 'Not tested', tone: 'neutral' },
  connected: { text: 'Connected', tone: 'pos' },
  failed: { text: 'Failed', tone: 'warn' },
};

const MESSAGES: Record<string, string> = {
  required: 'Required.',
  invalid: 'Check this value.',
  too_long: 'Too long.',
  out_of_range: 'Out of range.',
  required_on_host_change: 'Enter the key again for this address.',
  needs_model: 'Set an advanced vision model first.',
};
const RANGES: Record<string, string> = { temperature: 'Enter a number from 0 to 2.', maxTokens: 'Enter a whole number from 64 to 8192.' };
const problemText = (field: string, code: string) => (RANGES[field] && (code === 'required' || code === 'out_of_range') ? RANGES[field] : MESSAGES[code] ?? 'Check this value.');

type Problems = Record<string, string>;
type Loaded = { ids: string[]; status: 'idle' | 'loading' | 'ready' | 'error' };

/** Fetches a provider's model ids through the backend (the key never leaves it) once `on`, debounced while the address or key is typed. */
function useModels(req: { current: (m: string, p: string, b?: unknown) => Promise<{ status: number; body: unknown }> }, on: boolean, url: string, key: string, embedding: boolean): Loaded {
  const [loaded, setLoaded] = useState<Loaded>({ ids: [], status: 'idle' });
  useEffect(() => {
    if (!on) { setLoaded({ ids: [], status: 'idle' }); return; }
    let live = true;
    setLoaded({ ids: [], status: 'loading' });
    const t = setTimeout(async () => {
      try {
        const r = await req.current('POST', '/api/v1/admin/ai/models', { baseUrl: url, ...(key ? { apiKey: key } : {}), ...(embedding ? { embedding: true } : {}) });
        if (!live) return;
        const b = r.body as ModelList | null;
        setLoaded(r.status === 200 && b && !b.failure ? { ids: b.models ?? [], status: 'ready' } : { ids: [], status: 'error' });
      } catch { if (live) setLoaded({ ids: [], status: 'error' }); }
    }, MODELS_DEBOUNCE_MS);
    return () => { live = false; clearTimeout(t); };
  }, [req, on, url, key, embedding]);
  return loaded;
}

export function AiTab() {
  const shell = useShell();
  const { toast, setDirty } = shell;
  const req = useRef(shell.request);
  req.current = shell.request;
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [saved, setSaved] = useState<View | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [key, setKey] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [embKey, setEmbKey] = useState('');
  const [embReplacing, setEmbReplacing] = useState(false);
  const [problems, setProblems] = useState<Problems>({});
  const [stale, setStale] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [testFailed, setTestFailed] = useState(false);

  const adopt = (v: View) => { setSaved(v); setForm(toForm(v)); setKey(''); setReplacing(false); setEmbKey(''); setEmbReplacing(false); };

  const load = useCallback(async () => {
    try {
      const r = await req.current<View>('GET', '/api/v1/admin/ai');
      if (r.status === 200 && r.body) {
        const v = r.body as View;
        setSaved(v); setForm(toForm(v)); setKey(''); setReplacing(false); setEmbKey(''); setEmbReplacing(false); setProblems({}); setStale(false);
        setState('ready');
        return;
      }
    } catch { /* the shell already raised the offline banner or the expiry */ }
    setState((cur) => (cur === 'ready' ? cur : 'error'));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const dirty = !!saved && !!form && (JSON.stringify(form) !== JSON.stringify(toForm(saved)) || key !== '' || embKey !== '');
  useEffect(() => { void setDirty(dirty); }, [dirty, setDirty]);
  useEffect(() => () => { void setDirty(false); }, [setDirty]);

  // Models load only once the address and a key that may go to it are known: a typed key, or the stored one for the same host.
  const url = form?.baseUrl.trim() ?? '';
  const typed = key !== '';
  const usable = isHttp(url) && (typed || (!!saved?.apiKeySet && !replacing && sameOrigin(url, saved.baseUrl)));
  const seed = saved?.models ?? [];
  const refetch = typed || url !== saved?.baseUrl || seed.length === 0;
  const loaded = useModels(req, usable && refetch, url, typed ? key : '', false);

  // A separate embeddings provider has its own address and key; a blank or same-origin address means the main one serves embeddings.
  const embUrl = form?.embeddingBaseUrl.trim() ?? '';
  const embSeparate = isHttp(embUrl) && !sameOrigin(embUrl, url);
  const embTyped = embKey !== '';
  const embStored = !!saved?.embeddingApiKeySet && !embReplacing && !!saved.embeddingBaseUrl && sameOrigin(embUrl, saved.embeddingBaseUrl);
  const embUsable = embSeparate && (embTyped || embStored);
  const embLoaded = useModels(req, embUsable, embUrl, embTyped ? embKey : '', true);
  const ids = usable ? (refetch ? loaded.ids : seed) : [];

  if (state === 'loading') return <Skeleton rows={6} height={44} />;
  if (state === 'error' || !saved || !form) return <ErrorBlock what="AI settings" onRetry={() => { setState('loading'); void load(); }} />;

  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const showKeyInput = !saved.apiKeySet || replacing;
  const showEmbKeyInput = !embStored;
  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  const status = testing ? { text: 'Testing', tone: 'neutral' } : STATUS[saved.status] ?? STATUS.not_tested;

  const save = async () => {
    setSaving(true); setProblems({}); setStale(false);
    const maxTokens = num(form.maxTokens);
    const body = {
      preset: form.preset,
      baseUrl: form.baseUrl.trim(),
      ...(key ? { apiKey: key } : {}),
      organization: form.organization.trim() || null,
      chatModel: form.chatModel.trim() || null,
      visionModel: form.visionModel.trim() || null,
      visionModelAdv: form.visionModelAdv.trim() || null,
      sensitivity: form.sensitivity,
      tone: form.tone,
      advanced: form.advanced,
      embeddingModel: form.embeddingModel.trim(),
      embeddingBaseUrl: form.embeddingBaseUrl.trim() || null,
      ...(embKey ? { embeddingApiKey: embKey } : {}),
      temperature: num(form.temperature),
      maxTokens: maxTokens !== null && Number.isInteger(maxTokens) ? maxTokens : null,
    };
    try {
      const r = await req.current<View | { fields?: { field: string; code: string }[] }>('PUT', '/api/v1/admin/ai', body, saved.version);
      if (r.status === 200 && r.body) { adopt(r.body as View); setResult(null); toast('AI settings saved'); }
      else if (r.status === 422) {
        const fields = (r.body as { fields?: { field: string; code: string }[] } | null)?.fields ?? [];
        setProblems(fields.length ? Object.fromEntries(fields.map((f) => [f.field, problemText(f.field, f.code)])) : { form: 'Check the highlighted fields.' });
      } else if (r.status === 409) setStale(true);
      else setProblems({ form: "Couldn't save. Try again." });
    } catch {
      setProblems({ form: "Couldn't reach the server. Try again." });
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true); setResult(null); setTestFailed(false);
    try {
      const r = await req.current<Result>('POST', '/api/v1/admin/ai/test');
      if (r.status === 200 && r.body) {
        setResult(r.body as Result);
        const g = await req.current<View>('GET', '/api/v1/admin/ai');
        if (g.status === 200 && g.body) setSaved((cur) => (cur ? { ...cur, status: g.body!.status ?? cur.status, testedAt: g.body!.testedAt ?? null, models: g.body!.models ?? [] } : cur));
      } else setTestFailed(true);
    } catch {
      setTestFailed(true);
    } finally {
      setTesting(false);
    }
  };

  const text = (id: TextKey, label: string, extra: { mono?: boolean; hint?: string; type?: string } = {}) => (
    <>
      <label htmlFor={`ai-${id}`}>{label}</label>
      <input
        id={`ai-${id}`} type={extra.type ?? 'text'} className={extra.mono ? 'mono' : undefined} value={form[id]} autoComplete="off" spellCheck={false}
        onChange={(e) => set({ [id]: e.target.value } as Partial<Form>)}
        aria-invalid={!!problems[id]} aria-describedby={problems[id] ? `ai-${id}-err` : undefined}
      />
      {extra.hint && !problems[id] && <p className="hint">{extra.hint}</p>}
      {problems[id] && <p id={`ai-${id}-err`} className="error">{problems[id]}</p>}
    </>
  );

  const model = (id: ModelKey, label: string) => {
    const cur = form[id];
    const own = id === 'embeddingModel' && embSeparate;
    const on = own ? embUsable : usable;
    const options = [...new Set([...(cur ? [cur] : []), ...(own ? embLoaded.ids : ids)])];
    return (
      <>
        <label htmlFor={`ai-${id}`}>{label}</label>
        <select
          id={`ai-${id}`} value={cur} disabled={!on} className={id === 'embeddingModel' ? 'mono' : undefined}
          onChange={(e) => set(id === 'visionModelAdv' && !e.target.value ? { visionModelAdv: '', advanced: false } : ({ [id]: e.target.value } as Partial<Form>))}
          aria-invalid={!!problems[id]} aria-describedby={problems[id] ? `ai-${id}-err` : own ? 'ai-emb-note' : 'ai-models-note'}
        >
          <option value="">{id === 'embeddingModel' ? 'Choose a model' : 'None'}</option>
          {options.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        {problems[id] && <p id={`ai-${id}-err`} className="error">{problems[id]}</p>}
      </>
    );
  };

  const hasAdv = form.visionModelAdv.trim() !== '';
  const modelsNote = !usable ? 'Enter the base URL and API key to load models.'
    : loaded.status === 'loading' ? 'Loading models…'
    : loaded.status === 'error' ? "Couldn't load models. Check the URL and key." : `${ids.length} models available.`;
  const embNote = !embUsable ? 'Enter the embeddings address and API key to load models.'
    : embLoaded.status === 'loading' ? 'Loading models…'
    : embLoaded.status === 'error' ? "Couldn't load models. Check the address and key." : `${embLoaded.ids.length} models available.`;

  return (
    <div className="ai">
    <form id="ai-form" className="form" noValidate onSubmit={(e) => { e.preventDefault(); if (dirty && !saving) void save(); }}>
      <p className="lede">
        Status <span className={`pill ${status.tone}`}>{status.text}</span>
        {saved.testedAt && !testing && <span className="hint"> Last tested {new Date(saved.testedAt).toLocaleString()}</span>}
      </p>

      <h2>Model provider</h2>
      <label htmlFor="ai-preset">Provider</label>
      <select id="ai-preset" value={form.preset} onChange={(e) => set({ preset: e.target.value, baseUrl: PRESETS.find((p) => p.id === e.target.value)?.url ?? '' })}>
        {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>

      {text('baseUrl', 'Base URL', { mono: true })}

      <label htmlFor="ai-key">API key</label>
      {showKeyInput ? (
        <div className="keyrow">
          <input
            id="ai-key" type="password" value={key} autoComplete="new-password" spellCheck={false} onChange={(e) => setKey(e.target.value)}
            aria-invalid={!!problems.apiKey} aria-describedby={problems.apiKey ? 'ai-key-err' : undefined}
          />
          {replacing && <button type="button" className="btn" onClick={() => { setReplacing(false); setKey(''); }}>Keep current key</button>}
        </div>
      ) : (
        <div className="keyrow">
          <input id="ai-key" className="mono" value={saved.apiKeyMask ?? '••••••••'} readOnly aria-describedby="ai-key-note" />
          <button type="button" className="btn" onClick={() => setReplacing(true)}>Replace key</button>
        </div>
      )}
      {!problems.apiKey && <p id="ai-key-note" className="hint">{showKeyInput ? 'Stored encrypted. It is never shown again.' : 'A key is stored. It is never shown again.'}</p>}
      {problems.apiKey && <p id="ai-key-err" className="error">{problems.apiKey}</p>}

      {text('organization', 'Organization (optional)')}
      <p id="ai-models-note" className={usable && loaded.status === 'error' ? 'error' : 'hint'} role={usable && loaded.status === 'error' ? 'alert' : undefined}>{modelsNote}</p>
      {model('chatModel', 'Chat model')}
      {model('visionModel', 'Vision model')}
      {model('visionModelAdv', 'Advanced vision model (optional)')}
      {text('temperature', 'Temperature', { type: 'number' })}
      {text('maxTokens', 'Max tokens', { type: 'number' })}

      <h2>AI settings</h2>
      <h3>Embeddings</h3>
      <p className="hint">Photo grouping reads each photo through an embeddings model. Leave the address blank to use the provider above.</p>
      {text('embeddingBaseUrl', 'Embeddings base URL (optional)', { mono: true })}
      {embSeparate && (
        <>
          <label htmlFor="ai-emb-key">Embeddings API key</label>
          {showEmbKeyInput ? (
            <div className="keyrow">
              <input
                id="ai-emb-key" type="password" value={embKey} autoComplete="new-password" spellCheck={false} onChange={(e) => setEmbKey(e.target.value)}
                aria-invalid={!!problems.embeddingApiKey} aria-describedby={problems.embeddingApiKey ? 'ai-emb-key-err' : undefined}
              />
              {embReplacing && <button type="button" className="btn" onClick={() => { setEmbReplacing(false); setEmbKey(''); }}>Keep current key</button>}
            </div>
          ) : (
            <div className="keyrow">
              <input id="ai-emb-key" className="mono" value="••••••••" readOnly />
              <button type="button" className="btn" onClick={() => setEmbReplacing(true)}>Replace key</button>
            </div>
          )}
          {problems.embeddingApiKey
            ? <p id="ai-emb-key-err" className="error">{problems.embeddingApiKey}</p>
            : <p className="hint">{showEmbKeyInput ? 'Stored encrypted. It is never shown again.' : 'A key is stored. It is never shown again.'}</p>}
          <p id="ai-emb-note" className={embUsable && embLoaded.status === 'error' ? 'error' : 'hint'} role={embUsable && embLoaded.status === 'error' ? 'alert' : undefined}>{embNote}</p>
        </>
      )}
      {model('embeddingModel', 'Embedding model')}

      <h3>Grouping</h3>
      <label htmlFor="ai-sensitivity">Grouping sensitivity</label>
      <input
        id="ai-sensitivity" type="range" min={1} max={5} step={1} value={form.sensitivity} aria-valuetext={SENSITIVITY[form.sensitivity - 1]}
        aria-describedby="ai-sensitivity-note" onChange={(e) => set({ sensitivity: Number(e.target.value) })}
      />
      <p id="ai-sensitivity-note" className="hint"><strong>{SENSITIVITY[form.sensitivity - 1]}.</strong> Stricter groups split more often. Looser groups merge similar angles.</p>
      {problems.sensitivity && <p className="error">Choose a value from 1 to 5.</p>}

      <fieldset className="tones">
        <legend>Description tone</legend>
        {TONES.map((t) => (
          <label key={t.id} className={`tone${form.tone === t.id ? ' on' : ''}`}>
            <input type="radio" name="ai-tone" value={t.id} checked={form.tone === t.id} onChange={() => set({ tone: t.id })} />
            <strong>{t.label}</strong>
            <span className="hint">{t.help}</span>
          </label>
        ))}
      </fieldset>
      {problems.tone && <p className="error">Choose a tone.</p>}

      <label className="switch" title={hasAdv ? undefined : 'Set an advanced vision model first.'}>
        <input
          id="ai-advanced" type="checkbox" role="switch" checked={form.advanced && hasAdv} disabled={!hasAdv}
          aria-describedby="ai-advanced-note" onChange={(e) => set({ advanced: e.target.checked })}
        />
        Advanced AI model
      </label>
      <p id="ai-advanced-note" className={problems.advanced ? 'error' : 'hint'}>
        {problems.advanced ?? (hasAdv ? 'Use the advanced vision model for photo descriptions.' : 'Set an advanced vision model first.')}
      </p>

      <h3>Test connection</h3>
      <div className="actions">
        <button type="button" className="btn" onClick={() => void test()} disabled={dirty || testing}>{testing ? 'Testing…' : 'Test connection'}</button>
        {dirty && <span className="hint">Save changes first.</span>}
      </div>
      {testFailed && <p role="alert" className="error">Couldn't run the test. Try again.</p>}
      {result && (
        <ul className="checks" aria-label="Test results">
          {result.checks.map((c) => {
            const skipped = !c.ok && c.detail === 'Skipped';
            return (
              <li key={c.id}>
                <strong>{c.label}</strong>
                <span className={`pill ${c.ok ? 'pos' : skipped ? 'neutral' : 'warn'}`}>{c.ok ? 'Passed' : skipped ? 'Skipped' : 'Failed'}</span>
                {!skipped && c.detail && <span className="hint">{c.detail}</span>}
              </li>
            );
          })}
        </ul>
      )}

      {problems.form && <p role="alert" className="error">{problems.form}</p>}
      {stale && (
        <p role="alert" className="error">
          These settings changed elsewhere. <button type="button" className="link" onClick={() => { void load(); }}>Reload</button> to see the current values.
        </p>
      )}
    </form>
    <TaxonomyCards />
    <div className="actions foot">
      <button type="submit" form="ai-form" className="btn primary" disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save AI settings'}</button>
    </div>
    </div>
  );
}
