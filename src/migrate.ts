import { Env } from './env';

export async function migrateStatsBatch(env: Env, cursor?: string): Promise<{ processed: number; nextCursor?: string; error?: string }> {
  const prefix = 'stats:';
  let processed = 0;
  const activityTotals = new Map<string, number>();

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
        // Write to new key (always safe to overwrite with same value)
        await env.COUNTERS.put(newKey, value);

        // Aggregate for activity key
        // We blindly add here because we assume we are running a fresh migration or have reset activity keys.
        const count = parseInt(value, 10);
        const activityKey = `${chatId}:${day}`;
        activityTotals.set(activityKey, (activityTotals.get(activityKey) || 0) + count);

        processed++;
      }
    }

    // Update activity keys
    for (const [key, count] of activityTotals) {
      const [chatId, day] = key.split(':');
      const activityKey = `activity:${chatId}:${day}`;
      const current = await env.COUNTERS.get(activityKey);
      const currentVal = current ? parseInt(current, 10) : 0;
      const nextVal = currentVal + count;
      await env.COUNTERS.put(activityKey, nextVal.toString());

      if (env.DB) {
        try {
          await env.DB.prepare(
            'INSERT INTO activity (chat_id, day, count) VALUES (?, ?, ?) ' +
            'ON CONFLICT(chat_id, day) DO UPDATE SET count = count + ?',
          )
            .bind(Number(chatId), day, count, count)
            .run();
        } catch (e: any) {
          return { processed, error: e.message };
        }
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

export async function resetActivityBatch(env: Env, cursor?: string): Promise<{ processed: number; nextCursor?: string; error?: string }> {
  const prefix = 'activity:';
  let processed = 0;

  try {
    if (!cursor && env.DB) {
      await env.DB.prepare('DELETE FROM activity').run();
    }

    const list = await env.COUNTERS.list({ prefix, cursor, limit: 100 });

    for (const key of list.keys) {
      await env.COUNTERS.delete(key.name);
      processed++;
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
    button { font-size: 1.2rem; padding: 0.5rem 1rem; cursor: pointer; margin-right: 1rem; }
    .danger { background-color: #fee; border: 1px solid #fcc; color: #c00; padding: 1rem; margin-bottom: 1rem; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Stats Repair & Migration</h1>
  
  <div class="danger">
    <h3>⚠️ Full Repair Mode</h3>
    <p>This will <b>DELETE</b> all existing activity graphs and rebuild them from user history.</p>
    <p>Use this if you suspect your graphs are incorrect or corrupted.</p>
    <button id="repairBtn" onclick="startRepair()">Reset & Rebuild All</button>
  </div>

  <div id="status" style="margin: 1rem 0;">Ready</div>
  <div class="log" id="log"></div>

  <script>
    const logEl = document.getElementById('log');
    const statusEl = document.getElementById('status');
    const repairBtn = document.getElementById('repairBtn');

    const appendLog = (msg) => {
      const div = document.createElement('div');
      div.textContent = new Date().toLocaleTimeString() + ': ' + msg;
      logEl.appendChild(div);
      logEl.scrollTop = logEl.scrollHeight;
    };

    async function runBatchProcess(name, url) {
      let cursor = null;
      let total = 0;
      
      appendLog('Starting ' + name + '...');
      
      while (true) {
        statusEl.textContent = name + '... Total: ' + total;
        const urlParams = new URL(window.location.href).searchParams;
        const key = urlParams.get('key');
        const authParam = key ? (cursor ? '&' : '?') + 'key=' + encodeURIComponent(key) : '';
        const fullUrl = url + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '') + authParam;
        
        const res = await fetch(fullUrl, { method: 'POST' });
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        
        total += data.processed;
        
        if (!data.nextCursor) {
          appendLog(name + ' complete! Processed: ' + total);
          return;
        }
        
        cursor = data.nextCursor;
      }
    }

    async function startRepair() {
      if (!confirm('Are you sure? This will delete all activity graphs and rebuild them. This cannot be undone.')) return;
      
      repairBtn.disabled = true;
      
      try {
        // Step 1: Reset Activity
        await runBatchProcess('Resetting Activity', '/api/reset-activity');
        
        // Step 2: Migrate (Rebuild)
        await runBatchProcess('Rebuilding Stats', '/api/migrate');
        
        statusEl.textContent = 'All Done!';
        appendLog('Full repair completed successfully!');
      } catch (e) {
        statusEl.textContent = 'Error: ' + e.message;
        appendLog('Error: ' + e.message);
        repairBtn.disabled = false;
      }
    }
  </script>
</body>
</html>
`;
