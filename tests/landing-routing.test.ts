import { describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/core/env';

const origin = 'https://tghistory.thesunwave.space';
const fakeContext = { waitUntil() {} } as any;

describe('standalone landing service routing', () => {
  it('proxies only the public landing paths to the separate Worker', async () => {
    const fetch = vi.fn(async (req: Request) => new Response('landing: ' + new URL(req.url).pathname, {
      headers: { 'X-Source': 'separate-landing-worker' },
    }));
    const env = { LANDING: { fetch }, TELEGRAM_LOGIN_CLIENT_ID: '7807841637' } as unknown as Env;
    for (const path of ['/', '/index.html', '/landing/overview.jpg']) {
      const result = await worker.fetch(new Request(origin + path), env, fakeContext);
      expect(await result.text()).toBe('landing: ' + path);
      expect(result.headers.get('X-Source')).toBe('separate-landing-worker');
    }
    expect(fetch).toHaveBeenCalledTimes(3);
    const loginConfig = await worker.fetch(new Request(origin + '/auth/telegram/config'), env, fakeContext);
    expect(loginConfig.status).toBe(200);
    expect((await loginConfig.json() as { clientId: number }).clientId).toBe(7807841637);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('keeps standalone bot installs usable without a landing binding', async () => {
    const env = {} as Env;
    const root = await worker.fetch(new Request(origin + '/'), env, fakeContext);
    expect(root.status).toBe(302);
    expect(root.headers.get('Location')).toBe(origin + '/admin');
    const image = await worker.fetch(new Request(origin + '/landing/overview.jpg'), env, fakeContext);
    expect(image.status).toBe(404);
  });

  it('routes a fresh one-token installation to its setup wizard', async () => {
    const env = { TOKEN: 'botfather-token' } as Env;
    const root = await worker.fetch(new Request(origin + '/'), env, fakeContext);
    expect(root.status).toBe(302);
    expect(root.headers.get('Location')).toBe(origin + '/admin/setup');
  });
});
