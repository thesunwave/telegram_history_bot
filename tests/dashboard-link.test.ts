import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildDashboardText,
  ensureDashboardCommand,
  resolveDashboardUrl,
  sendDashboardLink,
} from '../src/api/dashboard-link';
import { buildHelpText } from '../src/api/update';

const okJson = (result: unknown) => new Response(JSON.stringify({ ok: true, result }));

describe('dashboard link', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('prefers PUBLIC_URL over the webhook origin', () => {
    expect(resolveDashboardUrl({ PUBLIC_URL: 'https://tg.example.com/' } as any, 'https://x.workers.dev'))
      .toBe('https://tg.example.com/admin');
    expect(resolveDashboardUrl({} as any, 'https://x.workers.dev')).toBe('https://x.workers.dev/admin');
    expect(resolveDashboardUrl({} as any)).toBeNull();
  });

  it('mentions /dashboard in help and in the reply', () => {
    expect(buildHelpText({} as any)).toContain('/dashboard');
    expect(buildDashboardText('https://a.test/admin')).toContain('https://a.test/admin');
  });

  it('sends the link with an inline button', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({}));
    vi.stubGlobal('fetch', fetchMock);
    await sendDashboardLink({ TOKEN: 't' } as any, 42, 'https://a.test/admin');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.chat_id).toBe(42);
    expect(body.reply_markup.inline_keyboard[0][0].url).toBe('https://a.test/admin');
  });

  it('adds /dashboard to existing commands without dropping them', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson([{ command: 'help', description: 'Help' }]))
      .mockResolvedValueOnce(okJson(true));
    vi.stubGlobal('fetch', fetchMock);
    await ensureDashboardCommand({ TOKEN: 't' } as any);
    expect(fetchMock.mock.calls[1][0]).toContain('/setMyCommands');
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.commands.map((c: any) => c.command)).toEqual(['dashboard', 'help']);
  });

  it('does not call setMyCommands when /dashboard is already registered', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(okJson([{ command: 'dashboard', description: 'x' }]));
    vi.stubGlobal('fetch', fetchMock);
    await ensureDashboardCommand({ TOKEN: 't' } as any);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
