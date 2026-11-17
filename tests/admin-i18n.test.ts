import { describe, expect, it } from 'vitest';
import type { Env } from '../src/core/env';
import { renderAdminHtml } from '../src/api/admin-html';
import { createAdminTranslator, resolveAdminLanguage } from '../src/api/admin-i18n';
import { handleSetupRequest } from '../src/api/setup';

const principal = { type: 'telegram', username: 'admin', telegramId: 123 };

// Russian that must survive in English: the language switch label and code that
// parses Russian data coming from the bot (criminal article titles, bucket labels).
const ALLOWED_RUSSIAN = [
  'Русский',
  '{"Утро":"Morning","День":"Afternoon","Вечер":"Evening","Ночь":"Night"}',
  '/^Участник (\\d+)$/',
  '/^Статья\\s+/i',
  '/\\s+УК\\s+РФ$/i',
  "'срок не распознан'",
];

function untranslated(html: string): string[] {
  const stripped = ALLOWED_RUSSIAN.reduce((text, allowed) => text.replaceAll(allowed, ''), html);
  return stripped.split('\n').filter((line) => /[А-Яа-яЁё]/.test(line)).map((line) => line.trim());
}

function request(headers: Record<string, string>): Request {
  return new Request('https://bot.example/admin', { headers });
}

describe('admin i18n', () => {
  it('keeps Russian as the default dashboard language', () => {
    const html = renderAdminHtml({ principal });
    expect(html).toContain('<html lang="ru">');
    expect(html).toContain("const LOCALE = 'ru-RU';");
    expect(html).toContain('<option value="ru" selected>Русский</option>');
  });

  it('renders the whole dashboard in English', () => {
    const html = renderAdminHtml({ principal, canAccessSetup: true, language: 'en' });
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<span>Overview</span>');
    expect(html).toContain('<option value="light">Light</option>');
    expect(html).toContain("const LOCALE = 'en-US';");
    expect(html).toContain('<option value="en" selected>English</option>');
    expect(untranslated(html)).toEqual([]);
  });

  it('renders the bot setup page in English', async () => {
    const env = { TOKEN: '123:test-token' } as unknown as Env;
    const response = await handleSetupRequest(
      new Request('https://bot.example/admin/setup', { headers: { Cookie: 'admin_lang=en' } }),
      env,
    );
    const html = await response.text();
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('Bot setup');
    expect(untranslated(html)).toEqual([]);
  });

  it('builds plural arrays and escapes JS literals', () => {
    expect(createAdminTranslator('ru').forms('день|дня|дней')).toBe("['день', 'дня', 'дней']");
    expect(createAdminTranslator('en').forms('день|дня|дней')).toBe("['day', 'days', 'days']");
    expect(createAdminTranslator('en').js('Анализ текущего дня не завершён')).toBe(
      "'Today’s analysis is not finished'",
    );
    expect(createAdminTranslator('en').js("it's")).toBe("'it\\'s'");
  });

  it('prefers the saved cookie, then Accept-Language', () => {
    expect(resolveAdminLanguage(request({}))).toBe('ru');
    expect(resolveAdminLanguage(request({ 'Accept-Language': 'en-US,en;q=0.9' }))).toBe('en');
    expect(resolveAdminLanguage(request({ 'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8' }))).toBe('ru');
    expect(resolveAdminLanguage(request({ 'Accept-Language': 'en;q=0.5,uk;q=0.9' }))).toBe('ru');
    expect(resolveAdminLanguage(request({ 'Accept-Language': 'de-DE,fr;q=0.8' }))).toBe('en');
    expect(resolveAdminLanguage(request({
      'Accept-Language': 'ru-RU',
      Cookie: 'theme=dark; admin_lang=en',
    }))).toBe('en');
    expect(resolveAdminLanguage(request({
      'Accept-Language': 'en-US',
      Cookie: 'admin_lang=ru',
    }))).toBe('ru');
  });
});
