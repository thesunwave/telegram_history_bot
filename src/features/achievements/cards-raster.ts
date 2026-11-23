// Small original 5 × 7 bitmap alphabet for the pixel-art cards. Each number is a row,
// high bit on the left. Cyrillic text renders identically in workerd and local previews.
const rows: Record<string, number[]> = {
  А: [14,17,17,31,17,17,17], Б: [31,16,16,30,17,17,30],
  В: [30,17,17,30,17,17,30], Г: [31,16,16,16,16,16,16],
  Д: [6,10,10,10,10,31,17], Е: [31,16,16,30,16,16,31],
  Ё: [10,0,31,16,30,16,31], Ж: [21,21,14,4,14,21,21],
  З: [14,17,1,6,1,17,14], И: [17,17,19,21,25,17,17],
  Й: [10,4,17,19,21,25,17], К: [17,18,20,24,20,18,17],
  Л: [7,9,9,9,9,17,17], М: [17,27,21,21,17,17,17],
  Н: [17,17,17,31,17,17,17], О: [14,17,17,17,17,17,14],
  П: [31,17,17,17,17,17,17], Р: [30,17,17,30,16,16,16],
  С: [14,17,16,16,16,17,14], Т: [31,4,4,4,4,4,4],
  У: [17,17,17,15,1,17,14], Ф: [4,14,21,21,14,4,4],
  Х: [17,17,10,4,10,17,17], Ц: [18,18,18,18,18,31,1],
  Ч: [17,17,17,15,1,1,1], Ш: [21,21,21,21,21,21,31],
  Щ: [21,21,21,21,21,31,1], Ъ: [24,8,8,14,9,9,14],
  Ы: [17,17,17,29,21,21,29], Ь: [16,16,16,30,17,17,30],
  Э: [14,17,1,7,1,17,14], Ю: [18,21,21,29,21,21,18],
  Я: [15,17,17,15,5,9,17],
  0: [14,17,19,21,25,17,14], 1: [4,12,4,4,4,4,14],
  2: [14,17,1,2,4,8,31], 3: [30,1,1,14,1,1,30],
  4: [2,6,10,18,31,2,2], 5: [31,16,16,30,1,1,30],
  6: [6,8,16,30,17,17,14], 7: [31,1,2,4,8,8,8],
  8: [14,17,17,14,17,17,14], 9: [14,17,17,15,1,2,12],
  '-': [0,0,0,31,0,0,0], '·': [0,0,0,4,0,0,0], ':': [0,4,4,0,4,4,0],
  '.': [0,0,0,0,0,6,6], ',': [0,0,0,0,0,4,8], '/': [1,1,2,4,8,16,16],
  '(': [2,4,8,8,8,4,2], ')': [8,4,2,2,2,4,8], '%': [17,2,4,8,16,1,17],
  U: [17,17,17,17,17,17,14], T: [31,4,4,4,4,4,4], C: [14,17,16,16,16,17,14],
};

// Indexed color PNG keeps the 704×400 canvas below 300 kB before compression.
const WIDTH = 704;
const HEIGHT = 400;
export const color = { paper: 0, ink: 1, teal: 2, gold: 3, peach: 4, faint: 5, white: 6 };
const palette = [249,246,232, 28,51,57, 32,118,115, 248,189,71, 247,136,103, 134,161,153, 255,254,247];

export class CardCanvas {
  private pixels = new Uint8Array((WIDTH + 1) * HEIGHT);
  private colors = new Uint8Array(palette);

  image(image: { width: number; height: number; pixels: Uint8Array; palette: Uint8Array },
    x: number, y: number, boxSize: number, locked = false) {
    const offset = palette.length / 3;
    if (image.palette.length > (256 - offset) * 3 || image.pixels.length !== image.width * image.height) {
      throw new Error('Invalid badge raster');
    }
    this.colors = new Uint8Array([...palette, ...image.palette]);
    const ratio = Math.min(boxSize / image.width, boxSize / image.height);
    const w = Math.round(image.width * ratio), h = Math.round(image.height * ratio);
    const left = x + Math.floor((boxSize - w) / 2), top = y + Math.floor((boxSize - h) / 2);
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const sx = Math.floor(col / ratio), sy = Math.floor(row / ratio);
        const source = sy * image.width + sx, pixel = image.pixels[source];
        if (!pixel) continue;
        let fill = offset + pixel;
        if (locked) {
          const rgb = pixel * 3;
          const luminance = 0.2126 * image.palette[rgb] + 0.7152 * image.palette[rgb + 1] + 0.0722 * image.palette[rgb + 2];
          fill = luminance < 90 ? color.teal : luminance < 205 ? color.faint : color.paper;
        }
        this.pixels[(top + row) * (WIDTH + 1) + left + col + 1] = fill;
      }
    }
  }

  rect(x: number, y: number, width: number, height: number, fill: number) {
    const left = Math.max(0, Math.floor(x));
    const right = Math.min(WIDTH, Math.ceil(x + width));
    if (right <= left) return;
    for (let row = Math.max(0, Math.floor(y)); row < Math.min(HEIGHT, y + height); row++) {
      const start = row * (WIDTH + 1) + 1;
      this.pixels.fill(fill, start + left, start + right);
    }
  }

  text(value: string, x: number, y: number, scale: number, fill = color.ink) {
    for (const char of value.toUpperCase().replace(/[—–]/g, '-')) {
      const glyph = rows[char];
      glyph?.forEach((bits, row) => {
        for (let col = 0; col < 5; col++) {
          if (bits & (16 >> col)) this.rect(x + col * scale, y + row * scale, scale, scale, fill);
        }
      });
      x += 6 * scale;
    }
  }

  async png(): Promise<Uint8Array<ArrayBuffer>> {
    const header = new Uint8Array(13);
    const size = new DataView(header.buffer);
    size.setUint32(0, WIDTH);
    size.setUint32(4, HEIGHT);
    header[8] = 8;
    header[9] = 3;
    const stream = new Blob([this.pixels]).stream().pipeThrough(new CompressionStream('deflate'));
    const deflated = new Uint8Array(await new Response(stream).arrayBuffer());
    const chunks = [new Uint8Array([137,80,78,71,13,10,26,10]), chunk('IHDR',header),
      chunk('PLTE',this.colors), chunk('IDAT',deflated), chunk('IEND',new Uint8Array())];
    const result = new Uint8Array(chunks.reduce((length, part) => length + part.length, 0));
    let offset = 0;
    for (const part of chunks) { result.set(part, offset); offset += part.length; }
    return result;
  }
}

function chunk(name: string, data: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(data.length + 12);
  const fields = new DataView(bytes.buffer);
  fields.setUint32(0, data.length);
  bytes.set(new TextEncoder().encode(name), 4);
  bytes.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  fields.setUint32(bytes.length - 4, (crc ^ 0xffffffff) >>> 0);
  return bytes;
}
