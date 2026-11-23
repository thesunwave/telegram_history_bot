import { expect, it } from 'vitest';
import { GROUP_BADGES, PERSONAL_BADGES } from '../src/features/achievements/rules';
import { CONVERSATION_BADGES } from '../src/features/achievements/social-score';
import { badgeArt } from '../src/features/achievements/badge-art-generated';
import artwork from '../src/features/achievements/artwork.json';

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
