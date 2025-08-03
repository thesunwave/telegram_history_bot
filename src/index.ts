import { Env } from './env';
import { dailySummary } from './stats';
import { handleUpdate, recordMessage, getTextMessage } from './update';
import { CountersDO } from './counters-do';
import { ProviderInitializer } from './providers/provider-init';
import { Logger } from './logger';
import { ExecutionContext } from '@miniflare/core';
import { ScheduledEvent } from '@miniflare/core';
import { ExecutionContext } from '@miniflare/core';

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Initialize provider on first request if not already initialized
    if (!ProviderInitializer.isProviderInitialized()) {
      try {
        await ProviderInitializer.initializeProvider(env);
      } catch (error: any) {
        console.error("Failed to initialize provider on request", {
          error: error.message || String(error),
          path: new URL(req.url).pathname,
        });
        // Continue processing - provider will be created on-demand if needed
      }
    }

    const url = new URL(req.url);
    if (url.pathname === '/healthz') return new Response('ok');
    if (
      url.pathname.startsWith('/tg/') &&
      url.pathname.endsWith('/webhook') &&
      req.method === 'POST'
    ) {
      const token = url.pathname.split('/')[2];
      if (token !== env.TOKEN) return new Response('forbidden', { status: 403 });
      if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.SECRET)
        return new Response('forbidden', { status: 403 });
      const update = await req.json();
      Logger.debug(env, 'webhook received', {
        updateType: update.message ? 'message' : 'other',
        chatId: update.message?.chat?.id,
        messageId: update.message?.message_id,
        hasText: !!update.message?.text,
        isBot: update.message?.from?.is_bot
      });
      
      const msg = getTextMessage(update);
      Logger.debug(env, 'getTextMessage result', {
        hasMessage: !!msg,
        text: msg?.text?.substring(0, 50)
      });
      
      await recordMessage(msg, env);
      ctx.waitUntil(handleUpdate(msg, env));
      return Response.json({});
    }
    if (url.pathname === '/jobs/daily_summary' && req.method === 'POST') {
      await dailySummary(env);
      return Response.json({});
    }

    
    return new Response('Not found', { status: 404 });
  },
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    // Initialize provider for scheduled events if not already initialized
    if (!ProviderInitializer.isProviderInitialized()) {
      try {
        await ProviderInitializer.initializeProvider(env);
      } catch (error: any) {
        console.error("Failed to initialize provider on scheduled event", {
          error: error.message || String(error),
        });
        // Continue processing - provider will be created on-demand if needed
      }
    }
    
    await dailySummary(env);
  },
};

export { CountersDO };
