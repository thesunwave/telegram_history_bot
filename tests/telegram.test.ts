import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendMessage } from '../src/core/telegram';
import type { Env } from '../src/core/env';

describe('telegram sendMessage', () => {
  const env = { TOKEN: 'test-token' } as Env;

  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function getSentBody(): { text: string; parse_mode: string } {
    const fetchMock = vi.mocked(fetch);
    const init = fetchMock.mock.calls[0][1];
    return JSON.parse(init?.body as string);
  }

  it('preserves Telegram HTML formatting tags and escaped entities', async () => {
    await sendMessage(
      env,
      123,
      '<b>Описание:</b> <i>&quot;Публичное оправдание терроризма&quot;</i>'
    );

    expect(getSentBody()).toMatchObject({
      text: '<b>Описание:</b> <i>&quot;Публичное оправдание терроризма&quot;</i>',
      parse_mode: 'HTML',
    });
  });

  it('escapes unsupported HTML tags in plain text', async () => {
    await sendMessage(env, 123, 'Текст <script>alert(1)</script> & данные');

    expect(getSentBody().text).toBe('Текст &lt;script&gt;alert(1)&lt;/script&gt; &amp; данные');
  });

  it('keeps malformed Telegram HTML tags escaped', async () => {
    await sendMessage(env, 123, 'Описание: <i>без закрытия');

    expect(getSentBody().text).toBe('Описание: &lt;i&gt;без закрытия');
  });

  it('converts basic markdown bold and escapes its content', async () => {
    await sendMessage(env, 123, '**Заголовок <опасно>**');

    expect(getSentBody().text).toBe('<b>Заголовок &lt;опасно&gt;</b>');
  });
});
