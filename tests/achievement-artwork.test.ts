import { expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import worker from '../src/index';
import type { Env } from '../src/core/env';
import { GROUP_BADGES, PERSONAL_BADGES } from '../src/features/achievements/rules';
import { CONVERSATION_BADGES } from '../src/features/achievements/social-score';
import { badgeArt } from '../src/features/achievements/badge-art-generated';
import { CardCanvas } from '../src/features/achievements/cards-raster';
import artwork from '../src/features/achievements/artwork.json';

it('serves the portable dashboard poster without chat data or a landing binding', async () => {
  const fetchPoster = (id: string, method = 'GET') => worker.fetch(
    new Request('https://bot.example/admin/badge-art/' + id + '.png', { method }),
    {} as Env, {} as ExecutionContext,
  );
  const response = await fetchPoster('spark');
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toBe('image/png');
  expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
  const png = Buffer.from(await response.arrayBuffer());
  const chunks = new Map<string, Buffer>();
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    chunks.set(png.toString('ascii', offset + 4, offset + 8), png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const art = (await badgeArt('spark'))!;
  expect(chunks.get('IHDR')!.readUInt32BE(0)).toBe(art.width);
  expect(chunks.get('IHDR')!.readUInt32BE(4)).toBe(art.height);
  expect(chunks.get('PLTE')).toEqual(Buffer.from(art.palette));
  expect(chunks.get('tRNS')).toEqual(Buffer.from([0]));
  const raw = inflateSync(chunks.get('IDAT')!);
  for (let y = 0; y < art.height; y++) {
    const row = y * (art.width + 1);
    expect(raw[row]).toBe(0);
    expect(raw.subarray(row + 1, row + 1 + art.width))
      .toEqual(Buffer.from(art.pixels.subarray(y * art.width, (y + 1) * art.width)));
  }
  const head = await fetchPoster('spark', 'HEAD');
  expect(head.status).toBe(200);
  expect(await head.text()).toBe('');
  expect((await fetchPoster('missing')).status).toBe(404);
  expect((await fetchPoster('spark', 'POST')).status).toBe(405);
});

it('rejects an image box that would overwrite a neighboring PNG scanline', () => {
  const canvas = new CardCanvas();
  const image = { width: 1, height: 1, pixels: Uint8Array.of(1), palette: new Uint8Array(6) };
  expect(() => canvas.image(image, 702, 398, 2)).not.toThrow();
  expect(() => canvas.image(image, 703, 398, 2)).toThrow(RangeError);
  expect(() => canvas.image(image, 702, 399, 2)).toThrow(RangeError);
  expect(() => canvas.image(image, -1, 0, 2)).toThrow(RangeError);
});

it('ships a distinct decodable poster for every available achievement', async () => {
  const ids = [...GROUP_BADGES, ...PERSONAL_BADGES, ...CONVERSATION_BADGES].map(b => b.id);
  expect(Object.keys(artwork).sort()).toEqual(ids.sort());
  const content = new Set<string>();
  for (const id of ids) {
    const image = await badgeArt(id);
    expect(image, id).toBeTruthy();
    expect([image!.width, image!.height], id).toEqual([168, 168]);
    expect(image!.pixels.length, id).toBe(168 * 168);
    expect(image!.palette.length % 3, id).toBe(0);
    expect(image!.palette.length / 3, id).toBeLessThanOrEqual(249);
    const used = new Set(image!.pixels);
    expect(used.size, id).toBeGreaterThan(8);
    expect(Math.max(...used), id).toBeLessThan(image!.palette.length / 3);
    content.add(Buffer.from(await crypto.subtle.digest('SHA-256', image!.pixels)).toString('hex'));
  }
  expect(content.size).toBe(20);
  expect(await badgeArt('__proto__')).toBeNull();
});
