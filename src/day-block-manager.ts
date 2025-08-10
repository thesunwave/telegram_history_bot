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
    const body = await request.json() as { message: StoredMessage; retryCount?: number };
    const { message, retryCount = 0 } = body;
     const maxRetries = 3;

    Logger.debug(this.env, 'DayBlockManager: adding message', {
      chat: message.chat.toString(LOG_ID_RADIX),
      messageTs: message.ts,
      retryCount
    });

    try {
      const date = new Date(message.ts * 1000).toISOString().slice(0, 10);
      const blockKey = `block:${message.chat}:${date}`;

      // Get current block with atomic read
      const currentBlock = await this.storage.get<DayBlock>(blockKey);
      
      const block: DayBlock = currentBlock || {
        date,
        chatId: message.chat,
        messages: [],
        messageCount: 0,
        lastUpdated: Date.now(),
        version: 1,
        checksum: ''
      };

      // Check for duplicate messages
      const isDuplicate = block.messages.some(m => 
        m.ts === message.ts && 
        m.user === message.user && 
        m.text === message.text
      );

      if (isDuplicate) {
        Logger.debug(this.env, 'DayBlockManager: duplicate message skipped', {
          chat: message.chat.toString(LOG_ID_RADIX),
          date,
          messageTs: message.ts
        });
        return new Response(JSON.stringify({ 
          success: true, 
          duplicate: true,
          messageCount: block.messageCount 
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Add message and update metadata
      block.messages.push(message);
      block.messages.sort((a, b) => a.ts - b.ts); // Maintain chronological order
      block.messageCount = block.messages.length;
      block.lastUpdated = Date.now();
      block.version += 1;
      
      // Calculate checksum for integrity verification
      block.checksum = this.calculateBlockChecksum(block);

      // Atomic write with version check
      const success = await this.atomicWrite(blockKey, block, currentBlock?.version);

      if (!success && retryCount < maxRetries) {
        // Version conflict - retry with exponential backoff
        const delay = Math.pow(2, retryCount) * 100; // 100ms, 200ms, 400ms
        await new Promise(resolve => setTimeout(resolve, delay));
        
        Logger.debug(this.env, 'DayBlockManager: version conflict, retrying', {
          chat: message.chat.toString(LOG_ID_RADIX),
          date,
          retryCount: retryCount + 1,
          delay
        });

        // Recursive retry
        return await this.handleAddMessage(new Request(request.url, {
          method: 'POST',
          body: JSON.stringify({ message, retryCount: retryCount + 1 })
        }));
      }

      if (!success) {
        throw new Error(`Failed to add message after ${maxRetries} retries due to version conflicts`);
      }

      // Also save to KV for backup and compatibility
      const kvKey = `msg_day:${message.chat}:${date}`;
      try {
        await this.env.HISTORY.put(kvKey, JSON.stringify(block), {
          expirationTtl: 7 * DAY,
        });
      } catch (kvError: any) {
        Logger.error('DayBlockManager: KV backup failed', {
          chat: message.chat.toString(LOG_ID_RADIX),
          date,
          kvKey,
          error: kvError.message
        });
        // Don't fail the operation if KV backup fails
      }

      Logger.debug(this.env, 'DayBlockManager: message added successfully', {
        chat: message.chat.toString(LOG_ID_RADIX),
        date,
        messageCount: block.messageCount,
        version: block.version,
        blockSize: JSON.stringify(block).length
      });

      return new Response(JSON.stringify({ 
        success: true, 
        messageCount: block.messageCount,
        version: block.version
      }), {
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (error: any) {
      Logger.error('DayBlockManager: add message failed', {
        chat: message.chat.toString(LOG_ID_RADIX),
        error: error.message || String(error),
        stack: error.stack,
        retryCount
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
      const blockKey = `block:${chatId}:${date}`;
      const block = await this.storage.get<DayBlock>(blockKey);

      if (!block) {
        return new Response(JSON.stringify({ block: null }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Verify checksum
      const expectedChecksum = this.calculateBlockChecksum(block);
      if (block.checksum && block.checksum !== expectedChecksum) {
        Logger.error('DayBlockManager: checksum mismatch detected', {
          chat: chatId.toString(LOG_ID_RADIX),
          date,
          expectedChecksum,
          actualChecksum: block.checksum
        });
        // Return block but log the integrity issue
      }

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

  private async atomicWrite(
    key: string, 
    newBlock: DayBlock, 
    expectedVersion?: number
  ): Promise<boolean> {
    try {
      // Use Durable Object's atomic operations
      const currentBlock = await this.storage.get<DayBlock>(key);
      
      // Version check for optimistic locking
      if (expectedVersion !== undefined && currentBlock && currentBlock.version !== expectedVersion) {
        Logger.debug(this.env, 'DayBlockManager: version conflict detected', {
          key,
          expectedVersion,
          currentVersion: currentBlock.version
        });
        return false;
      }

      // Atomic write
      await this.storage.put(key, newBlock);
      return true;

    } catch (error: any) {
      Logger.error('DayBlockManager: atomic write failed', {
        key,
        error: error.message || String(error)
      });
      return false;
    }
  }

  private calculateBlockChecksum(block: DayBlock): string {
    // Create a deterministic string representation for checksum
    const checksumData = {
      date: block.date,
      chatId: block.chatId,
      messageCount: block.messageCount,
      messages: block.messages.map(m => ({
        ts: m.ts,
        user: m.user,
        text: m.text
      }))
    };
    
    return hashText(JSON.stringify(checksumData));
  }
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