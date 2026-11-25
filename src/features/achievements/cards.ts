import type { Env } from '../../core/env';
import { CardCanvas, color } from './cards-raster';
import { GROUP_BADGES, type WeeklyReport } from './rules';
import { badgeArt } from './badge-art-generated';

export type Delivery =
  | { status: 'sent'; messageId: number }
  | { status: 'retry'; retryAfter: number }
  | { status: 'rejected' | 'unknown' };

export interface InlineButton { text: string; callback_data?: string; url?: string }

function drawLines(canvas: CardCanvas, text: string, x: number, y: number, scale: number, width: number) {
  const maxChars = Math.floor(width / (scale * 6));
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && line.length + word.length + 1 > maxChars) {
      canvas.text(line, x, y, scale);
      y += scale * 9;
      line = '';
    }
    line += (line ? ' ' : '') + word;
  }
  canvas.text(line, x, y, scale);
  return y + scale * 9;
}

function header(label: string): CardCanvas {
  const canvas = new CardCanvas();
  canvas.rect(0, 0, 704, 8, color.teal);
  canvas.text(label, 28, 27, 3, color.teal);
  canvas.rect(28, 61, 648, 2, color.ink);
  return canvas;
}

async function medal(canvas: CardCanvas, id: string, title: string, result: string, locked = false) {
  const art = await badgeArt(id);
  if (!art) throw new Error('Badge artwork unavailable');
  canvas.image(art, 28, 87, 168, locked);
  const end = drawLines(canvas, title, 223, 92, 5, 452);
  drawLines(canvas, result, 224, end + 10, 2, 452);
}

function footer(canvas: CardCanvas, top: string, bottom: string) {
  canvas.rect(0, 284, 704, 116, color.ink);
  canvas.text(top, 28, 308, top.length > 36 ? 2 : 3, color.white);
  canvas.text(bottom, 28, 358, 2, color.gold);
}

/** Render a badge without group names, owner identifiers or links. */
export async function personalCard(id: string, title: string, day: string, result: string) {
  return collectionCard(id, title, '', false, { result, earned_day: day });
}

/** A member can inspect a locked badge's outline and unlock condition before earning it. */
export async function collectionCard(
  id: string, title: string, rule: string, group: boolean,
  award?: { result: string; earned_day: string }, counter?: string,
) {
  const canvas = header(group ? 'КОЛЛЕКЦИЯ ЧАТА' : 'ЛИЧНАЯ КОЛЛЕКЦИЯ');
  await medal(canvas, id, title, award?.result ?? rule, !award);
  if (award) footer(canvas, 'ДОСТИЖЕНИЕ ОТКРЫТО', award.earned_day + ' UTC');
  else footer(canvas, 'ПОКА ЗАКРЫТО', counter
    ? 'ПРОГРЕСС: ' + counter
    : group ? 'ЗА ПОЛНУЮ НЕДЕЛЮ ПО UTC' : '');
  return canvas.png();
}

function peakGraph(canvas: CardCanvas, report: WeeklyReport) {
  const { day, hour, count } = report.peak;
  canvas.text('САМЫЙ БУРНЫЙ ЧАС', 28, 84, 4);
  canvas.text(day + ' / ' + String(hour).padStart(2, '0') + ':00 UTC', 30, 133, 2, color.teal);
  canvas.text(String(count), 28, 180, 6);
  canvas.text('СООБЩЕНИЙ ЗА ЧАС', 30, 242, 2, color.teal);
  const max = Math.max(1, ...report.hours);
  for (let i = 0; i < 24; i++) {
    const bar = Math.max(2, Math.round(125 * (report.hours[i] || 0) / max));
    canvas.rect(337 + i * 14, 240 - bar, 10, bar, i === hour ? color.peach : color.teal);
  }
  canvas.text('00', 337, 250, 2);
  canvas.text('23', 648, 250, 2);
}

/** Build the group photo and accessible caption from the same verified snapshot. */
export async function weeklyCard(report: WeeklyReport) {
  const canvas = header('НЕДЕЛЯ ЧАТА');
  const featured = report.badges[0];
  const title = GROUP_BADGES.find(badge => badge.id === featured?.id)?.title;
  let fact: string;
  if (featured && title) {
    await medal(canvas, featured.id, title, featured.result);
    fact = 'Открыт бейдж «' + title + '». ' + featured.result;
  } else {
    peakGraph(canvas, report);
    fact = 'Пик переписки — ' + report.peak.day + ' в ' + String(report.peak.hour).padStart(2, '0')
      + ':00 UTC. Сообщений за час: ' + report.peak.count + '.';
  }
  const totals = 'Сообщений: ' + report.messages + ' · Участников: ' + report.authors;
  const dates = report.start + ' — ' + report.end + ' UTC';
  footer(canvas, totals, dates);
  return { png: await canvas.png(), caption: [dates, fact, totals].join('\n') };
}

export async function sendCard(
  env: Env, chatId: number, png: Uint8Array<ArrayBuffer>, caption: string, buttons?: InlineButton[][], threadId?: number,
): Promise<Delivery> {
  const form = new FormData();
  form.set('chat_id', String(chatId));
  if (threadId !== undefined) form.set('message_thread_id', String(threadId));
  form.set('photo', new Blob([png], { type: 'image/png' }), 'achievement.png');
  form.set('caption', caption);
  if (buttons?.length) form.set('reply_markup', JSON.stringify({ inline_keyboard: buttons }));
  try {
    const response = await fetch(`https://api.telegram.org/bot${env.TOKEN}/sendPhoto`, { method: 'POST', body: form });
    const data = await response.json() as {
      ok?: boolean; error_code?: number; result?: { message_id?: number }; parameters?: { retry_after?: number };
    };
    const id = data?.result?.message_id;
    if (response.ok && data?.ok === true && typeof id === 'number' && Number.isSafeInteger(id) && id > 0) {
      return { status: 'sent', messageId: id };
    }
    if (data?.ok === false && data.error_code === 429) {
      return { status: 'retry', retryAfter: Math.max(1, Number(data.parameters?.retry_after) || 60) };
    }
    if (data?.ok === false && data.error_code && data.error_code >= 400 && data.error_code < 500) {
      return { status: 'rejected' };
    }
    return { status: 'unknown' };
  } catch {
    // After dispatch, a lost reply can mean that Telegram already delivered the card.
    return { status: 'unknown' };
  }
}

/** Send one weekly photo with a collection button bound to its originating group. */
export async function sendWeeklyPhoto(
  env: Env, chatId: number, report: WeeklyReport, unlockedCount: number, stillReserved: () => Promise<boolean>,
): Promise<Delivery | { status: 'cancelled' }> {
  let card: Awaited<ReturnType<typeof weeklyCard>>;
  try {
    card = await weeklyCard(report);
    // Consent can change while preparing the PNG. Recheck immediately before dispatch.
    if (!await stillReserved()) return { status: 'cancelled' };
  } catch {
    // No Telegram request has started, so preparation can be retried.
    console.warn('Weekly achievement photo preparation failed');
    return { status: 'retry', retryAfter: 300 };
  }
  const { png, caption } = card;
  return sendCard(env, chatId, png, caption, [[{
    text: 'Коллекция чата · ' + unlockedCount + ' из ' + GROUP_BADGES.length,
    callback_data: 'ach:group:' + chatId,
  }]]);
}
