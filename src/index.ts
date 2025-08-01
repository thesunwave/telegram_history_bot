import { Env } from './env';
import { dailySummary } from './stats';
import { handleUpdate, recordMessage, getTextMessage } from './update';
import { CountersDO } from './counters-do';

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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
    await dailySummary(env);
  },
};

export { CountersDO };
