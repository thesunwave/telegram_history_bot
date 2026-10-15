import Database from 'better-sqlite3';

interface KVEntry {
  value: Uint8Array;
  metadata?: unknown;
  expiration?: number;
}

/**
 * Minimal in-memory KV fixture and SQLite adapter for Node-based tests.
 * This does not replace runtime-level testing with Wrangler/Miniflare.
 */
export class MemoryStorage {
  entries: Map<string, KVEntry>;

  constructor(entries?: Map<string, KVEntry>, readonly clock: () => number = Date.now) {
    this.entries = entries ?? new Map();
  }

  async getSqliteDatabase(): Promise<Database.Database> {
    return new Database(':memory:');
  }
}

export class KVNamespace {
  constructor(
    public storage: MemoryStorage,
    private readonly options: { clock?: () => number } = {},
  ) {}

  private now(): number {
    return (this.options.clock ?? this.storage.clock)();
  }

  private liveEntry(key: string): KVEntry | undefined {
    const entry = this.storage.entries.get(key);
    if (entry && entry.expiration !== undefined && entry.expiration <= this.now() / 1000) {
      this.storage.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  async get(key: string, options?: string | { type?: string }): Promise<any> {
    const entry = this.liveEntry(key);
    if (!entry) return null;
    const type = typeof options === 'string' ? options : options?.type;
    if (type === 'arrayBuffer') return Uint8Array.from(entry.value).buffer;
    if (type === 'stream') return new Blob([Uint8Array.from(entry.value).buffer]).stream();
    const text = new TextDecoder().decode(entry.value);
    if (type === 'json') return JSON.parse(text);
    return text;
  }

  async getWithMetadata(key: string, options?: string | { type?: string }): Promise<any> {
    const entry = this.liveEntry(key);
    return { value: entry ? await this.get(key, options) : null, metadata: entry?.metadata ?? null };
  }

  async put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
    options: { expiration?: number; expirationTtl?: number; metadata?: unknown } = {},
  ): Promise<void> {
    let bytes: Uint8Array;
    if (typeof value === 'string') {
      bytes = new TextEncoder().encode(value);
    } else if (value instanceof ArrayBuffer) {
      bytes = Uint8Array.from(new Uint8Array(value));
    } else if (ArrayBuffer.isView(value)) {
      bytes = Uint8Array.from(
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      );
    } else {
      bytes = new Uint8Array(await new Response(value).arrayBuffer());
    }
    const expiration = options.expirationTtl !== undefined
      ? this.now() / 1000 + options.expirationTtl
      : options.expiration;
    this.storage.entries.set(key, { value: bytes, expiration, metadata: options.metadata });
  }

  async delete(key: string): Promise<void> {
    this.storage.entries.delete(key);
  }

  async list(options: { prefix?: string; limit?: number; cursor?: string } = {}): Promise<any> {
    const { prefix = '', limit = 1000, cursor } = options;
    const lastKey = cursor ? Buffer.from(cursor, 'base64url').toString('utf8') : undefined;
    const keys = [...this.storage.entries.keys()]
      .filter((key) => key.startsWith(prefix) && (lastKey === undefined || key > lastKey) && this.liveEntry(key))
      .sort();
    const page = keys.slice(0, limit);
    const complete = page.length === keys.length;
    return {
      keys: page.map((name) => {
        const entry = this.storage.entries.get(name)!;
        return { name, expiration: entry.expiration, metadata: entry.metadata };
      }),
      list_complete: complete,
      // Anchor pagination to the last key, not an offset that shifts on deletion.
      cursor: complete ? '' : Buffer.from(page[page.length - 1], 'utf8').toString('base64url'),
    };
  }
}
