import { Env } from '../../core/env';
import { LegalRagProvider } from '../../core/providers/legal-rag-provider';

interface IngestLegalDocumentRequest {
  lawCode: string;
  title: string;
  versionDate: string;
  sourceUrl?: string | null;
  checksum: string;
}

interface IngestLegalChunkRequest {
  lawCode: string;
  article: string;
  subarticle?: string | null;
  articleTitle?: string;
  chunkText: string;
  vectorId: string;
  sourceUrl?: string | null;
  checksum: string;
}

interface IngestLegalRagBatchRequest {
  document: IngestLegalDocumentRequest;
  chunks: IngestLegalChunkRequest[];
  replaceExisting?: boolean;
}

const DEFAULT_EMBEDDING_MODEL = '@cf/baai/bge-m3';
const MAX_BATCH_CHUNKS = 50;

export async function handleLegalRagIngestBatch(req: Request, env: Env): Promise<Response> {
  if (!isAuthorizedLegalRagRequest(req, env)) {
    return new Response('Unauthorized', { status: 403 });
  }

  if (!env.AI?.run || !env.DB?.prepare || !env.LEGAL_RAG_INDEX?.upsert) {
    return Response.json({ error: 'Legal RAG bindings are not configured' }, { status: 500 });
  }

  const payload = await req.json<IngestLegalRagBatchRequest>();
  validatePayload(payload);

  const documentId = await upsertDocument(payload.document, env);
  const embeddings = await embedChunks(payload.chunks, env);
  await upsertChunks(documentId, payload.chunks, env);
  await upsertVectors(payload.chunks, embeddings, payload.document.checksum, env);

  if (payload.replaceExisting) {
    await deletePreviousCorpusExcluding(payload.document.lawCode, documentId, payload.chunks, env);
  }

  return Response.json({
    ok: true,
    lawCode: payload.document.lawCode,
    documentId,
    chunks: payload.chunks.length,
  });
}

export async function handleLegalRagSearch(req: Request, env: Env): Promise<Response> {
  if (!isAuthorizedLegalRagRequest(req, env)) {
    return new Response('Unauthorized', { status: 403 });
  }

  const payload = await req.json<{ text?: string }>();
  const text = payload.text?.trim();
  if (!text) {
    return Response.json({ error: 'text is required' }, { status: 400 });
  }

  const provider = new LegalRagProvider(env);
  const result = await provider.analyzeCriminalCode(text, env);
  return Response.json({
    decision: result.decision,
    hasViolations: result.hasViolations,
    legalReferences: result.legalReferences || [],
  });
}

function isAuthorizedLegalRagRequest(req: Request, env: Env): boolean {
  const url = new URL(req.url);
  const key = url.searchParams.get('key') || req.headers.get('X-Legal-Rag-Ingest-Key');
  const ingestKey = env.LEGAL_RAG_INGEST_KEY || env.SECRET;
  return key === ingestKey || key === env.SECRET;
}

function validatePayload(payload: IngestLegalRagBatchRequest): void {
  if (!payload?.document) {
    throw new Error('document is required');
  }
  for (const field of ['lawCode', 'title', 'versionDate', 'checksum'] as const) {
    if (!payload.document[field]?.trim()) {
      throw new Error(`document.${field} is required`);
    }
  }
  if (!Array.isArray(payload.chunks) || payload.chunks.length === 0) {
    throw new Error('chunks must be a non-empty array');
  }
  if (payload.chunks.length > MAX_BATCH_CHUNKS) {
    throw new Error(`chunks batch cannot exceed ${MAX_BATCH_CHUNKS}`);
  }

  for (const chunk of payload.chunks) {
    for (const field of ['lawCode', 'article', 'chunkText', 'vectorId', 'checksum'] as const) {
      if (!chunk[field]?.trim()) {
        throw new Error(`chunk.${field} is required`);
      }
    }
    if (chunk.lawCode !== payload.document.lawCode) {
      throw new Error('chunk lawCode must match document lawCode');
    }
  }
}

async function deletePreviousCorpusExcluding(
  lawCode: string,
  currentDocumentId: number,
  currentChunks: IngestLegalChunkRequest[],
  env: Env
): Promise<void> {
  const currentVectorIds = new Set(currentChunks.map(chunk => chunk.vectorId));

  const rows = await env.DB.prepare(
    'SELECT vector_id FROM legal_chunks WHERE law_code = ? AND document_id != ?'
  ).bind(lawCode, currentDocumentId).all();
  const previousVectorIds = ((rows.results || []) as Array<{ vector_id: string }>)
    .map(row => row.vector_id)
    .filter(Boolean);

  const staleVectorIds = previousVectorIds.filter(id => !currentVectorIds.has(id));
  for (let index = 0; index < staleVectorIds.length; index += 100) {
    const batch = staleVectorIds.slice(index, index + 100);
    if (batch.length > 0 && env.LEGAL_RAG_INDEX?.deleteByIds) {
      await env.LEGAL_RAG_INDEX.deleteByIds(batch);
    }
  }

  await env.DB.prepare('DELETE FROM legal_chunks WHERE law_code = ? AND document_id != ?')
    .bind(lawCode, currentDocumentId).run();
  await env.DB.prepare('DELETE FROM legal_documents WHERE law_code = ? AND id != ?')
    .bind(lawCode, currentDocumentId).run();
}

async function upsertDocument(document: IngestLegalDocumentRequest, env: Env): Promise<number> {
  await env.DB.prepare(`
    INSERT OR IGNORE INTO legal_documents
      (law_code, title, version_date, source_url, checksum)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    document.lawCode,
    document.title,
    document.versionDate,
    document.sourceUrl || null,
    document.checksum
  ).run();

  const row = await env.DB.prepare(`
    SELECT id FROM legal_documents
    WHERE law_code = ? AND version_date = ? AND checksum = ?
    LIMIT 1
  `).bind(document.lawCode, document.versionDate, document.checksum).first<{ id: number }>();

  if (!row?.id) {
    throw new Error('failed to resolve legal document id after insert');
  }
  return row.id;
}

async function upsertChunks(
  documentId: number,
  chunks: IngestLegalChunkRequest[],
  env: Env
): Promise<void> {
  const statements = chunks.map(chunk => env.DB.prepare(`
    INSERT INTO legal_chunks
      (document_id, law_code, article, subarticle, article_title, chunk_text, vector_id, source_url, checksum)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(vector_id) DO UPDATE SET
      document_id = excluded.document_id,
      law_code = excluded.law_code,
      article = excluded.article,
      subarticle = excluded.subarticle,
      article_title = excluded.article_title,
      chunk_text = excluded.chunk_text,
      source_url = excluded.source_url,
      checksum = excluded.checksum,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    documentId,
    chunk.lawCode,
    chunk.article,
    chunk.subarticle || null,
    chunk.articleTitle || '',
    chunk.chunkText,
    chunk.vectorId,
    chunk.sourceUrl || null,
    chunk.checksum
  ));

  await env.DB.batch(statements);
}

async function embedChunks(chunks: IngestLegalChunkRequest[], env: Env): Promise<number[][]> {
  const model = getEmbeddingModel(env);
  const texts = chunks.map(chunk => chunk.chunkText);
  const batchResponse = await env.AI.run(model, { text: texts });
  const batchEmbeddings = extractEmbeddings(batchResponse);

  if (batchEmbeddings.length === chunks.length) {
    return batchEmbeddings;
  }

  const embeddings: number[][] = [];
  for (const text of texts) {
    const response = await env.AI.run(model, { text });
    const [embedding] = extractEmbeddings(response);
    if (!embedding) {
      throw new Error('Workers AI embedding response did not include a vector');
    }
    embeddings.push(embedding);
  }
  return embeddings;
}

function extractEmbeddings(response: unknown): number[][] {
  const value = response as any;
  const candidates =
    value?.data ||
    value?.result?.data ||
    value?.embeddings ||
    value?.embedding ||
    [];

  if (Array.isArray(candidates) && candidates.every(item => typeof item === 'number')) {
    return [candidates];
  }

  if (!Array.isArray(candidates)) {
    return [];
  }

  return candidates
    .map(item => Array.isArray(item) ? item : item?.embedding)
    .filter((embedding): embedding is number[] =>
      Array.isArray(embedding) && embedding.every(value => typeof value === 'number')
    );
}

async function upsertVectors(
  chunks: IngestLegalChunkRequest[],
  embeddings: number[][],
  documentChecksum: string,
  env: Env
): Promise<void> {
  const vectors = chunks.map((chunk, index) => ({
    id: chunk.vectorId,
    values: embeddings[index],
    metadata: {
      law_code: chunk.lawCode,
      article: chunk.article,
      subarticle: chunk.subarticle || '',
      document_checksum: documentChecksum,
    },
  }));

  await env.LEGAL_RAG_INDEX.upsert(vectors);
}

function getEmbeddingModel(env: Env): string {
  const model = env.LEGAL_RAG_EMBEDDING_MODEL;
  return typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_EMBEDDING_MODEL;
}
