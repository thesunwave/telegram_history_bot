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
    for (const path of [
      '/', '/index.html', '/ru', '/ru/', '/ru/index.html',
      '/combot-alternative', '/robots.txt', '/sitemap.xml', '/landing/overview.jpg',
    ]) {
      const result = await worker.fetch(new Request(origin + path), env, fakeContext);
      expect(await result.text()).toBe('landing: ' + path);
      expect(result.headers.get('X-Source')).toBe('separate-landing-worker');
    }
    expect(fetch).toHaveBeenCalledTimes(9);
    for (const path of ['/en', '/en/', '/en/index.html']) {
      const result = await worker.fetch(new Request(origin + path), env, fakeContext);
      expect(result.status).toBe(301);
      expect(result.headers.get('Location')).toBe(origin + '/');
    }
    expect(fetch).toHaveBeenCalledTimes(9);
    const oldEnglish = await worker.fetch(new Request(origin + '/en?utm_source=bookmark'), env, fakeContext);
    expect(oldEnglish.headers.get('Location')).toBe(origin + '/?utm_source=bookmark');
    const head = await worker.fetch(new Request(origin + '/sitemap.xml', { method: 'HEAD' }), env, fakeContext);
    expect(head.status).toBe(200);
    const loginConfig = await worker.fetch(new Request(origin + '/auth/telegram/config'), env, fakeContext);
    expect(loginConfig.status).toBe(200);
    expect((await loginConfig.json() as { clientId: number }).clientId).toBe(7807841637);
    expect(fetch).toHaveBeenCalledTimes(10);
  });

  it('keeps standalone bot installs usable without a landing binding', async () => {
    const env = {} as Env;
    const root = await worker.fetch(new Request(origin + '/'), env, fakeContext);
    expect(root.status).toBe(302);
    expect(root.headers.get('Location')).toBe(origin + '/admin');
    const english = await worker.fetch(new Request(origin + '/en'), env, fakeContext);
    expect(english.status).toBe(301);
    expect(english.headers.get('Location')).toBe(origin + '/');
    const russian = await worker.fetch(new Request(origin + '/ru'), env, fakeContext);
    expect(russian.status).toBe(302);
    expect(russian.headers.get('Location')).toBe(origin + '/admin');
    const image = await worker.fetch(new Request(origin + '/landing/overview.jpg'), env, fakeContext);
    expect(image.status).toBe(404);
    const sitemap = await worker.fetch(new Request(origin + '/sitemap.xml'), env, fakeContext);
    expect(sitemap.status).toBe(302);
  });
});
