import { afterEach, describe, expect, it, vi } from "vitest";
import { handleLegalRagIngestBatch } from "../../src/features/legal-rag/ingest";
import { createMockEnv } from "../test-utils";
import type { Env } from "../../src/core/env";

interface PreparedCall {
  sql: string;
  binds: unknown[];
  terminal: 'run' | 'all' | 'first';
}

interface IngestMock {
  env: Env;
  aiRun: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  deleteByIds: ReturnType<typeof vi.fn>;
  batch: ReturnType<typeof vi.fn>;
  prepareCalls: PreparedCall[];
}

interface IngestMockOptions {
  documentId?: number;
  previousVectorIds?: string[];
  numChunks?: number;
  aiBehavior?: 'good' | 'throw' | 'no-embedding';
  upsertBehavior?: 'resolve' | 'throw';
  batchBehavior?: 'resolve' | 'throw';
  firstBehavior?: 'resolve' | 'missing';
  envOverrides?: Partial<Env>;
}

function createIngestMockEnv(options: IngestMockOptions = {}): IngestMock {
  const documentId = options.documentId ?? 7;
  const previousVectorIds = options.previousVectorIds ?? [];
  const numChunks = options.numChunks ?? 3;

  let aiRun: ReturnType<typeof vi.fn>;
  if (options.aiBehavior === 'throw') {
    aiRun = vi.fn().mockRejectedValue(new Error('Workers AI rate limit'));
  } else if (options.aiBehavior === 'no-embedding') {
    // A non-throwing error-shaped payload: data is a truthy non-array, so
    // extractEmbeddings returns [] and the per-chunk fallback throws.
    aiRun = vi.fn().mockResolvedValue({ data: { error: 'rate limited' } });
  } else {
    const vectors = Array.from({ length: numChunks }, () => [0.1, 0.2, 0.3]);
    aiRun = vi.fn().mockResolvedValue({ data: vectors });
  }

  const upsert = options.upsertBehavior === 'throw'
    ? vi.fn().mockRejectedValue(new Error('Vectorize upsert failed'))
    : vi.fn().mockResolvedValue({ mutationId: 'm-upsert' });

  const deleteByIds = vi.fn().mockResolvedValue({ mutationId: 'm-delete' });
  const batch = options.batchBehavior === 'throw'
    ? vi.fn().mockRejectedValue(new Error('D1 batch failed'))
    : vi.fn().mockResolvedValue([]);

  const prepareCalls: PreparedCall[] = [];

  const prepare = (sql: string): any => ({
    bind: (...params: unknown[]) => ({
      run: () => {
        prepareCalls.push({ sql, binds: params, terminal: 'run' });
        return Promise.resolve({ success: true });
      },
      all: () => {
        prepareCalls.push({ sql, binds: params, terminal: 'all' });
        if (sql.includes('SELECT vector_id FROM legal_chunks')) {
          return Promise.resolve({
            results: previousVectorIds.map(id => ({ vector_id: id })),
          });
        }
        return Promise.resolve({ results: [] });
      },
      first: () => {
        prepareCalls.push({ sql, binds: params, terminal: 'first' });
        if (options.firstBehavior === 'missing') {
          return Promise.resolve(null);
        }
        return Promise.resolve({ id: documentId });
      },
    }),
    run: () => {
      prepareCalls.push({ sql, binds: [], terminal: 'run' });
      return Promise.resolve({ success: true });
    },
    all: () => {
      prepareCalls.push({ sql, binds: [], terminal: 'all' });
      return Promise.resolve({ results: [] });
    },
    first: () => {
      prepareCalls.push({ sql, binds: [], terminal: 'first' });
      return Promise.resolve(null);
    },
  });

  const db: any = {
    prepare: vi.fn(prepare),
    batch,
    exec: vi.fn().mockResolvedValue({ results: [] }),
    dump: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    withSession: vi.fn(async (cb: any) => cb(db)),
  };

  const env = createMockEnv({
    AI: { run: aiRun } as any,
    DB: db as any,
    LEGAL_RAG_INDEX: {
      upsert,
      deleteByIds,
      query: vi.fn().mockResolvedValue({ matches: [] }),
      insert: vi.fn().mockResolvedValue({ mutationId: 'm-insert' }),
      getByIds: vi.fn().mockResolvedValue([]),
    } as any,
    ...options.envOverrides,
  });

  return { env, aiRun, upsert, deleteByIds, batch, prepareCalls };
}

function callsMatching(mock: IngestMock, fragment: string, terminal?: PreparedCall['terminal']): PreparedCall[] {
  return mock.prepareCalls.filter(
    call => call.sql.includes(fragment) && (terminal === undefined || call.terminal === terminal)
  );
}

function makeDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    lawCode: 'uk-rf',
    title: 'Уголовный кодекс Российской Федерации',
    versionDate: '2026-01-01',
    sourceUrl: 'https://publication.pravo.gov.ru/',
    checksum: 'doc-checksum-v2',
    ...overrides,
  };
}

function makeChunks(
  count: number,
  options: { lawCode?: string; vectorIdPrefix?: string; omitField?: string } = {}
): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => {
    const lawCode = options.lawCode ?? 'uk-rf';
    const base: Record<string, unknown> = {
      lawCode,
      article: String(100 + index),
      subarticle: null,
      articleTitle: `Статья ${100 + index}`,
      chunkText: `chunk text ${index} `.repeat(10).trim(),
      vectorId: `${options.vectorIdPrefix ?? 'uk-rf'}:100:main:${index}:${index}`,
      sourceUrl: null,
      checksum: `chunk-checksum-${index}`,
    };
    if (options.omitField) {
      delete base[options.omitField];
    }
    return base;
  });
}

function makeRequest(
  body: unknown,
  options: { queryKey?: string | null; headerKey?: string | null } = {}
): Request {
  const url = new URL('http://localhost/api/legal-rag/ingest-batch');
  if (options.queryKey !== null && options.queryKey !== undefined) {
    url.searchParams.set('key', options.queryKey);
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.headerKey !== null && options.headerKey !== undefined) {
    headers['X-Legal-Rag-Ingest-Key'] = options.headerKey;
  }
  return new Request(url.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe("handleLegalRagIngestBatch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("successful ingest without replace", () => {
    it("upserts the document, chunks, and vectors without deleting anything", async () => {
      const mock = createIngestMockEnv({ numChunks: 3 });
      const req = makeRequest(
        { document: makeDocument(), chunks: makeChunks(3), replaceExisting: false },
        { queryKey: 'test-secret' }
      );

      const res = await handleLegalRagIngestBatch(req, mock.env);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        ok: true,
        lawCode: 'uk-rf',
        documentId: 7,
        chunks: 3,
      });

      // Document row created and resolved.
      expect(callsMatching(mock, 'INSERT OR IGNORE INTO legal_documents', 'run')).toHaveLength(1);
      expect(callsMatching(mock, 'SELECT id FROM legal_documents', 'first')).toHaveLength(1);

      // Chunks batched into D1.
      expect(mock.batch).toHaveBeenCalledTimes(1);
      expect(mock.batch.mock.calls[0][0]).toHaveLength(3);

      // Vectors upserted into Vectorize with the document checksum in metadata.
      expect(mock.upsert).toHaveBeenCalledTimes(1);
      const vectors = mock.upsert.mock.calls[0][0];
      expect(vectors).toHaveLength(3);
      expect(vectors[0]).toMatchObject({
        id: expect.any(String),
        values: expect.any(Array),
        metadata: expect.objectContaining({
          law_code: 'uk-rf',
          document_checksum: 'doc-checksum-v2',
        }),
      });

      // Nothing was deleted.
      expect(mock.deleteByIds).not.toHaveBeenCalled();
      expect(callsMatching(mock, 'DELETE FROM legal_chunks')).toHaveLength(0);
      expect(callsMatching(mock, 'DELETE FROM legal_documents')).toHaveLength(0);
      expect(callsMatching(mock, 'SELECT vector_id FROM legal_chunks')).toHaveLength(0);
    });
  });

  describe("successful ingest with replaceExisting", () => {
    it("removes only the previous version after the new corpus is fully persisted", async () => {
      const previousVectorIds = [
        'uk-rf:100:main:0:0', 'uk-rf:101:main:0:0', 'uk-rf:102:main:0:0',
        'uk-rf:103:main:0:0',
      ];
      const mock = createIngestMockEnv({
        documentId: 99,
        previousVectorIds,
        numChunks: 2,
      });
      const newChunks = makeChunks(2, { vectorIdPrefix: 'uk-rf-new' });
      const req = makeRequest(
        { document: makeDocument(), chunks: newChunks, replaceExisting: true },
        { queryKey: 'test-secret' }
      );

      const res = await handleLegalRagIngestBatch(req, mock.env);

      expect(res.status).toBe(200);

      // New document and chunks persisted BEFORE any deletion.
      expect(mock.upsert).toHaveBeenCalledTimes(1);
      expect(mock.batch).toHaveBeenCalledTimes(1);

      // Scoped SELECT only retrieves chunks from prior document versions.
      const selectCalls = callsMatching(mock, 'SELECT vector_id FROM legal_chunks', 'all');
      expect(selectCalls).toHaveLength(1);
      expect(selectCalls[0].binds).toEqual(['uk-rf', 99]);

      // Vectorize deletes target the previous version's vectors only.
      expect(mock.deleteByIds).toHaveBeenCalledTimes(1);
      expect(mock.deleteByIds.mock.calls[0][0]).toEqual(previousVectorIds);

      // D1 deletes are scoped to exclude the newly inserted document id.
      const deleteChunkCalls = callsMatching(mock, 'DELETE FROM legal_chunks', 'run');
      expect(deleteChunkCalls).toHaveLength(1);
      expect(deleteChunkCalls[0].binds).toEqual(['uk-rf', 99]);

      const deleteDocCalls = callsMatching(mock, 'DELETE FROM legal_documents', 'run');
      expect(deleteDocCalls).toHaveLength(1);
      expect(deleteDocCalls[0].binds).toEqual(['uk-rf', 99]);
    });

    it("batches Vectorize deleteByIds calls in groups of 100", async () => {
      const previousVectorIds = Array.from(
        { length: 250 },
        (_, index) => `uk-rf:200:main:0:${index}`
      );
      const mock = createIngestMockEnv({
        documentId: 5,
        previousVectorIds,
        numChunks: 1,
      });
      const req = makeRequest(
        { document: makeDocument(), chunks: makeChunks(1), replaceExisting: true },
        { queryKey: 'test-secret' }
      );

      await handleLegalRagIngestBatch(req, mock.env);

      expect(mock.deleteByIds).toHaveBeenCalledTimes(3);
      expect(mock.deleteByIds.mock.calls[0][0]).toHaveLength(100);
      expect(mock.deleteByIds.mock.calls[1][0]).toHaveLength(100);
      expect(mock.deleteByIds.mock.calls[2][0]).toHaveLength(50);
      expect(mock.deleteByIds.mock.calls[2][0]).toEqual(previousVectorIds.slice(200));
    });

    it("is a no-op when re-ingesting the same version (document id already exists)", async () => {
      // upsertDocument returns the existing document id (INSERT OR IGNORE hit),
      // so the scoped SELECT returns no rows and deleteByIds is never called.
      const mock = createIngestMockEnv({
        documentId: 42,
        previousVectorIds: [],
        numChunks: 2,
      });
      const req = makeRequest(
        { document: makeDocument(), chunks: makeChunks(2), replaceExisting: true },
        { queryKey: 'test-secret' }
      );

      const res = await handleLegalRagIngestBatch(req, mock.env);

      expect(res.status).toBe(200);
      expect(mock.deleteByIds).not.toHaveBeenCalled();

      // The scoped DELETEs still run but target zero rows (document_id != 42).
      expect(callsMatching(mock, 'DELETE FROM legal_chunks', 'run')).toHaveLength(1);
      expect(callsMatching(mock, 'DELETE FROM legal_documents', 'run')).toHaveLength(1);
      expect(callsMatching(mock, 'DELETE FROM legal_chunks', 'run')[0].binds).toEqual([
        'uk-rf',
        42,
      ]);
    });

    it("never deletes freshly-upserted vector ids even on collision", async () => {
      // Simulate a previous version that shares a vector id with the new batch.
      const newChunks = makeChunks(1, { vectorIdPrefix: 'uk-rf' });
      const sharedId = newChunks[0].vectorId as string;
      const mock = createIngestMockEnv({
        documentId: 8,
        previousVectorIds: [sharedId, 'uk-rf:999:main:0:0'],
        numChunks: 1,
      });
      const req = makeRequest(
        { document: makeDocument(), chunks: newChunks, replaceExisting: true },
        { queryKey: 'test-secret' }
      );

      await handleLegalRagIngestBatch(req, mock.env);

      // The shared id (which we just upserted) must be excluded from deletion.
      expect(mock.deleteByIds).toHaveBeenCalledTimes(1);
      expect(mock.deleteByIds.mock.calls[0][0]).toEqual(['uk-rf:999:main:0:0']);
      expect(mock.deleteByIds.mock.calls[0][0]).not.toContain(sharedId);
    });
  });

  describe("failure isolation — a failed ingest must not destroy the live corpus", () => {
    it("preserves the existing corpus when embedChunks throws (replaceExisting=true)", async () => {
      const mock = createIngestMockEnv({
        aiBehavior: 'throw',
        documentId: 3,
        previousVectorIds: ['uk-rf:100:main:0:0', 'uk-rf:101:main:0:0'],
        numChunks: 2,
      });
      const req = makeRequest(
        { document: makeDocument(), chunks: makeChunks(2), replaceExisting: true },
        { queryKey: 'test-secret' }
      );

      await expect(handleLegalRagIngestBatch(req, mock.env)).rejects.toThrow(
        'Workers AI rate limit'
      );

      // No Vectorize deletion was committed.
      expect(mock.deleteByIds).not.toHaveBeenCalled();
      // No D1 deletion was committed.
      expect(callsMatching(mock, 'DELETE FROM legal_chunks')).toHaveLength(0);
      expect(callsMatching(mock, 'DELETE FROM legal_documents')).toHaveLength(0);
      expect(callsMatching(mock, 'SELECT vector_id FROM legal_chunks')).toHaveLength(0);
      // New vectors were never upserted.
      expect(mock.upsert).not.toHaveBeenCalled();
    });

    it("preserves the existing corpus when Workers AI returns no embedding", async () => {
      const mock = createIngestMockEnv({
        aiBehavior: 'no-embedding',
        documentId: 3,
        previousVectorIds: ['uk-rf:100:main:0:0'],
        numChunks: 2,
      });
      const req = makeRequest(
        { document: makeDocument(), chunks: makeChunks(2), replaceExisting: true },
        { queryKey: 'test-secret' }
      );

      await expect(handleLegalRagIngestBatch(req, mock.env)).rejects.toThrow(
        'Workers AI embedding response did not include a vector'
      );

      expect(mock.deleteByIds).not.toHaveBeenCalled();
      expect(callsMatching(mock, 'DELETE FROM legal_chunks')).toHaveLength(0);
      expect(callsMatching(mock, 'DELETE FROM legal_documents')).toHaveLength(0);
      expect(mock.upsert).not.toHaveBeenCalled();
    });

    it("preserves the existing corpus when upsertDocument fails to resolve an id", async () => {
      const mock = createIngestMockEnv({
        firstBehavior: 'missing',
        documentId: 3,
        previousVectorIds: ['uk-rf:100:main:0:0'],
        numChunks: 2,
      });
      const req = makeRequest(
        { document: makeDocument(), chunks: makeChunks(2), replaceExisting: true },
        { queryKey: 'test-secret' }
      );

      await expect(handleLegalRagIngestBatch(req, mock.env)).rejects.toThrow(
        'failed to resolve legal document id after insert'
      );

      expect(mock.deleteByIds).not.toHaveBeenCalled();
      expect(callsMatching(mock, 'DELETE FROM legal_chunks')).toHaveLength(0);
      expect(callsMatching(mock, 'DELETE FROM legal_documents')).toHaveLength(0);
    });

    it("preserves the existing corpus when upsertChunks (D1 batch) throws", async () => {
      const mock = createIngestMockEnv({
        batchBehavior: 'throw',
        documentId: 3,
        previousVectorIds: ['uk-rf:100:main:0:0'],
        numChunks: 2,
      });
      const req = makeRequest(
        { document: makeDocument(), chunks: makeChunks(2), replaceExisting: true },
        { queryKey: 'test-secret' }
      );

      await expect(handleLegalRagIngestBatch(req, mock.env)).rejects.toThrow('D1 batch failed');

      expect(mock.deleteByIds).not.toHaveBeenCalled();
      expect(callsMatching(mock, 'DELETE FROM legal_chunks')).toHaveLength(0);
      expect(callsMatching(mock, 'DELETE FROM legal_documents')).toHaveLength(0);
      // Vectors were not upserted because the pipeline aborted at upsertChunks.
      expect(mock.upsert).not.toHaveBeenCalled();
    });

    it("preserves the existing corpus when upsertVectors (Vectorize) throws", async () => {
      const mock = createIngestMockEnv({
        upsertBehavior: 'throw',
        documentId: 3,
        previousVectorIds: ['uk-rf:100:main:0:0'],
        numChunks: 2,
      });
      const req = makeRequest(
        { document: makeDocument(), chunks: makeChunks(2), replaceExisting: true },
        { queryKey: 'test-secret' }
      );

      await expect(handleLegalRagIngestBatch(req, mock.env)).rejects.toThrow(
        'Vectorize upsert failed'
      );

      expect(mock.deleteByIds).not.toHaveBeenCalled();
      expect(callsMatching(mock, 'DELETE FROM legal_chunks')).toHaveLength(0);
      expect(callsMatching(mock, 'DELETE FROM legal_documents')).toHaveLength(0);
    });

    it("does not delete anything when a failure occurs and replaceExisting is false", async () => {
      const mock = createIngestMockEnv({
        aiBehavior: 'throw',
        documentId: 3,
        previousVectorIds: ['uk-rf:100:main:0:0'],
        numChunks: 2,
      });
      const req = makeRequest(
        { document: makeDocument(), chunks: makeChunks(2), replaceExisting: false },
        { queryKey: 'test-secret' }
      );

      await expect(handleLegalRagIngestBatch(req, mock.env)).rejects.toThrow(
        'Workers AI rate limit'
      );

      expect(mock.deleteByIds).not.toHaveBeenCalled();
      expect(callsMatching(mock, 'DELETE FROM legal_chunks')).toHaveLength(0);
      expect(callsMatching(mock, 'DELETE FROM legal_documents')).toHaveLength(0);
    });
  });

  describe("idempotent recovery — re-running after a failed first batch", () => {
    it("restores the corpus on retry without wiping it on the failed attempt", async () => {
      // First run: AI is unavailable. Old corpus must survive.
      const failedMock = createIngestMockEnv({
        aiBehavior: 'throw',
        documentId: 3,
        previousVectorIds: ['uk-rf:100:main:0:0'],
        numChunks: 2,
      });
      const failedReq = makeRequest(
        { document: makeDocument(), chunks: makeChunks(2), replaceExisting: true },
        { queryKey: 'test-secret' }
      );
      await expect(handleLegalRagIngestBatch(failedReq, failedMock.env)).rejects.toThrow();
      expect(failedMock.deleteByIds).not.toHaveBeenCalled();
      expect(
        callsMatching(failedMock, 'DELETE FROM legal_chunks')
      ).toHaveLength(0);

      // Second run: AI works. Ingest succeeds and the previous version is removed.
      const successMock = createIngestMockEnv({
        documentId: 4,
        previousVectorIds: ['uk-rf:100:main:0:0'],
        numChunks: 2,
      });
      const successReq = makeRequest(
        {
          document: makeDocument(),
          chunks: makeChunks(2, { vectorIdPrefix: 'uk-rf-new' }),
          replaceExisting: true,
        },
        { queryKey: 'test-secret' }
      );
      const res = await handleLegalRagIngestBatch(successReq, successMock.env);

      expect(res.status).toBe(200);
      expect(successMock.upsert).toHaveBeenCalledTimes(1);
      expect(successMock.deleteByIds).toHaveBeenCalledTimes(1);
      expect(successMock.deleteByIds.mock.calls[0][0]).toEqual(['uk-rf:100:main:0:0']);
    });
  });
});
