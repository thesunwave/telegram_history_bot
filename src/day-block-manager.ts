import type { DurableObjectState, DurableObjectStorage } from '@cloudflare/workers-types';
import { DayBlock, StoredMessage, DAY, LOG_ID_RADIX } from './env';
import { Logger } from './logger';
import { hashText } from './utils';

/**
 * Durable Object for managing day blocks with race condition protection
 * Ensures atomic operations and prevents message loss during concurrent writes
 */
export class DayBlockManager {
  private env: any;
  private storage: DurableObjectStorage;
  private state: DurableObjectState;

  // Sharding constants
  private static readonly MAX_VALUE_SIZE_BYTES = 131072; // Hard limit
  private static readonly TARGET_MAX_BYTES = 110000; // Safety margin for JSON payload per shard

  constructor(state: DurableObjectState, env: any) {
    this.env = env;
    this.storage = state.storage;
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const method = request.method;

      if (method === 'POST' && url.pathname === '/add-message') {
        // Serialize concurrent writes within this DO instance to avoid version conflicts
        return await this.state.blockConcurrencyWhile(() => this.handleAddMessage(request));
      }

      if (method === 'GET' && url.pathname === '/get-block') {
        return await this.handleGetBlock(request);
      }

      if (method === 'POST' && url.pathname === '/health') {
        return new Response(JSON.stringify({ status: 'healthy' }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response('Not Found', { status: 404 });
    } catch (error: any) {
      Logger.error('DayBlockManager: request failed', {
        error: error.message || String(error),
        stack: error.stack,
        url: request.url,
        method: request.method
      });
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  private async handleAddMessage(request: Request): Promise<Response> {
    const body = await request.json() as { message: StoredMessage };
    const { message } = body;

    Logger.debug(this.env, 'DayBlockManager: adding message', {
      chat: message.chat.toString(LOG_ID_RADIX),
      messageTs: message.ts
    });

    try {
      const date = new Date(message.ts * 1000).toISOString().slice(0, 10);
      const blockId = `${message.chat}:${date}`;

      // Load meta (or migrate from legacy single-block format)
      let meta = await this.loadMeta(blockId);
      if (!meta) {
        // Try migrate from legacy single-block key
        const legacyKey = this.legacyBlockKey(blockId);
        const legacy = await this.storage.get<DayBlock>(legacyKey);
        if (legacy) {
          meta = await this.migrateLegacyBlockToShards(blockId, legacy);
        } else {
          meta = this.createEmptyMeta(blockId, message.chat, date);
          await this.saveMeta(blockId, meta);
        }
      }

      // Duplicate detection: check newest shard first, then older ones if needed
      const latestShardIndex = Math.max(0, meta.shardCount - 1);
      let isDuplicate = await this.messageExistsInShardRange(blockId, message, latestShardIndex, latestShardIndex);
      if (!isDuplicate && meta.shardCount > 1) {
        // Fallback scan all shards if not found in latest
        isDuplicate = await this.messageExistsInShardRange(blockId, message, 0, meta.shardCount - 2);
      }

      if (isDuplicate) {
        Logger.debug(this.env, 'DayBlockManager: duplicate message skipped', {
          chat: message.chat.toString(LOG_ID_RADIX),
          date,
          messageTs: message.ts
        });
        return new Response(JSON.stringify({
          success: true,
          duplicate: true,
          messageCount: meta.messageCount
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      // Load latest shard (create if not exists)
      const shardIndex = latestShardIndex;
      let shard = await this.loadShard(blockId, shardIndex);
      if (!shard) {
        shard = { messages: [] };
      }

      // Try to append to current shard
      shard.messages.push(message);
      shard.messages.sort((a, b) => a.ts - b.ts);

      // If shard too large, move message to a new shard
      if (this.calcSizeBytes(shard) > DayBlockManager.TARGET_MAX_BYTES) {
        // Remove the recently added message from current shard
        shard.messages.pop();
        // Persist the current shard if it was changed
        await this.saveShard(blockId, shardIndex, shard);

        // Create a new shard and put the message there
        const newIndex = meta.shardCount; // next shard index
        const newShard = { messages: [message] };
        await this.saveShard(blockId, newIndex, newShard);

        // Update meta for new shard
        meta.shardCount += 1;
      } else {
        // Save updated shard
        await this.saveShard(blockId, shardIndex, shard);
      }

      // Update meta
      meta.messageCount += 1;
      meta.lastUpdated = Date.now();
      meta.version += 1;
      meta.checksum = this.updateRollingChecksum(meta.checksum, message);
      await this.saveMeta(blockId, meta);

      // Backup to KV (meta + affected shards only)
      await this.backupToKV(blockId, meta, shardIndex, meta.shardCount - 1);

      Logger.debug(this.env, 'DayBlockManager: message added successfully', {
        chat: message.chat.toString(LOG_ID_RADIX),
        date,
        messageCount: meta.messageCount,
        version: meta.version,
        shardCount: meta.shardCount
      });

      return new Response(JSON.stringify({
        success: true,
        messageCount: meta.messageCount,
        version: meta.version
      }), { headers: { 'Content-Type': 'application/json' } });

    } catch (error: any) {
      Logger.error('DayBlockManager: add message failed', {
        chat: message.chat.toString(LOG_ID_RADIX),
        error: error.message || String(error),
        stack: error.stack
      });
      throw error;
    }
  }

  private async handleGetBlock(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const chatId = parseInt(url.searchParams.get('chatId') || '0');
    const date = url.searchParams.get('date') || '';

    if (!chatId || !date) {
      return new Response(JSON.stringify({ error: 'Missing chatId or date' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    try {
      const blockId = `${chatId}:${date}`;

      // Load meta or migrate legacy on-the-fly
      let meta = await this.loadMeta(blockId);
      if (!meta) {
        const legacyKey = this.legacyBlockKey(blockId);
        const legacy = await this.storage.get<DayBlock>(legacyKey);
        if (legacy) {
          meta = await this.migrateLegacyBlockToShards(blockId, legacy);
        }
      }

      if (!meta) {
        return new Response(JSON.stringify({ block: null }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Load all shards
      const shards = await this.loadAllShards(blockId, meta.shardCount);
      const messages = shards.flatMap(s => s.messages);
      messages.sort((a, b) => a.ts - b.ts);

      const block: DayBlock = {
        date,
        chatId,
        messages,
        messageCount: meta.messageCount,
        lastUpdated: meta.lastUpdated,
        version: meta.version,
        checksum: meta.checksum
      };

      return new Response(JSON.stringify({ block }), {
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (error: any) {
      Logger.error('DayBlockManager: get block failed', {
        chat: chatId.toString(LOG_ID_RADIX),
        date,
        error: error.message || String(error)
      });
      throw error;
    }
  }

  // ===== Sharding helpers =====

  private legacyBlockKey(blockId: string): string {
    return `block:${blockId}`;
  }
  private metaKey(blockId: string): string {
    return `block_meta:${blockId}`;
  }
  private shardKey(blockId: string, shardIndex: number): string {
    return `block_shard:${blockId}:${shardIndex}`;
  }

  private kvMetaKey(blockId: string): string {
    const [chatId, date] = blockId.split(':');
    return `msg_day_meta:${chatId}:${date}`;
  }
  private kvShardKey(blockId: string, shardIndex: number): string {
    const [chatId, date] = blockId.split(':');
    return `msg_day_shard:${chatId}:${date}:${shardIndex}`;
  }

  private createEmptyMeta(blockId: string, chatId: number, date: string): DayBlockMeta {
    return {
      id: blockId,
      date,
      chatId,
      messageCount: 0,
      lastUpdated: Date.now(),
      version: 1,
      shardCount: 1,
      checksum: ''
    };
  }

  private async loadMeta(blockId: string): Promise<DayBlockMeta | null> {
    const meta = await this.storage.get<DayBlockMeta>(this.metaKey(blockId));
    return meta || null;
  }
  private async saveMeta(blockId: string, meta: DayBlockMeta): Promise<void> {
    await this.storage.put(this.metaKey(blockId), meta);
  }

  private async loadShard(blockId: string, index: number): Promise<DayBlockShard | null> {
    const shard = await this.storage.get<DayBlockShard>(this.shardKey(blockId, index));
    return shard || null;
  }
  private async saveShard(blockId: string, index: number, shard: DayBlockShard): Promise<void> {
    await this.storage.put(this.shardKey(blockId, index), shard);
  }

  private async loadAllShards(blockId: string, shardCount: number): Promise<DayBlockShard[]> {
    const promises: Promise<DayBlockShard | null>[] = [];
    for (let i = 0; i < shardCount; i++) {
      promises.push(this.loadShard(blockId, i));
    }
    const shards = await Promise.all(promises);
    return shards.filter((s): s is DayBlockShard => !!s);
  }

  private async migrateLegacyBlockToShards(blockId: string, legacy: DayBlock): Promise<DayBlockMeta> {
    // Break legacy block.messages into shards under TARGET_MAX_BYTES
    const messages = [...legacy.messages].sort((a, b) => a.ts - b.ts);
    let currentShard: DayBlockShard = { messages: [] };
    let shardIndex = 0;
    let shardCount = 0;

    const saveCurrentShard = async () => {
      await this.saveShard(blockId, shardIndex, currentShard);
      shardIndex += 1;
      shardCount += 1;
      currentShard = { messages: [] };
    };

    for (const msg of messages) {
      currentShard.messages.push(msg);
      if (this.calcSizeBytes(currentShard) > DayBlockManager.TARGET_MAX_BYTES) {
        // Remove last and flush shard
        currentShard.messages.pop();
        await saveCurrentShard();
        // Start new shard with this message
        currentShard.messages.push(msg);
      }
    }
    if (currentShard.messages.length) {
      await saveCurrentShard();
    }

    const meta: DayBlockMeta = {
      id: blockId,
      date: legacy.date,
      chatId: legacy.chatId,
      messageCount: legacy.messageCount,
      lastUpdated: legacy.lastUpdated,
      version: legacy.version,
      shardCount: shardCount || 1,
      checksum: legacy.checksum || ''
    };

    await this.saveMeta(blockId, meta);

    // Backup to KV fully after migration
    await this.backupAllShardsToKV(blockId, meta);

    // Remove legacy key to avoid confusion (best-effort)
    try { await this.storage.delete(this.legacyBlockKey(blockId)); } catch {}

    return meta;
  }

  private async messageExistsInShardRange(blockId: string, message: StoredMessage, startIndex: number, endIndex: number): Promise<boolean> {
    for (let i = startIndex; i <= endIndex; i++) {
      const shard = await this.loadShard(blockId, i);
      if (!shard) continue;
      const dup = shard.messages.some(m => m.ts === message.ts && m.user === message.user && m.text === message.text);
      if (dup) return true;
    }
    return false;
  }

  private calcSizeBytes(obj: any): number {
    try {
      return new TextEncoder().encode(JSON.stringify(obj)).length;
    } catch {
      return JSON.stringify(obj).length;
    }
  }

  private updateRollingChecksum(prev: string, message: StoredMessage): string {
    const payload = `${prev || ''}|${message.ts}:${message.user}:${message.text}`;
    return hashText(payload);
  }

  private async backupToKV(blockId: string, meta: DayBlockMeta, affectedStartShard: number, affectedEndShard: number): Promise<void> {
    try {
      // Save meta
      await this.env.HISTORY.put(this.kvMetaKey(blockId), JSON.stringify(meta), { expirationTtl: 7 * DAY });
      // Save shards
      const promises: Promise<any>[] = [];
      for (let i = affectedStartShard; i <= affectedEndShard; i++) {
        const shard = await this.loadShard(blockId, i);
        if (!shard) continue;
        promises.push(this.env.HISTORY.put(this.kvShardKey(blockId, i), JSON.stringify(shard), { expirationTtl: 7 * DAY }));
      }
      await Promise.all(promises);
    } catch (kvError: any) {
      Logger.error('DayBlockManager: KV backup failed', {
        blockId,
        error: kvError.message
      });
      // Do not fail operation on KV errors
    }
  }

  private async backupAllShardsToKV(blockId: string, meta: DayBlockMeta): Promise<void> {
    await this.backupToKV(blockId, meta, 0, Math.max(0, meta.shardCount - 1));
  }
}

// Local sharding types
interface DayBlockMeta {
  id: string;
  date: string;
  chatId: number;
  messageCount: number;
  lastUpdated: number;
  version: number;
  shardCount: number;
  checksum: string;
}

interface DayBlockShard {
  messages: StoredMessage[];
}

/**
 * Race-condition safe wrapper for adding messages to day blocks
 */
export async function addMessageToDayBlockSafe(
  env: any,
  message: StoredMessage
): Promise<{ success: boolean; messageCount: number; duplicate?: boolean }> {
  const date = new Date(message.ts * 1000).toISOString().slice(0, 10);
  const doId = env.DAY_BLOCK_MANAGER_DO.idFromName(`dayblock:${message.chat}:${date}`);
  const doStub = env.DAY_BLOCK_MANAGER_DO.get(doId);

  Logger.debug(env, 'addMessageToDayBlockSafe: routing to DO', {
    chat: message.chat.toString(LOG_ID_RADIX),
    date,
    doId: `dayblock:${message.chat}:${date}`
  });

  try {
    const response = await doStub.fetch('https://do/add-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DO request failed: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    return result;

  } catch (error: any) {
    Logger.error('addMessageToDayBlockSafe: failed', {
      chat: message.chat.toString(LOG_ID_RADIX),
      date,
      error: error.message || String(error),
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Get day block through Durable Object
 */
export async function getDayBlockSafe(
  env: any,
  chatId: number,
  date: string
): Promise<DayBlock | null> {
  const doId = env.DAY_BLOCK_MANAGER_DO.idFromName(`dayblock:${chatId}:${date}`);
  const doStub = env.DAY_BLOCK_MANAGER_DO.get(doId);

  try {
    const response = await doStub.fetch(`https://do/get-block?chatId=${chatId}&date=${date}`, {
      method: 'GET'
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DO request failed: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    return result.block;

  } catch (error: any) {
    Logger.error('getDayBlockSafe: failed', {
      chat: chatId.toString(LOG_ID_RADIX),
      date,
      error: error.message || String(error)
    });
    throw error;
  }
}