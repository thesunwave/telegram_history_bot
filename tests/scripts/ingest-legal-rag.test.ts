import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('ingest-legal-rag script', () => {
  it('requests replacement only on the final batch', async () => {
    const requests: Array<{ replaceExisting?: boolean }> = [];
    const server = createServer((req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', chunk => {
        body += chunk;
      });
      req.on('end', () => {
        requests.push(JSON.parse(body) as { replaceExisting?: boolean });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('failed to bind test HTTP server');
    }

    const tempDir = await mkdtemp(join(tmpdir(), 'legal-rag-ingest-'));
    const sourcePath = join(tempDir, 'source.txt');
    await writeFile(
      sourcePath,
      ['Статья 1. Первая', 'Текст первой статьи.', '', 'Статья 2. Вторая', 'Текст второй статьи.'].join('\n'),
      'utf8'
    );

    try {
      await execFileAsync(
        process.execPath,
        [
          'scripts/ingest-legal-rag.mjs',
          '--source',
          sourcePath,
          '--endpoint',
          `http://127.0.0.1:${address.port}`,
          '--key',
          'test-secret',
          '--version-date',
          '2026-02-02',
          '--batch-size',
          '1',
        ],
        { cwd: process.cwd() }
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      });
      await rm(tempDir, { recursive: true, force: true });
    }

    expect(requests).toHaveLength(2);
    expect(requests.map(request => request.replaceExisting)).toEqual([false, true]);
  });
});
