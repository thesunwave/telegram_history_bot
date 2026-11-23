import artwork from './artwork.json';

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
