
import { Env } from './env';

export async function migrateStatsBatch(env: Env, cursor?: string): Promise<{ processed: number; nextCursor?: string; error?: string }> {
    const prefix = 'stats:';
    let processed = 0;

    try {
        const list = await env.COUNTERS.list({ prefix, cursor, limit: 100 }); // Process 100 at a time to be safe within timeout

        for (const key of list.keys) {
            // Parse old key: stats:chatId:userId:day
            const parts = key.name.split(':');
            if (parts.length !== 4) continue;

            const [_, chatId, userId, day] = parts;

            // Create new key: stats_v2:chatId:day:userId
            const newKey = `stats_v2:${chatId}:${day}:${userId}`;

            // Read value
            const value = await env.COUNTERS.get(key.name);
            if (value) {
                // Write to new key
                await env.COUNTERS.put(newKey, value);
                processed++;
            }
        }

        return {
            processed,
            nextCursor: !list.list_complete ? list.cursor : undefined,
        };
    } catch (e: any) {
        return { processed, error: e.message };
    }
}

export const MIGRATION_PAGE = `
<!DOCTYPE html>
<html>
<head>
  <title>Stats Migration</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 600px; margin: 2rem auto; padding: 0 1rem; }
    .log { background: #f5f5f5; padding: 1rem; border-radius: 4px; height: 300px; overflow-y: auto; font-family: monospace; }
    button { font-size: 1.2rem; padding: 0.5rem 1rem; cursor: pointer; }
  </style>
</head>
<body>
  <h1>Stats Migration (v1 -> v2)</h1>
  <p>This tool will migrate your statistics data to the new format.</p>
  <button id="startBtn" onclick="startMigration()">Start Migration</button>
  <div id="status" style="margin: 1rem 0;">Ready</div>
  <div class="log" id="log"></div>

  <script>
    async function startMigration() {
      const btn = document.getElementById('startBtn');
      const status = document.getElementById('status');
      const log = document.getElementById('log');
      
      btn.disabled = true;
      let cursor = null;
      let total = 0;
      
      const appendLog = (msg) => {
        const div = document.createElement('div');
        div.textContent = new Date().toLocaleTimeString() + ': ' + msg;
        log.appendChild(div);
        log.scrollTop = log.scrollHeight;
      };

      try {
        while (true) {
          status.textContent = 'Processing batch... Total: ' + total;
          const url = '/api/migrate' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '');
          
          const res = await fetch(url, { method: 'POST' });
          if (!res.ok) throw new Error('Request failed: ' + res.status);
          
          const data = await res.json();
          
          if (data.error) throw new Error(data.error);
          
          total += data.processed;
          appendLog('Processed batch: ' + data.processed + ' items.');
          
          if (!data.nextCursor) {
            status.textContent = 'Done! Total migrated: ' + total;
            appendLog('Migration complete!');
            break;
          }
          
          cursor = data.nextCursor;
        }
      } catch (e) {
        status.textContent = 'Error: ' + e.message;
        appendLog('Error: ' + e.message);
        btn.disabled = false;
      }
    }
  </script>
</body>
</html>
`;
