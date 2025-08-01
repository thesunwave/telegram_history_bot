import { Env } from './env';
import { dailySummary } from './stats';
import { handleUpdate, recordMessage, getTextMessage } from './update';
import { CountersDO } from './counters-do';
import { ProviderInitializer } from './providers/provider-init';

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
      const msg = getTextMessage(update);
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
