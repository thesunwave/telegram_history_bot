import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { renderAdminHtml } from '../src/api/admin-html';
import { localizeAchievementBadge } from '../src/api/admin-i18n';
import { progressCopy } from '../src/features/achievements/progress-copy';
import type { AchievementProgress } from '../src/features/achievements/progress';
import { GROUP_BADGES, PERSONAL_BADGES, personalRules, weeklyRules } from '../src/features/achievements/rules';
import { CONVERSATION_BADGES } from '../src/features/achievements/social-score';

const catalog = [...GROUP_BADGES, ...PERSONAL_BADGES, ...CONVERSATION_BADGES];
const principal = { type: 'telegram', username: 'owner', telegramId: 12 };

class Element {
  children: Element[] = [];
  classList = { add: vi.fn(), remove: vi.fn() };
  setAttribute = vi.fn();
  constructor(public tag: string, public className = '', public textContent = '') {}
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren(...children: Element[]) { this.children = children; }
  all(): Element[] { return [this, ...this.children.flatMap(child => child.all())]; }
}

function view() {
  const html = renderAdminHtml({ language: 'en', principal });
  const script = html.split('// ---------- achievements ----------')[1].split('// ---------- forwards ----------')[0];
  const elements = new Map<string, Element>();
  const node = (id: string) => {
    if (!elements.has(id)) elements.set(id, new Element('div'));
    return elements.get(id)!;
  };
  const state = { chatId: '-123', view: 'achievements', achievementRequestId: 0 };
  const fetch = vi.fn(), redirectToLogin = vi.fn();
  const document = { getElementById: node, hidden: false };
  const ui = runInNewContext(script + '\n({ renderAchievements, loadAchievements })', {
    state, fetch, redirectToLogin, document,
    el: (tag: string, name?: string, text?: string) => new Element(tag, name, text),
    formatNumber: String, fmt: (text: string, values: Record<string, number>) =>
      text.replace(/\{(\w+)\}/g, (_, key) => String(values[key])),
  });
  return { ui, node, state, fetch, html, redirectToLogin, document };
}

const badges = catalog.map(b => localizeAchievementBadge('en', {
  ...b, earnedDay: null, current: null, target: null, result: null,
  conversation: CONVERSATION_BADGES.some(badge => badge.id === b.id),
}));
const data = {
  group: { enabled: true, badges: badges.slice(0, 6) },
  personal: { state: 'not-enrolled', badges: badges.slice(6), albumUrl: 'https://t.me/example_bot?start=ach_123' },
};

describe('dashboard achievement collections', () => {
  it('shows the complete locked preview, the opt-in link and same-origin posters', () => {
    const { ui, node, html } = view();
    expect(html).toContain('href="#achievements" data-view-link="achievements"');
    ui.renderAchievements(data);
    const all = node('achievementAlbum').all();
    const posters = all.filter(e => e.tag === 'img');
    expect(posters).toHaveLength(21);
    expect(posters).toEqual(expect.arrayContaining(badges.map(b => expect.objectContaining({
      src: '/admin/badge-art/' + b.id + '.png', alt: '',
    }))));
    expect(all).toContainEqual(expect.objectContaining({ href: data.personal.albumUrl }));
    expect(all.filter(e => e.tag === 'progress')).toHaveLength(0);
    expect(all.map(e => e.textContent)).not.toContain('0 of 15 unlocked');
  });

  it('uses the protected URL and conversation section supplied for an earned secret badge', () => {
    const { ui, node, html } = view();
    const posterUrl = '/admin/api/achievements/secret-poster?chatId=-123';
    expect(html).not.toContain('dutch-rudder');
    ui.renderAchievements({
      group: data.group,
      personal: { ...data.personal, state: 'available', badges: [{
        id: 'dutch-rudder', title: 'Dutch Rudder', earnedDay: '2026-11-23',
        conversation: true, posterUrl,
      }] },
    });
    const all = node('achievementAlbum').all();
    expect(all).toContainEqual(expect.objectContaining({ tag: 'img', src: posterUrl }));
    expect(all).toContainEqual(expect.objectContaining({ tag: 'h4', textContent: 'Dutch Rudder' }));
  });

  it('shows a dated group result, private progress and the paused-album state', () => {
    const { ui, node } = view();
    ui.renderAchievements({
      group: { enabled: false, badges: [{ ...badges[0], earnedDay: '2026-11-22', result: '42 messages' }] },
      personal: { state: 'available', badges: [{ ...badges[6], current: 1, target: 2 }] },
    });
    let all = node('achievementAlbum').all();
    expect(all.filter(e => e.tag === 'time')).toMatchObject([
      { dateTime: '2026-11-16', textContent: '2026-11-16' },
      { dateTime: '2026-11-22', textContent: '2026-11-22 UTC' },
    ]);
    expect(all.map(e => e.textContent)).toEqual(expect.arrayContaining(['42 messages', '1 / 2', '1 of 1 unlocked']));
    expect(all.find(e => e.tag === 'progress')).toMatchObject({ value: 1, max: 2 });
    ui.renderAchievements({ ...data, personal: { ...data.personal, state: 'paused', badges: [] } });
    all = node('achievementAlbum').all();
    expect(all.map(e => e.textContent)).toContain('Your album is paused. Your unlocked badges are saved.');
  });

  it('preserves Telegram management for existing albums when the group disables achievements', () => {
    const { ui, node } = view();
    const group = { ...data.group, enabled: false };
    const paused = { ...data.personal, state: 'paused' };
    ui.renderAchievements({ group, personal: paused });
    const album = node('achievementAlbum');
    expect(album.all()).toContainEqual(expect.objectContaining({ href: paused.albumUrl }));

    ui.renderAchievements({ group, personal: { ...paused, albumUrl: null } });
    expect(album.all().filter(e => e.tag === 'a')).toEqual([]);
    expect(album.all().some(e => e.textContent.includes('To manage your album, open /badges'))).toBe(true);

    ui.renderAchievements({ group, personal: data.personal });
    expect(album.all().filter(e => e.tag === 'a')).toEqual([]);
    expect(album.all().map(e => e.textContent)).toContain('You can start a personal album once an administrator enables achievements in this group.');
    expect(album.all().every(e => !e.textContent.includes('/badges'))).toBe(true);
  });

  it('renders both forward counters and their separate remaining conditions', () => {
    const { ui, node, html } = view();
    const progress: AchievementProgress = { status: 'provisional', pendingAward: false, conditions: [
      { unit: 'channel', current: 3, target: 3, remaining: 0 },
      { unit: 'day', current: 2, target: 3, remaining: 1 },
    ] };
    const badge = { ...badges.find(b => b.id === 'newsstand')!, progress: { ...progress, display: progressCopy(progress, 'en') } };
    ui.renderAchievements({
      group: { ...data.group, weekStart: '2026-11-23' },
      personal: { ...data.personal, state: 'available', badges: [badge] },
    });
    const all = node('achievementAlbum').all();
    expect(all.map(el => el.textContent)).toEqual(expect.arrayContaining([
      'Channels · 3 / 3', 'Complete', 'Dates · 2 / 3', 'Left — 1 day', 'Provisional · UTC', 'Week of 2026-11-23 (UTC)',
    ]));
    expect(all.filter(el => el.tag === 'progress')).toMatchObject([{ value: 3, max: 3 }, { value: 2, max: 3 }]);
    expect(html).toContain('window.setInterval(refreshVisibleAchievements, 60_000)');
  });

  it('refreshes a visible collection in place and clears it if access is revoked', async () => {
    const { ui, node, state, fetch, document } = view();
    const collection = node('achievementAlbum');
    fetch.mockResolvedValueOnce(Response.json(data));
    await ui.loadAchievements();
    const cards = collection.children;
    document.hidden = true;
    await ui.loadAchievements(true);
    document.hidden = false;
    state.view = 'overview';
    await ui.loadAchievements(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    state.view = 'achievements';

    let finish!: (res: Response) => void;
    fetch.mockReturnValueOnce(new Promise<Response>(resolve => { finish = resolve; }));
    const background = ui.loadAchievements(true);
    await ui.loadAchievements(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(collection.children).toBe(cards);
    finish(new Response(null, { status: 503 }));
    await background;
    expect(collection.children).toBe(cards);
    expect(node('achievementStatus').textContent).toContain('Showing the last loaded data');

    fetch.mockReturnValueOnce(new Promise<Response>(resolve => { finish = resolve; }));
    const retry = ui.loadAchievements(true);
    expect(collection.children).toBe(cards);
    finish(new Response(null, { status: 403 }));
    await retry;
    expect(collection.children).toEqual([]);
  });

  it('clears the previous chat immediately and discards its late response, including a stale 401', async () => {
    const { ui, node, state, fetch, redirectToLogin } = view();
    let finish!: (r: Response) => void;
    fetch.mockReturnValueOnce(new Promise<Response>(resolve => { finish = resolve; }));
    const first = ui.loadAchievements();
    ui.renderAchievements(data);
    state.chatId = '-456';
    fetch.mockResolvedValueOnce(new Response(null, { status: 403 }));
    const next = ui.loadAchievements();
    expect(node('achievementAlbum').children).toEqual([]);
    await next;
    finish(new Response(null, { status: 401 }));
    await first;
    expect(redirectToLogin).not.toHaveBeenCalled();
    expect(node('achievementAlbum').children).toEqual([]);
    expect(node('achievementStatus').textContent).toContain('no longer have access');
    expect(fetch.mock.calls.map(args => args[0])).toEqual([
      '/admin/api/achievements?chatId=-123', '/admin/api/achievements?chatId=-456',
    ]);
  });

  it('localizes every current badge rule and its stored measurements', () => {
    const personal = personalRules([], [], { days: 3, channels: 3 }, '2026-11-01', '2026-11-22');
    const group = weeklyRules('2026-11-16', [], [], 0, 0, null).badges;
    const conversation = ['Реплик в цепочке · 4', 'Ответивших участников · 3', 'Взаимных диалогов · 3', 'Ответов в продолжении · 2 из 2'];
    const results = [...group, ...personal, { id: 'comeback', result: '30 дн. тишины' },
      ...CONVERSATION_BADGES.map((b, i) => ({ id: b.id, result: conversation[i] }))];
    for (const b of catalog) {
      const result = results.find(r => r.id === b.id)!.result;
      const english = localizeAchievementBadge('en', { ...b, result });
      expect(english.title + english.description + english.result).not.toMatch(/[А-Яа-яёЁ]/);
      expect(english.result.match(/\d+/g)).toEqual(result.match(/\d+/g));
      expect(localizeAchievementBadge('ru', { ...b, result })).toEqual({ ...b, result });
    }
    expect(localizeAchievementBadge('en', { ...badges[3], result: 'Минут: 61, записей: 12' }).result)
      .toBe('Minutes: 61, recordings: 12');
  });
});
