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

  it('does not upload a tiny trailing chunk when an article barely exceeds the limit', async () => {
    const uploadedChunks: Array<{ chunkText: string }> = [];
    const server = createServer((req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', chunk => {
        body += chunk;
      });
      req.on('end', () => {
        const payload = JSON.parse(body) as { chunks?: Array<{ chunkText: string }> };
        uploadedChunks.push(...(payload.chunks || []));
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

    const tempDir = await mkdtemp(join(tmpdir(), 'legal-rag-chunking-'));
    const sourcePath = join(tempDir, 'source.txt');
    const body = Array.from({ length: 10 }, (_, index) => `условие${index}`).join(' ');
    const sourceText = `Статья 322.3. Тест\n${body}`;
    await writeFile(sourcePath, sourceText, 'utf8');

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
          '2026-09-10',
          '--max-chunk-chars',
          '100',
        ],
        { cwd: process.cwd() }
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      });
      await rm(tempDir, { recursive: true, force: true });
    }

    expect(uploadedChunks.length).toBeGreaterThan(1);
    expect(uploadedChunks.every(chunk => chunk.chunkText.length <= 100)).toBe(true);
    expect(uploadedChunks.at(-1)?.chunkText.length).toBeGreaterThanOrEqual(25);
    expect(uploadedChunks.map(chunk => chunk.chunkText).join(' ')).toBe(
      sourceText.replace(/\s+/g, ' ').trim()
    );
  });

  it('does not confuse numbered notes with article parts or attach following headings', async () => {
    const uploadedChunks: Array<{
      article: string;
      subarticle: string | null;
      chunkText: string;
    }> = [];
    const server = createServer((req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', chunk => {
        body += chunk;
      });
      req.on('end', () => {
        const payload = JSON.parse(body) as { chunks?: typeof uploadedChunks };
        uploadedChunks.push(...(payload.chunks || []));
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

    const tempDir = await mkdtemp(join(tmpdir(), 'legal-rag-sections-'));
    const sourcePath = join(tempDir, 'source.txt');
    await writeFile(
      sourcePath,
      [
        'Статья 322.3. Фиктивная постановка на учет',
        'Фиктивная постановка на учет - наказывается штрафом.',
        'Примечания. 1. Первое определение.',
        '2. Второе примечание к статье.',
        '',
        'Раздел XI. Преступления против государственной власти',
        '',
        'Глава 32. Преступления против порядка управления',
        '',
        'Статья 323. Настоящая статья с частями',
        '1. Первая часть состава.',
        '2. Вторая часть состава.',
      ].join('\n'),
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
          '2026-09-10',
        ],
        { cwd: process.cwd() }
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      });
      await rm(tempDir, { recursive: true, force: true });
    }

    const noteChunks = uploadedChunks.filter(chunk => chunk.article === '322.3');
    expect(noteChunks.length).toBeGreaterThan(0);
    expect(noteChunks.every(chunk => chunk.subarticle === null)).toBe(true);
    expect(noteChunks.map(chunk => chunk.chunkText).join(' ')).toContain('2. Второе примечание');
    expect(noteChunks.map(chunk => chunk.chunkText).join(' ')).not.toContain('Раздел XI');
    expect(noteChunks.map(chunk => chunk.chunkText).join(' ')).not.toContain('Глава 32');

    const numberedParts = uploadedChunks
      .filter(chunk => chunk.article === '323')
      .map(chunk => chunk.subarticle);
    expect(numberedParts).toEqual(['1', '2']);
  });
});
