import dotenv from 'dotenv';
import process from 'node:process';

// Load environment variables
dotenv.config();

const TOKEN = process.env.TOKEN;
const SECRET = process.env.SECRET;
const WORKER_URL = 'http://127.0.0.1:8787';

if (!TOKEN || !SECRET) {
    console.error('Error: TOKEN or SECRET not found in .env file');
    process.exit(1);
}

console.log('🚀 Starting Telegram Polling Service');
console.log(`target: ${WORKER_URL}`);

let offset = 0;

async function poll() {
    try {
        const response = await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates?offset=${offset}&timeout=30`, {
            method: 'POST', // getUpdates can be POST
        });

        if (!response.ok) {
            throw new Error(`Telegram API Error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        if (!data.ok) {
            console.error('Telegram response not ok:', data);
            // Wait a bit before retrying to avoid spamming logs if something is wrong
            setTimeout(poll, 5000);
            return;
        }

        const updates = data.result;

        if (updates.length > 0) {
            console.log(`Received ${updates.length} update(s)`);

            for (const update of updates) {
                // Forward to local worker
                try {
                    const webhookUrl = `${WORKER_URL}/tg/${TOKEN}/webhook`;
                    console.log(`Forwarding update ${update.update_id} to ${webhookUrl}`);

                    const workerResponse = await fetch(webhookUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Telegram-Bot-Api-Secret-Token': SECRET
                        },
                        body: JSON.stringify(update)
                    });

                    if (workerResponse.ok) {
                        console.log(`✅ Update ${update.update_id} processed`);
                        // Only advance offset if processing succeeded (or we might want to skip anyway to avoid stickiness, but for dev standard parsing is fine)
                        offset = update.update_id + 1;
                    } else {
                        console.error(`❌ Worker rejected update ${update.update_id}: ${workerResponse.status}`);
                    }
                } catch (err) {
                    console.error(`❌ Failed to forward update ${update.update_id}:`, err);
                }
            }
        }

        // Immediate poll again (long polling)
        setImmediate(poll);

    } catch (error) {
        if (error.name === 'AbortError') {
            // ignore
        } else {
            console.error('Polling error:', error);
            // Wait before retry
            setTimeout(poll, 3000);
        }
    }
}

poll();
