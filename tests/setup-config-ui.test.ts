import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { handleSetupRequest } from '../src/api/setup';
import type { Env } from '../src/core/env';

const inheritedState = {
  ok: true, authMethod: 'telegram', databaseReady: true, settingsSource: 'env',
  storageMode: 'history', webhookConfigured: true,
  features: { activityTrackingEnabled: true, profanityEnabled: false, criminalEnabled: true },
  summary: { enabled: false, provider: 'openai', model: 'gpt-4.1-nano' },
  providers: {
    summary: { provider: 'openai', model: 'gpt-4.1-nano' },
    profanity: { provider: 'openai', model: 'gpt-4.1-nano', viaCriminalPrefilter: true },
    criminal: { provider: 'legal-rag', model: '@cf/baai/bge-m3',
      prefilterEnabled: true, prefilterProvider: 'qwen', prefilterModel: 'qwen3.7-flash',
      finalJudgeEnabled: true, finalJudgeProvider: 'OpenAI', finalJudgeModel: 'gpt-5-nano' },
  },
};

async function setupBrowser(approved = false) {
  const page = await handleSetupRequest(new Request('https://bot.example/admin/setup'), {} as Env);
  const html = await page.text();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw Error('No settings client script');

  const elements = new Map<string, any>();
  const ids = ['login', 'settings', 'logout', 'activity', 'profanity', 'criminal', 'enabled',
    'provider', 'model', 'status', 'webhook', 'connect', 'error', 'storageWarning',
    'unsavedWarning', 'save', 'configSource', 'configSummary', 'configProfanity',
    'configCriminal', 'loginForm', 'claimForm'];
  for (const id of ids) {
    const listeners = new Map<string, () => void>();
    elements.set(id, { value: '', checked: false, disabled: id === 'save', hidden: false,
      textContent: '', listeners,
      addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
    });
  }
  elements.get('provider').value = 'cloudflare';
  const radios = ['stats_only', 'history'].map(value => ({ value, checked: false, onchange: null }));
  const document = {
    getElementById: (id: string) => elements.get(id),
    querySelectorAll: (selector: string) => selector === 'input[name="storageMode"]' ? radios : [],
    querySelector: (selector: string) => selector === 'input[name="storageMode"]:checked'
      ? radios.find(radio => radio.checked) : null,
  };
  const onPageShow = vi.fn();
  const confirm = vi.fn(() => approved);
  const fetch = vi.fn(async (path: string, opts?: RequestInit) => {
    if (path === '/admin/api/setup/status') return Response.json(inheritedState);
    if (path === '/admin/api/setup/settings' && opts?.method === 'PATCH') {
      return Response.json({ ok: true, settings: JSON.parse(String(opts.body)) });
    }
    throw Error('Unexpected client call: ' + path);
  });
  runInNewContext(script, { document, window: { confirm, addEventListener: onPageShow }, fetch });
  await new Promise(resolve => setTimeout(resolve, 0));
  return { elements, fetch, radios, onPageShow, confirm };
}

describe('global setup client keeps production configuration safe', () => {
  it('loads each feature from the server and never enables Save without changes', async () => {
    const { elements, fetch, radios } = await setupBrowser();
    expect(radios.find(option => option.value === 'history')?.checked).toBe(true);
    expect(elements.get('activity').checked).toBe(true);
    expect(elements.get('profanity').checked).toBe(false);
    expect(elements.get('criminal').checked).toBe(true);
    expect(elements.get('enabled').checked).toBe(false);
    expect(elements.get('provider').value).toBe('openai');
    expect(elements.get('model').value).toBe('gpt-4.1-nano');
    expect(elements.get('configSource').textContent).toContain('Cloudflare');
    expect(elements.get('configProfanity').textContent).toContain('криминальный prefilter: включён');
    expect(elements.get('configCriminal').textContent).toContain('qwen3.7-flash');
    expect(elements.get('save').disabled).toBe(true);
    await elements.get('save').onclick();
    expect(fetch).not.toHaveBeenCalledWith('/admin/api/setup/settings', expect.anything());
  });

  it('requires confirmation before creating a global D1 override', async () => {
    const browser = await setupBrowser(false);
    browser.elements.get('profanity').checked = true;
    browser.elements.get('profanity').listeners.get('change')();
    expect(browser.elements.get('save').disabled).toBe(false);
    expect(browser.elements.get('unsavedWarning').textContent).toContain('D1');
    await browser.elements.get('save').onclick();
    expect(browser.confirm).toHaveBeenCalledOnce();
    expect(browser.fetch).not.toHaveBeenCalledWith('/admin/api/setup/settings', expect.anything());
  });

  it('re-fetches config on browser back/forward restoration', async () => {
    const browser = await setupBrowser();
    const onPageShow = browser.onPageShow.mock.calls.find(([name]) => name === 'pageshow')?.[1];
    expect(onPageShow).toBeTypeOf('function');
    browser.elements.get('profanity').checked = true;
    onPageShow({ persisted: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(browser.elements.get('profanity').checked).toBe(false);
    expect(browser.elements.get('save').disabled).toBe(true);
  });
});
