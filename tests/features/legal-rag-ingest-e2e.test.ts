import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryStorage } from "@miniflare/storage-memory";
import type { D1Database, ExecutionContext } from "@cloudflare/workers-types";
import { testWorker } from "../test-utils";
import { createMockEnv } from "../test-utils";
import type { Env } from "../../src/core/env";

/**
 * End-to-end integration test for the legal-RAG ingest pipeline.
 *
 * Uses a real in-memory SQLite database (via @miniflare/storage-memory
 * MemoryStorage.getSqliteDatabase, backed by better-sqlite3) with the actual
 * migration 0008_legal_rag_corpus.sql DDL applied, so the D1 SQL
 * (INSERT OR IGNORE, ON CONFLICT upserts, scoped DELETE ... AND document_id
 * != ?, SELECT vector_id) runs against real SQLite. Calls the real
 * `worker.fetch` entry point so the routing + try/catch in src/index.ts
 * (lines 138-147) is exercised. Only the unavailable-in-local-dev bindings
 * (Workers AI, Vectorize) are mocked — D1 is real.
 */

type Sqlite = Awaited<ReturnType<MemoryStorage["getSqliteDatabase"]>>;
type SQLInputValue = null | number | bigint | string | Uint8Array;

// Pre-warm better-sqlite3 (fetched lazily by MemoryStorage via npx-import).
{
  const warmup = await new MemoryStorage().getSqliteDatabase();
  warmup.close();
}

class FakeD1Statement {
  constructor(
    private readonly owner: FakeD1Database,
    readonly sql: string,
    public params: SQLInputValue[] = [],
  ) {}

  bind(...values: SQLInputValue[]): this {
    this.params = values;
    return this;
  }

  run(): unknown {
    const result = this.owner.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, results: [], meta: { changes: result.changes } };
  }

  all<T = unknown>(): { results: T[]; success: boolean; meta: Record<string, unknown> } {
    const results = this.owner.sqlite.prepare(this.sql).all(...this.params) as T[];
    return { results, success: true, meta: {} };
  }

  first<T = unknown>(): T | null {
    const results = this.owner.sqlite.prepare(this.sql).all(...this.params) as T[];
    return results.length > 0 ? results[0] : null;
  }
}

class FakeD1Database {
  readonly sqlite: Sqlite;

  constructor(sqlite: Sqlite) {
    this.sqlite = sqlite;
  }

  prepare(sql: string): FakeD1Statement {
    return new FakeD1Statement(this, sql);
  }

  async batch(statements: FakeD1Statement[]): Promise<unknown[]> {
    this.sqlite.exec("BEGIN");
    try {
      const results = statements.map((stmt) => {
        if (/^\s*SELECT/i.test(stmt.sql)) {
          return {
            success: true,
            results: this.sqlite.prepare(stmt.sql).all(...stmt.params),
            meta: {},
          };
        }
        return stmt.run();
      });
      this.sqlite.exec("COMMIT");
      return results;
    } catch (err) {
      this.sqlite.exec("ROLLBACK");
      throw err;
    }
  }

  async exec(sql: string): Promise<{ count: number; duration: number }> {
    this.sqlite.exec(sql);
    return { count: 1, duration: 0 };
  }
}

async function createRealD1(): Promise<{ db: D1Database; harness: FakeD1Database }> {
  const sqlite = await new MemoryStorage().getSqliteDatabase();
  const migrationsDir = fileURLToPath(new URL("../../migrations/", import.meta.url));
  const sql = readFileSync(join(migrationsDir, "0008_legal_rag_corpus.sql"), "utf8");
  for (const statement of sql.split(";")) {
    if (statement.trim()) sqlite.exec(statement);
  }
  const harness = new FakeD1Database(sqlite);
  return { db: harness as unknown as D1Database, harness };
}

function rows(sqlite: Sqlite, sql: string, params: SQLInputValue[] = []): any[] {
  return sqlite.prepare(sql).all(...params) as any[];
}

function seedCorpus(
  sqlite: Sqlite,
  doc: { id: number; lawCode: string; title: string; versionDate: string; checksum: string },
  chunks: Array<{ vectorId: string; article: string; articleTitle: string; chunkText: string; checksum: string }>,
): void {
  sqlite
    .prepare(
      "INSERT INTO legal_documents (id, law_code, title, version_date, source_url, checksum) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(doc.id, doc.lawCode, doc.title, doc.versionDate, null, doc.checksum);
  for (const chunk of chunks) {
    sqlite
      .prepare(
        "INSERT INTO legal_chunks (document_id, law_code, article, subarticle, article_title, chunk_text, vector_id, source_url, checksum) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        doc.id,
        doc.lawCode,
        chunk.article,
        null,
        chunk.articleTitle,
        chunk.chunkText,
        chunk.vectorId,
        null,
        chunk.checksum,
      );
  }
}

function ingestBody(
  options: {
    lawCode?: string;
    versionDate: string;
    checksum: string;
    vectorIdPrefix: string;
    chunkChecksumSuffix: string;
    chunkCount: number;
    replaceExisting: boolean;
  },
): string {
  const lawCode = options.lawCode ?? "uk-rf";
  const chunks = Array.from({ length: options.chunkCount }, (_, index) => ({
    lawCode,
    article: String(100 + index),
    subarticle: null,
    articleTitle: `Статья ${100 + index}`,
    chunkText: `chunk text ${index} `.repeat(8).trim(),
    vectorId: `${options.vectorIdPrefix}:100:main:${index}:${options.chunkChecksumSuffix}`,
    sourceUrl: null,
    checksum: `chk-${options.chunkChecksumSuffix}-${index}`,
  }));
  return JSON.stringify({
    document: {
      lawCode,
      title: "Уголовный кодекс Российской Федерации",
      versionDate: options.versionDate,
      sourceUrl: "https://example.ru/",
      checksum: options.checksum,
    },
    chunks,
    replaceExisting: options.replaceExisting,
  });
}

function makeIngestRequest(body: string, key = "test-secret"): Request {
  return new Request(
    `http://localhost/api/legal-rag/ingest-batch?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    },
  );
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

describe("legal-RAG ingest end-to-end (real D1 + real worker.fetch)", () => {
  let harness: FakeD1Database;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function buildEnv(options: {
    aiBehavior: "good" | "throw";
    vectorize?: any;
  }): Promise<Env> {
    const { db, harness: h } = await createRealD1();
    harness = h;

    let aiRun: ReturnType<typeof vi.fn>;
    if (options.aiBehavior === "throw") {
      aiRun = vi.fn().mockRejectedValue(new Error("Workers AI rate limit (no auth)"));
    } else {
      aiRun = vi.fn().mockResolvedValue({ data: [[0.1, 0.2, 0.3]] });
    }

    const vectorize =
      options.vectorize ??
      {
        query: vi.fn().mockResolvedValue({ matches: [] }),
        insert: vi.fn().mockResolvedValue({ mutationId: "m" }),
        upsert: vi.fn().mockResolvedValue({ mutationId: "m" }),
        deleteByIds: vi.fn().mockResolvedValue({ mutationId: "m" }),
        getByIds: vi.fn().mockResolvedValue([]),
      };

    return createMockEnv({
      DB: db as any,
      AI: { run: aiRun } as any,
      LEGAL_RAG_INDEX: vectorize as any,
    });
  }

  it("E: preserves the live corpus when the first batch fails on replaceExisting=true (real D1, real routing)", async () => {
    const env = await buildEnv({ aiBehavior: "throw" });
    seedCorpus(
      harness.sqlite,
      { id: 1, lawCode: "uk-rf", title: "УК РФ", versionDate: "2026-01-01", checksum: "doc-v1" },
      [
        { vectorId: "uk-rf:105:main:0:v1a", article: "105", articleTitle: "Убийство", chunkText: "Убийство...", checksum: "chk-v1-0" },
        { vectorId: "uk-rf:119:main:0:v1b", article: "119", articleTitle: "Угроза", chunkText: "Угроза...", checksum: "chk-v1-1" },
        { vectorId: "uk-rf:282:main:0:v1c", article: "282", articleTitle: "Экстремизм", chunkText: "Экстремизм...", checksum: "chk-v1-2" },
      ],
    );

    // Snapshot before the failing call.
    const before = rows(
      harness.sqlite,
      "SELECT COUNT(*) AS c, (SELECT COUNT(*) FROM legal_documents WHERE law_code='uk-rf') AS d FROM legal_chunks WHERE law_code='uk-rf'",
    )[0];
    expect(before).toEqual({ c: 3, d: 1 });

    // Send batch 0 with replaceExisting=true. AI throws (e.g. no Cloudflare
    // auth / rate-limited). The route catch in src/index.ts:138-147 must
    // convert to HTTP 400, and the live corpus must survive (the fix).
    const res = await testWorker.fetch(
      makeIngestRequest(
        ingestBody({
          versionDate: "2026-02-02",
          checksum: "doc-v2",
          vectorIdPrefix: "uk-rf",
          chunkChecksumSuffix: "v2",
          chunkCount: 2,
          replaceExisting: true,
        }),
      ),
      env,
      makeCtx(),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "Workers AI rate limit (no auth)" });

    // Core guarantee: the live v1 corpus is INTACT after the failed ingest.
    // The v2 document row was inserted by upsertDocument BEFORE embedChunks
    // threw (so d=2: v1 doc + v2 doc), but all 3 v1 chunks survive and the
    // scoped cleanup that would have removed v1 never ran.
    const after = rows(
      harness.sqlite,
      "SELECT COUNT(*) AS c, (SELECT COUNT(*) FROM legal_documents WHERE law_code='uk-rf') AS d FROM legal_chunks WHERE law_code='uk-rf'",
    )[0];
    expect(after).toEqual({ c: 3, d: 2 });

    // Vectorize deletes were never committed.
    expect(env.LEGAL_RAG_INDEX.deleteByIds).not.toHaveBeenCalled();
    // legal_documents holds both v1 and v2 rows (v2 inserted before the throw),
    // but the v1 document and all v1 chunks survive (scoped cleanup never ran).
    const docs = rows(
      harness.sqlite,
      "SELECT id, checksum FROM legal_documents WHERE law_code='uk-rf' ORDER BY id",
    );
    expect(docs.map((r) => r.checksum)).toEqual(["doc-v1", "doc-v2"]);
    // v1 chunks untouched.
    const v1Chunks = rows(
      harness.sqlite,
      "SELECT COUNT(*) AS c FROM legal_chunks WHERE document_id = 1",
    )[0];
    expect(v1Chunks.c).toBe(3);
  });

  it("E (no_embeddings variant): preserves the corpus when Workers AI returns a non-throwing error payload", async () => {
    const env = await buildEnv({ aiBehavior: "throw" });
    // Override AI to return a non-throwing error-shaped payload.
    (env.AI as any).run = vi.fn().mockResolvedValue({ data: { error: "rate limited" } });
    seedCorpus(
      harness.sqlite,
      { id: 1, lawCode: "uk-rf", title: "УК РФ", versionDate: "2026-01-01", checksum: "doc-v1" },
      [
        { vectorId: "uk-rf:105:main:0:v1a", article: "105", articleTitle: "У", chunkText: "x", checksum: "chk-v1-0" },
      ],
    );

    const res = await testWorker.fetch(
      makeIngestRequest(
        ingestBody({
          versionDate: "2026-02-02",
          checksum: "doc-v2",
          vectorIdPrefix: "uk-rf",
          chunkChecksumSuffix: "v2",
          chunkCount: 1,
          replaceExisting: true,
        }),
      ),
      env,
      makeCtx(),
    );

    expect(res.status).toBe(400);
    const after = rows(
      harness.sqlite,
      "SELECT COUNT(*) AS c, (SELECT COUNT(*) FROM legal_documents WHERE law_code='uk-rf') AS d FROM legal_chunks WHERE law_code='uk-rf'",
    )[0];
    // v1 chunk + v1 doc survive; v2 doc row inserted before embedChunks threw.
    expect(after.c).toBe(1);
    expect(after.d).toBe(2);
    expect(env.LEGAL_RAG_INDEX.deleteByIds).not.toHaveBeenCalled();
  });

  it("F: scoped cleanup replaces only the previous version on a successful replaceExisting=true ingest", async () => {
    const env = await buildEnv({ aiBehavior: "good" });
    const deleteByIds = env.LEGAL_RAG_INDEX.deleteByIds;
    seedCorpus(
      harness.sqlite,
      { id: 1, lawCode: "uk-rf", title: "УК РФ", versionDate: "2026-01-01", checksum: "doc-v1" },
      [
        { vectorId: "uk-rf:105:main:0:v1a", article: "105", articleTitle: "Убийство", chunkText: "Убийство v1", checksum: "chk-v1-0" },
        { vectorId: "uk-rf:119:main:0:v1b", article: "119", articleTitle: "Угроза", chunkText: "Угроза v1", checksum: "chk-v1-1" },
        { vectorId: "uk-rf:282:main:0:v1c", article: "282", articleTitle: "Экстремизм", chunkText: "Экстремизм v1", checksum: "chk-v1-2" },
      ],
    );

    // Ingest version B (new checksum/versionDate) with replaceExisting=true.
    const res = await testWorker.fetch(
      makeIngestRequest(
        ingestBody({
          versionDate: "2026-02-02",
          checksum: "doc-v2",
          vectorIdPrefix: "uk-rf-new",
          chunkChecksumSuffix: "v2",
          chunkCount: 2,
          replaceExisting: true,
        }),
      ),
      env,
      makeCtx(),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; chunks: number };
    expect(body.ok).toBe(true);
    expect(body.chunks).toBe(2);

    // legal_documents: exactly ONE uk-rf row, checksum doc-v2.
    const docs = rows(
      harness.sqlite,
      "SELECT id, checksum FROM legal_documents WHERE law_code='uk-rf'",
    );
    expect(docs).toHaveLength(1);
    expect(docs[0].checksum).toBe("doc-v2");
    const v2DocId = docs[0].id;

    // legal_chunks: only version B's chunks, all pointing at v2's document_id.
    const chunks = rows(
      harness.sqlite,
      "SELECT document_id, vector_id, checksum FROM legal_chunks WHERE law_code='uk-rf' ORDER BY id",
    );
    expect(chunks).toHaveLength(2);
    expect(chunks.every((r) => r.document_id === v2DocId)).toBe(true);
    expect(chunks.map((r) => r.vector_id)).toEqual([
      "uk-rf-new:100:main:0:v2",
      "uk-rf-new:100:main:1:v2",
    ]);

    // Vectorize: deleteByIds called with all v1 vector ids (none of which
    // overlap with the new v2 vector ids).
    expect(deleteByIds).toHaveBeenCalledTimes(1);
    expect(deleteByIds.mock.calls[0][0]).toEqual([
      "uk-rf:105:main:0:v1a",
      "uk-rf:119:main:0:v1b",
      "uk-rf:282:main:0:v1c",
    ]);
    // Vectorize upsert was called with the 2 new vectors.
    expect(env.LEGAL_RAG_INDEX.upsert).toHaveBeenCalledTimes(1);
    expect(env.LEGAL_RAG_INDEX.upsert.mock.calls[0][0]).toHaveLength(2);
  });

  it("F (idempotent re-ingest): re-ingesting an unchanged version is a no-op deletion", async () => {
    const env = await buildEnv({ aiBehavior: "good" });
    const deleteByIds = env.LEGAL_RAG_INDEX.deleteByIds;

    // Ingest version B once.
    await testWorker.fetch(
      makeIngestRequest(
        ingestBody({
          versionDate: "2026-02-02",
          checksum: "doc-v2",
          vectorIdPrefix: "uk-rf-new",
          chunkChecksumSuffix: "v2",
          chunkCount: 2,
          replaceExisting: true,
        }),
      ),
      env,
      makeCtx(),
    );
    expect(deleteByIds).not.toHaveBeenCalled(); // empty corpus before first ingest

    const docsAfterFirst = rows(
      harness.sqlite,
      "SELECT COUNT(*) AS c FROM legal_documents WHERE law_code='uk-rf'",
    )[0];
    const chunksAfterFirst = rows(
      harness.sqlite,
      "SELECT COUNT(*) AS c FROM legal_chunks WHERE law_code='uk-rf'",
    )[0];

    // Re-ingest the SAME version (same checksum/versionDate). upsertDocument
    // returns the EXISTING document id (INSERT OR IGNORE hit), so the scoped
    // SELECT returns zero rows and deleteByIds is a no-op.
    deleteByIds.mockClear();
    const res = await testWorker.fetch(
      makeIngestRequest(
        ingestBody({
          versionDate: "2026-02-02",
          checksum: "doc-v2",
          vectorIdPrefix: "uk-rf-new",
          chunkChecksumSuffix: "v2",
          chunkCount: 2,
          replaceExisting: true,
        }),
      ),
      env,
      makeCtx(),
    );

    expect(res.status).toBe(200);
    expect(deleteByIds).not.toHaveBeenCalled();

    const docsAfterSecond = rows(
      harness.sqlite,
      "SELECT COUNT(*) AS c FROM legal_documents WHERE law_code='uk-rf'",
    )[0];
    const chunksAfterSecond = rows(
      harness.sqlite,
      "SELECT COUNT(*) AS c FROM legal_chunks WHERE law_code='uk-rf'",
    )[0];
    expect(docsAfterSecond.c).toBe(docsAfterFirst.c);
    expect(chunksAfterSecond.c).toBe(chunksAfterFirst.c);
  });

  it("G7: a non-replace batch (replaceExisting=false) appends chunks without any deletion", async () => {
    const env = await buildEnv({ aiBehavior: "good" });
    const deleteByIds = env.LEGAL_RAG_INDEX.deleteByIds;
    seedCorpus(
      harness.sqlite,
      { id: 1, lawCode: "uk-rf", title: "УК РФ", versionDate: "2026-01-01", checksum: "doc-v1" },
      [
        { vectorId: "uk-rf:105:main:0:v1a", article: "105", articleTitle: "У", chunkText: "x", checksum: "chk-v1-0" },
      ],
    );

    const res = await testWorker.fetch(
      makeIngestRequest(
        ingestBody({
          versionDate: "2026-02-02",
          checksum: "doc-v2",
          vectorIdPrefix: "uk-rf-new",
          chunkChecksumSuffix: "v2",
          chunkCount: 1,
          replaceExisting: false,
        }),
      ),
      env,
      makeCtx(),
    );

    expect(res.status).toBe(200);
    expect(deleteByIds).not.toHaveBeenCalled();

    // Both versions coexist (no cleanup was performed).
    const docs = rows(harness.sqlite, "SELECT COUNT(*) AS c FROM legal_documents WHERE law_code='uk-rf'")[0];
    expect(docs.c).toBe(2);
    const chunks = rows(harness.sqlite, "SELECT COUNT(*) AS c FROM legal_chunks WHERE law_code='uk-rf'")[0];
    expect(chunks.c).toBe(2);
  });
});
