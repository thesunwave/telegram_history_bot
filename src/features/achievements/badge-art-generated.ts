import artwork from './artwork.json';
import { indexedPng } from './cards-raster';

const SIDE = 168;
interface IndexedArt { colors: string; pixels: string }

function decode(encoded: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
}

/** Decode just the selected illustration. Index zero is transparent on every card. */
export async function badgeArt(id: string) {
  if (!Object.hasOwn(artwork, id)) return null;
  const entry = (artwork as Record<string, IndexedArt>)[id];
  const stream = new Response(decode(entry.pixels)).body!;
  const pixels = new Uint8Array(await new Response(stream.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  return { width: SIDE, height: SIDE, palette: decode(entry.colors), pixels };
}

/** Serve only the public illustrations bundled with the bot, including on self-hosted installs. */
export async function badgePoster(id: string, method: string): Promise<Response> {
  const headers = new Headers({ 'X-Robots-Tag': 'noindex, nofollow' });
  if (!Object.hasOwn(artwork, id)) return new Response(null, { status: 404, headers });
  if (method !== 'GET' && method !== 'HEAD') {
    headers.set('Allow', 'GET, HEAD');
    return new Response(null, { status: 405, headers });
  }
  headers.set('Content-Type', 'image/png');
  headers.set('Cache-Control', 'public, max-age=86400');
  if (method === 'HEAD') return new Response(null, { headers });

  const art = (await badgeArt(id))!;
  const stride = art.width + 1;
  const scanlines = new Uint8Array(stride * art.height);
  for (let row = 0; row < art.height; row++) {
    scanlines.set(art.pixels.subarray(row * art.width, (row + 1) * art.width), row * stride + 1);
  }
  const png = await indexedPng(art.width, art.height, art.palette, scanlines, true);
  return new Response(png, { headers });
}
