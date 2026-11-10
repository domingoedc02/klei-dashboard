import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from '../shell/Shell';
import type { Me } from '../shell/context';

const mocks = vi.hoisted(() => ({ request: vi.fn(), setDirty: vi.fn() }));
vi.mock('../bridge', async (orig) => ({ ...(await orig<typeof import('../bridge')>()), bridge: mocks }));

const ADMIN: Me = { id: 'a1', name: 'Ada Admin', email: 'ada@example.test', role: 'Admin', permissions: ['PERM_AI_SETTINGS'] };
const STAFF: Me = { id: 's1', name: 'Sam Staff', email: 'sam@example.test', role: 'Staff', permissions: ['PERM_VIEW_GALLERY'] };
const view = (over: object = {}) => ({
  preset: 'litellm', baseUrl: 'https://nextgen-ai.enlinka.co', apiKeySet: false, apiKeyMask: null, organization: null, chatModel: null,
  visionModel: null, visionModelAdv: null, sensitivity: 3, tone: 'warm', advanced: false, embeddingModel: 'dinov2-base', temperature: 0.7, maxTokens: 1024, status: 'not_tested', testedAt: null, models: [], version: 0, ...over,
});
const withKey = (over: object = {}) => view({ apiKeySet: true, apiKeyMask: '••••••••', version: 3, ...over });
const item = (type: string, value: string, version = 0) => ({ id: `${type}-${value}`, type, value, version });
const tax = (over: Record<string, string[]> = {}) => ({
  groups: ['silhouette', 'fabric', 'neckline', 'sleeve', 'train'].map((t) => ({ type: t, values: (over[t] ?? [t === 'fabric' ? 'Mikado' : 'Plain']).map((v) => item(t, v)) })),
});
const calls = (m: string) => mocks.request.mock.calls.filter((c) => c[0] === m);

function mount(me: Me = ADMIN) {
  window.location.hash = '#/settings/ai';
  return render(<Shell me={me} onExpired={vi.fn()} onSignOut={vi.fn()} />);
}
async function open(first: object = withKey(), extra?: (m: string, p: string) => unknown) {
  mocks.request.mockImplementation(async (m: string, p: string) => {
    const e = extra?.(m, p);
    if (e) return e;
    if (m === 'GET' && p === '/api/v1/taxonomy') return { status: 200, body: tax() };
    return m === 'GET' && p === '/api/v1/admin/ai' ? { status: 200, body: first } : { status: 200, body: null };
  });
  const v = mount();
  await screen.findByLabelText('Base URL');
  return v;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.setDirty.mockResolvedValue(undefined);
});

describe('AI provider settings', () => {
  it('shows the tab only with PERM_AI_SETTINGS', () => {
    mocks.request.mockResolvedValue({ status: 200, body: null });
    mount(STAFF);
    expect(screen.queryByRole('button', { name: 'AI settings' })).toBeNull();
  });

  it('shows the form with the key masked, Save and Test disabled, and passes axe', async () => {
    const { container } = await open();
    expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe('••••••••');
    expect(screen.getByRole('button', { name: 'Replace key' })).toBeTruthy();
    expect(screen.getByText('Not tested')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save AI settings' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Test connection' }) as HTMLButtonElement).disabled).toBe(false);
    const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });

  it('a preset fills the base URL; a change enables Save and disables Test with a hint', async () => {
    await open();
    await userEvent.selectOptions(screen.getByLabelText('Provider'), 'groq');
    expect((screen.getByLabelText('Base URL') as HTMLInputElement).value).toBe('https://api.groq.com/openai/v1');
    expect((screen.getByRole('button', { name: 'Save AI settings' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Test connection' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Save changes first.')).toBeTruthy();
  });

  it('saves with the version as If-Match, sends the key only when typed, and never shows it again', async () => {
    await open(view());
    await userEvent.type(screen.getByLabelText('API key'), 'sk-secret');
    mocks.request.mockResolvedValueOnce({ status: 200, body: withKey({ version: 1 }) });
    await userEvent.click(screen.getByRole('button', { name: 'Save AI settings' }));
    await screen.findByText('AI settings saved');
    const put = calls('PUT')[0];
    expect(put[1]).toBe('/api/v1/admin/ai');
    expect(put[2]).toMatchObject({ preset: 'litellm', apiKey: 'sk-secret', embeddingModel: 'dinov2-base', temperature: 0.7, maxTokens: 1024 });
    expect(put[3]).toBe(0);
    expect(document.body.textContent).not.toContain('sk-secret');
    expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe('••••••••');
  });

  it('shows field problems from a 422 by code, without echoing values', async () => {
    await open();
    await userEvent.clear(screen.getByLabelText('Max tokens'));
    await userEvent.type(screen.getByLabelText('Max tokens'), '5');
    mocks.request.mockResolvedValueOnce({ status: 422, body: { fields: [{ field: 'maxTokens', code: 'out_of_range' }] } });
    await userEvent.click(screen.getByRole('button', { name: 'Save AI settings' }));
    expect(await screen.findByText('Enter a whole number from 64 to 8192.')).toBeTruthy();
    expect((screen.getByLabelText('Max tokens') as HTMLInputElement).getAttribute('aria-invalid')).toBe('true');
  });

  it('on a 409 offers Reload', async () => {
    await open();
    await userEvent.type(screen.getByLabelText('Organization (optional)'), 'org');
    mocks.request.mockResolvedValueOnce({ status: 409, body: null });
    await userEvent.click(screen.getByRole('button', { name: 'Save AI settings' }));
    expect(await screen.findByRole('button', { name: 'Reload' })).toBeTruthy();
  });

  it('runs Test connection and lists the three results', async () => {
    const checks = [
      { id: 'reachable', label: 'Provider reachable', ok: true, detail: 'ok' },
      { id: 'models', label: 'Models loaded', ok: true, detail: '2 models' },
      { id: 'embedding', label: 'Image embedding', ok: false, detail: 'Provider error 500' },
    ];
    await open(withKey(), (m, p) => (m === 'POST' && p === '/api/v1/admin/ai/test' ? { status: 200, body: { checks, status: 'failed' } } : null));
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    const list = await screen.findByRole('list', { name: 'Test results' });
    expect(list.textContent).toContain('Provider reachable');
    expect(list.textContent).toContain('Image embedding');
    expect(list.textContent).toContain('Provider error 500');
    expect(calls('POST')[0].slice(0, 2)).toEqual(['POST', '/api/v1/admin/ai/test']);
  });

  it('shows an error block with Retry when loading fails', async () => {
    mocks.request.mockResolvedValue({ status: 500, body: null });
    mount();
    await screen.findByText("Couldn't load AI settings.");
    mocks.request.mockResolvedValue({ status: 200, body: withKey() });
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByLabelText('Base URL')).toBeTruthy());
  });

  const MODEL_LABELS = ['Chat model', 'Vision model', 'Advanced vision model (optional)', 'Embedding model'];
  const disabledModels = () => MODEL_LABELS.map((l) => (screen.getByLabelText(l) as HTMLSelectElement).disabled);
  const modelCalls = () => calls('POST').filter((c) => c[1] === '/api/v1/admin/ai/models');

  it('keeps the model lists disabled until the address and a key are given, then loads them from /models', async () => {
    await open(view());
    expect(disabledModels()).toEqual([true, true, true, true]);
    expect(screen.getByText('Enter the base URL and API key to load models.')).toBeTruthy();
    expect(modelCalls()).toHaveLength(0);
    mocks.request.mockImplementation(async (m: string, p: string) =>
      m === 'POST' && p === '/api/v1/admin/ai/models' ? { status: 200, body: { models: ['gpt-a', 'dino-b'], failure: null } } : { status: 200, body: null });
    await userEvent.type(screen.getByLabelText('API key'), 'sk-typed');
    expect(disabledModels()).toEqual([false, false, false, false]);
    await waitFor(() => expect(within(screen.getByLabelText('Chat model')).getAllByRole('option')).toHaveLength(3), { timeout: 3000 });
    expect(modelCalls()).toHaveLength(1);
    expect(modelCalls()[0][2]).toEqual({ baseUrl: 'https://nextgen-ai.enlinka.co', apiKey: 'sk-typed' });
    expect(within(screen.getByLabelText('Chat model')).getAllByRole('option').map((o) => o.textContent)).toEqual(['None', 'gpt-a', 'dino-b']);
    await userEvent.selectOptions(screen.getByLabelText('Embedding model'), 'dino-b');
    expect((screen.getByLabelText('Embedding model') as HTMLSelectElement).value).toBe('dino-b');
  });

  it('uses the saved list with the stored key at once, but disables it again for another host', async () => {
    await open(withKey({ models: ['saved-a'], chatModel: 'saved-a' }));
    expect(disabledModels()).toEqual([false, false, false, false]);
    expect((screen.getByLabelText('Chat model') as HTMLSelectElement).value).toBe('saved-a');
    expect(modelCalls()).toHaveLength(0);
    const url = screen.getByLabelText('Base URL');
    await userEvent.clear(url);
    await userEvent.type(url, 'https://other.example.test/v1');
    expect(disabledModels()).toEqual([true, true, true, true]);
    expect(screen.getByLabelText('Chat model') as HTMLSelectElement).toHaveProperty('value', 'saved-a');
    expect(modelCalls()).toHaveLength(0);
  });

  it('a separate embeddings address brings its own key and its own model list, and saves both', async () => {
    await open(withKey({ models: ['chat-a'], chatModel: 'chat-a' }));
    expect(screen.queryByLabelText('Embeddings API key')).toBeNull();
    expect((screen.getByLabelText('Embedding model') as HTMLSelectElement).disabled).toBe(false);
    mocks.request.mockImplementation(async (m: string, p: string, b?: { baseUrl?: string }) =>
      m === 'POST' && p === '/api/v1/admin/ai/models' ? { status: 200, body: { models: b?.baseUrl?.includes('embed') ? ['dino-x'] : ['chat-a'], failure: null } } : { status: 200, body: null });
    await userEvent.type(screen.getByLabelText('Embeddings base URL (optional)'), 'https://embed.example.test/v1');
    expect((screen.getByLabelText('Embedding model') as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByText('Enter the embeddings address and API key to load models.')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Embeddings API key'), 'sk-embed');
    await waitFor(() => expect(within(screen.getByLabelText('Embedding model')).getAllByRole('option').map((o) => o.textContent)).toContain('dino-x'), { timeout: 3000 });
    expect(modelCalls().at(-1)?.[2]).toEqual({ baseUrl: 'https://embed.example.test/v1', apiKey: 'sk-embed', embedding: true });
    await userEvent.selectOptions(screen.getByLabelText('Embedding model'), 'dino-x');
    mocks.request.mockResolvedValueOnce({ status: 200, body: withKey({ version: 4, embeddingBaseUrl: 'https://embed.example.test/v1', embeddingApiKeySet: true, embeddingModel: 'dino-x' }) });
    await userEvent.click(screen.getByRole('button', { name: 'Save AI settings' }));
    await screen.findByText('AI settings saved');
    expect(calls('PUT')[0][2]).toMatchObject({ embeddingBaseUrl: 'https://embed.example.test/v1', embeddingApiKey: 'sk-embed', embeddingModel: 'dino-x' });
    expect(document.body.textContent).not.toContain('sk-embed');
    expect((screen.getByLabelText('Embeddings API key') as HTMLInputElement).value).toBe('••••••••');
  });

  it('a blank embeddings address sends null and no key', async () => {
    await open(withKey({ embeddingBaseUrl: 'https://embed.example.test/v1', embeddingApiKeySet: true, models: ['m'] }));
    await userEvent.clear(screen.getByLabelText('Embeddings base URL (optional)'));
    expect(screen.queryByLabelText('Embeddings API key')).toBeNull();
    mocks.request.mockResolvedValueOnce({ status: 200, body: withKey({ version: 4 }) });
    await userEvent.click(screen.getByRole('button', { name: 'Save AI settings' }));
    await screen.findByText('AI settings saved');
    const body = calls('PUT')[0][2];
    expect(body.embeddingBaseUrl).toBeNull();
    expect('embeddingApiKey' in body).toBe(false);
  });

  it('shows a missing embeddings key from a 422', async () => {
    await open(withKey({ models: ['m'] }));
    await userEvent.type(screen.getByLabelText('Embeddings base URL (optional)'), 'https://embed.example.test/v1');
    mocks.request.mockResolvedValueOnce({ status: 422, body: { fields: [{ field: 'embeddingApiKey', code: 'required' }] } });
    await userEvent.click(screen.getByRole('button', { name: 'Save AI settings' }));
    expect(await screen.findByText('Required.')).toBeTruthy();
  });

  it('says so when the models cannot be loaded and keeps the form usable', async () => {
    await open(view());
    mocks.request.mockImplementation(async () => ({ status: 200, body: { models: [], failure: 'Unauthorized' } }));
    await userEvent.type(screen.getByLabelText('API key'), 'sk-bad');
    expect(await screen.findByText("Couldn't load models. Check the URL and key.", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByText(/Unauthorized/)).toBeNull();
    expect((screen.getByLabelText('Base URL') as HTMLInputElement).disabled).toBe(false);
  });

  it('the grouping slider shows its label, and a change enables Save and is sent', async () => {
    await open();
    expect(screen.getByText('Balanced.')).toBeTruthy();
    expect(screen.getByText(/Stricter groups split more often/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Grouping sensitivity'), { target: { value: '5' } });
    expect(screen.getByText('Very strict.')).toBeTruthy();
    mocks.request.mockResolvedValueOnce({ status: 200, body: withKey({ sensitivity: 5, version: 4 }) });
    await userEvent.click(screen.getByRole('button', { name: 'Save AI settings' }));
    await screen.findByText('AI settings saved');
    expect(calls('PUT')[0][2]).toMatchObject({ sensitivity: 5, tone: 'warm', advanced: false });
  });

  it('tone radios carry their help text and the chosen one is sent', async () => {
    await open();
    expect((screen.getByRole('radio', { name: /Warm/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('Polished, magazine-style')).toBeTruthy();
    await userEvent.click(screen.getByRole('radio', { name: /Factual/ }));
    mocks.request.mockResolvedValueOnce({ status: 200, body: withKey({ tone: 'factual', version: 4 }) });
    await userEvent.click(screen.getByRole('button', { name: 'Save AI settings' }));
    await screen.findByText('AI settings saved');
    expect(calls('PUT')[0][2]).toMatchObject({ tone: 'factual' });
  });

  it('the advanced switch is disabled with a reason until an advanced vision model is set', async () => {
    await open(withKey({ models: ['big-vision'] }));
    const sw = screen.getByRole('switch', { name: 'Advanced AI model' }) as HTMLInputElement;
    expect(sw.disabled).toBe(true);
    expect(screen.getAllByText('Set an advanced vision model first.').length).toBeGreaterThan(0);
    await userEvent.selectOptions(screen.getByLabelText('Advanced vision model (optional)'), 'big-vision');
    expect(sw.disabled).toBe(false);
    await userEvent.click(sw);
    expect(sw.checked).toBe(true);
    await userEvent.selectOptions(screen.getByLabelText('Advanced vision model (optional)'), '');
    expect(sw.disabled).toBe(true);
    expect(sw.checked).toBe(false);
  });

  it('shows the five taxonomy cards and passes axe with them', async () => {
    const { container } = await open();
    for (const t of ['Silhouette', 'Fabric', 'Neckline', 'Sleeve', 'Train']) expect(await screen.findByRole('heading', { name: t })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Mikado' })).toBeTruthy();
    const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });

  it('Enter adds a trimmed tag at once with a toast; an empty value sends nothing', async () => {
    await open();
    const input = await screen.findByLabelText('Add Fabric tag');
    await userEvent.type(input, '   {Enter}');
    expect(calls('PUT')).toHaveLength(0);
    expect((screen.getByRole('button', { name: 'Add to Fabric' }) as HTMLButtonElement).disabled).toBe(true);
    mocks.request.mockResolvedValueOnce({ status: 200, body: tax({ fabric: ['Mikado', 'Satin'] }) });
    await userEvent.type(input, '  Satin {Enter}');
    expect(await screen.findByText('Added Satin')).toBeTruthy();
    expect(calls('PUT')[0].slice(0, 3)).toEqual(['PUT', '/api/v1/taxonomy', { op: 'add', type: 'fabric', value: 'Satin' }]);
    expect((input as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: 'Remove Satin' })).toBeTruthy();
    expect(document.querySelector('[aria-label="Add Fabric tag"]')).toBeTruthy();
  });

  it('a duplicate is a 422 shown under the card', async () => {
    await open();
    const input = await screen.findByLabelText('Add Fabric tag');
    mocks.request.mockResolvedValueOnce({ status: 422, body: { fields: [{ field: 'value', code: 'duplicate' }] } });
    await userEvent.type(input, 'mikado{Enter}');
    expect(await screen.findByText('That tag already exists.')).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('removing sends the version; a value in use opens the dialog with OK only', async () => {
    await open();
    mocks.request.mockResolvedValueOnce({ status: 409, body: { extensions: { usedBy: 4 } } });
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Mikado' }));
    expect(calls('PUT')[0].slice(0, 4)).toEqual(['PUT', '/api/v1/taxonomy', { op: 'remove', id: 'fabric-Mikado' }, 0]);
    expect(await screen.findByText('Used by 4 gowns. Reassign them first.')).toBeTruthy();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByRole('button').map((b) => b.textContent)).toEqual(['OK']);
    await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove Mikado' })).toBeTruthy();
  });

  it('removing an unused tag drops it with a toast', async () => {
    await open();
    mocks.request.mockResolvedValueOnce({ status: 200, body: tax({ fabric: [] }) });
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Mikado' }));
    expect(await screen.findByText('Removed Mikado')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove Mikado' })).toBeNull();
  });

  it('taxonomy load failure shows its own error block with Retry', async () => {
    await open(withKey(), (m, p) => (m === 'GET' && p === '/api/v1/taxonomy' ? { status: 500, body: null } : null));
    await screen.findByText("Couldn't load tag taxonomy.");
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
