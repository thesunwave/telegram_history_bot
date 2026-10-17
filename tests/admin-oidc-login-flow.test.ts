import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { renderAdminHtml } from '../src/api/admin-html';

function loginHarness(options: { clientId?: number | null; sdkAvailable?: boolean; authAccepted?: boolean } = {}) {
  const html = renderAdminHtml({ botUsername: 'stats_bot', principal: null });
  const match = html.match(/    async function showLogin\(\) \{[\s\S]*?\n    \}\n\n    function showDashboardShell/);
  if (!match) throw new Error('Unable to find login handler');
  const functionSource = match[0].replace(/\n\n    function showDashboardShell$/, '');
  const elements = new Map<string, any>();
  for (const id of ['loginPanel', 'controls', 'dashboard', 'dashboardToolbar', 'status',
    'sessionLabel', 'loginHint', 'telegramLoginButton']) {
    const handlers = new Map<string, () => void>();
    elements.set(id, {
      textContent: '', disabled: id === 'telegramLoginButton', handlers,
      classList: { add: vi.fn(), remove: vi.fn() },
      addEventListener: (name: string, callback: () => void) => handlers.set(name, callback),
    });
  }
  let sdk: any;
  let authCallback: (result: any) => Promise<void>;
  const auth = vi.fn((_options, cb: typeof authCallback) => { authCallback = cb; });
  const location = { assign: vi.fn() };
  const fetchMock = vi.fn(async (path: string, request?: RequestInit) => {
    if (path === '/auth/telegram/config') {
      return Response.json({ clientId: options.clientId === undefined ? 7807841637 : options.clientId,
        nonce: 'nonce-from-server' });
    }
    if (path === '/auth/telegram') {
      expect(request?.method).toBe('POST');
      expect(request?.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(JSON.parse(String(request?.body))).toEqual({ id_token: 'signed-oidc-jwt' });
      return Response.json({ ok: true, redirectTo: '/admin' }, {
        status: options.authAccepted === false ? 401 : 200,
      });
    }
    throw new Error('Unexpected fetch: ' + path);
  });
  const window = { Telegram: { Login: options.sdkAvailable === false ? undefined : { auth } }, location };
  const document = {
    getElementById: (id: string) => elements.get(id),
    createElement: vi.fn(() => (sdk = { async: false, src: '', onload: null, onerror: null })),
    head: { append: vi.fn(() => sdk.onload?.()) },
  };
  const showLogin = runInNewContext('(' + functionSource.trim() + ')', {
    document, window, fetch: fetchMock,
  }) as () => Promise<void>;
  return { html, showLogin, fetchMock, auth, location, elements, document,
    getSdk: () => sdk, callback: (value: any) => authCallback(value) };
}

describe('Telegram login browser flow', () => {
  it('uses the new SDK and completes OIDC login from button click to session', async () => {
    const h = loginHarness();
    await h.showLogin();
    expect(h.getSdk().src).toBe('https://oauth.telegram.org/js/telegram-login.js');
    expect(h.html).not.toContain('telegram-widget.js');
    const button = h.elements.get('telegramLoginButton');
    expect(button.disabled).toBe(false);
    button.handlers.get('click')();
    expect(h.auth).toHaveBeenCalledWith({
      client_id: 7807841637, scope: ['profile'], nonce: 'nonce-from-server',
    }, expect.any(Function));
    await h.callback({ id_token: 'signed-oidc-jwt' });
    expect(h.fetchMock).toHaveBeenCalledWith('/auth/telegram', expect.any(Object));
    expect(h.location.assign).toHaveBeenCalledWith('/admin');
  });

  it('fails safely when OIDC is unconfigured or the new SDK is missing', async () => {
    const noConfig = loginHarness({ clientId: null });
    await noConfig.showLogin();
    expect(noConfig.elements.get('telegramLoginButton').disabled).toBe(true);
    expect(noConfig.document.createElement).not.toHaveBeenCalled();
    const missingSdk = loginHarness({ sdkAvailable: false });
    await missingSdk.showLogin();
    expect(missingSdk.elements.get('telegramLoginButton').disabled).toBe(true);
    expect(missingSdk.elements.get('loginHint').textContent).toContain('инициализировать');
  });

  it('does not redirect if the server rejects an OIDC ID token', async () => {
    const h = loginHarness({ authAccepted: false });
    await h.showLogin();
    h.elements.get('telegramLoginButton').handlers.get('click')();
    await h.callback({ id_token: 'signed-oidc-jwt' });
    expect(h.location.assign).not.toHaveBeenCalled();
    expect(h.elements.get('loginHint').textContent).toContain('Не удалось подтвердить вход');
  });
});
