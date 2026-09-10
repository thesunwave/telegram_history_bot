import { Env } from '../env';
import {
  AIProvider,
  CriminalAnalysisResult,
  CriminalContextAnalysisInput,
  LegalReferenceHit,
  ProfanityAnalysisResult,
  ProviderError,
  ProviderInfo,
  SummaryOptions,
  SummaryRequest,
} from './ai-provider';

interface VectorizeMatch {
  id: string;
  score?: number;
  metadata?: Record<string, unknown>;
  retrievalScores?: NonNullable<LegalReferenceHit['retrievalScores']>;
}

type RetrievalSource = keyof NonNullable<LegalReferenceHit['retrievalScores']>;

interface RetrievalQuery {
  text: string;
  source: RetrievalSource;
}

interface LegalChunkRow {
  vector_id: string;
  law_code: string;
  article: string;
  subarticle: string | null;
  article_title: string | null;
  chunk_text: string;
  source_url: string | null;
}

const DEFAULT_EMBEDDING_MODEL = '@cf/baai/bge-m3';
const DEFAULT_LAW_CODE = 'uk-rf';
const DEFAULT_TOP_K = 5;
const DEFAULT_MIN_SCORE = 0.55;
const DEFAULT_QUERY_VARIANTS = 2;

export class LegalRagProvider implements AIProvider {
  constructor(private env: Env) {}

  async summarize(_request: SummaryRequest, _options: SummaryOptions): Promise<string> {
    throw new ProviderError('Legal RAG provider does not support summaries', 'legal-rag');
  }

  async analyzeProfanity(_text: string): Promise<ProfanityAnalysisResult> {
    return { hasProfanity: false, words: [] };
  }

  async analyzeCriminalCode(text: string, env?: Env): Promise<CriminalAnalysisResult> {
    return this.findLegalReferences(text, undefined, env);
  }

  async analyzeCriminalCodeWithContext(
    input: CriminalContextAnalysisInput,
    env?: Env
  ): Promise<CriminalAnalysisResult> {
    const retrievalQueries = this.buildRetrievalQueries(input, env || this.env);
    return this.findLegalReferences(retrievalQueries, input, env);
  }

  validateConfig(): void {
    if (!this.env.AI?.run) {
      throw new Error('AI binding is required for legal-rag provider');
    }
    if (!this.env.LEGAL_RAG_INDEX?.query) {
      throw new Error('LEGAL_RAG_INDEX Vectorize binding is required for legal-rag provider');
    }
    if (!this.env.DB?.prepare) {
      throw new Error('DB binding is required for legal-rag provider');
    }
  }

  getProviderInfo(): ProviderInfo {
    return {
      name: 'legal-rag',
      model: this.getEmbeddingModel(),
    };
  }

  private async findLegalReferences(
    textOrQueries: string | RetrievalQuery[],
    input?: CriminalContextAnalysisInput,
    envOverride?: Env
  ): Promise<CriminalAnalysisResult> {
    const env = envOverride || this.env;
    this.validateConfig();

    const lawCode = this.getStringEnv('LEGAL_RAG_LAW_CODE', DEFAULT_LAW_CODE, env);
    const topK = this.getNumberEnv('LEGAL_RAG_TOP_K', DEFAULT_TOP_K, env);
    const minScore = this.getNumberEnv('LEGAL_RAG_MIN_SCORE', DEFAULT_MIN_SCORE, env);
    const matches = await this.retrieveMatches(textOrQueries, lawCode, topK, minScore, env);
    const references = await this.loadLegalReferences(matches, lawCode, env);

    return {
      hasViolations: false,
      decision: references.length > 0 ? 'uncertain' : 'no_violation',
      evidence: {
        subject: input?.targetUsername || 'unknown',
        object: 'unknown',
        intent: references.length > 0 ? 'legal reference lookup only' : 'no legal reference found',
        contextSummary: references.length > 0
          ? 'Relevant Criminal Code references were retrieved without legal qualification'
          : 'No relevant Criminal Code references passed the retrieval threshold',
        whyNotBenign: 'RAG mode is advisory and never classifies a Telegram message as a violation',
      },
      violations: [],
      totalSeverity: 0,
      riskLevel: 'low',
      analysisTimestamp: Date.now(),
      targetMessageId: input?.targetMessageId,
      contextWindow: input?.contextWindow,
      legalReferences: references,
    };
  }

  private buildRetrievalQueries(input: CriminalContextAnalysisInput, env: Env): RetrievalQuery[] {
    const maxVariants = Math.max(
      1,
      Math.min(this.getNumberEnv('LEGAL_RAG_QUERY_VARIANTS', DEFAULT_QUERY_VARIANTS, env), 3)
    );
    const semanticQuery = this.shouldUseSemanticQuery(input)
      ? input.semanticPrefilter?.searchQuery
      : '';
    const candidates: Array<RetrievalQuery | null> = [
      { text: input.targetText, source: 'target' },
      semanticQuery
        ? { text: semanticQuery, source: 'semantic' }
        : null,
      { text: this.buildCompactContextQuery(input), source: 'context' },
    ];
    return this.uniqueNonEmptyQueries(candidates).slice(0, maxVariants);
  }

  private shouldUseSemanticQuery(input: CriminalContextAnalysisInput): boolean {
    const frame = input.semanticPrefilter?.semanticFrame;
    if (!frame || frame.evidenceSpans.length === 0 || frame.harmKind !== 'none') {
      return true;
    }
    if (
      frame.speechAct === 'prediction' ||
      frame.speechAct === 'report' ||
      frame.speechAct === 'quote' ||
      frame.speechAct === 'hypothetical'
    ) {
      return false;
    }
    return !(
      frame.speechAct === 'taunt' &&
      frame.modality === 'predicted' &&
      (frame.targetKind === 'institution' || frame.targetKind === 'abstract')
    );
  }

  private buildCompactContextQuery(input: CriminalContextAnalysisInput): string {
    if (input.messages.length <= 1) {
      return '';
    }
    return input.messages
      .filter(message => message.isTarget || Math.abs(message.relativePosition) <= 1)
      .map(message => message.text)
      .join('\n')
      .slice(0, 1000);
  }

  private uniqueNonEmptyQueries(values: Array<RetrievalQuery | null>): RetrievalQuery[] {
    const result: RetrievalQuery[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      const normalized = value?.text.replace(/\s+/g, ' ').trim() || '';
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      result.push({ text: normalized, source: value!.source });
    }
    return result.length > 0 ? result : [{ text: '', source: 'target' }];
  }

  private async retrieveMatches(
    textOrQueries: string | RetrievalQuery[],
    lawCode: string,
    topK: number,
    minScore: number,
    env: Env
  ): Promise<VectorizeMatch[]> {
    const queries: RetrievalQuery[] = Array.isArray(textOrQueries)
      ? textOrQueries
      : [{ text: textOrQueries, source: 'target' }];
    const matchesById = new Map<string, VectorizeMatch>();

    for (const retrievalQuery of queries) {
      const vector = await this.embedQuery(retrievalQuery.text, env);
      const matches = await this.queryVectorIndex(vector, lawCode, topK, minScore, env);
      for (const match of matches) {
        const existing = matchesById.get(match.id);
        const score = match.score ?? 0;
        const previousSourceScore = existing?.retrievalScores?.[retrievalQuery.source] ?? 0;
        const retrievalScores = {
          ...(existing?.retrievalScores || {}),
          [retrievalQuery.source]: Math.max(previousSourceScore, score),
        };
        const winner = !existing || score > (existing.score ?? 0) ? match : existing;
        matchesById.set(match.id, {
          ...winner,
          score: Math.max(existing?.score ?? 0, score),
          retrievalScores,
        });
      }
    }

    return Array.from(matchesById.values())
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, topK);
  }

  private async embedQuery(text: string, env: Env): Promise<number[]> {
    const response = await env.AI.run(this.getEmbeddingModel(env), { text });
    const vector = this.extractEmbedding(response);
    if (!vector) {
      throw new ProviderError('Workers AI embedding response did not include a vector', 'legal-rag');
    }
    return vector;
  }

  private extractEmbedding(response: unknown): number[] | null {
    const value = response as any;
    const candidate =
      value?.data?.[0]?.embedding ||
      value?.data?.[0] ||
      value?.result?.data?.[0]?.embedding ||
      value?.result?.data?.[0] ||
      value?.embeddings?.[0] ||
      value?.embedding?.[0] ||
      value?.embedding;

    if (!Array.isArray(candidate) || !candidate.every(item => typeof item === 'number')) {
      return null;
    }
    return candidate;
  }

  private async queryVectorIndex(
    vector: number[],
    lawCode: string,
    topK: number,
    minScore: number,
    env: Env
  ): Promise<VectorizeMatch[]> {
    const result = await env.LEGAL_RAG_INDEX.query(vector, {
      topK,
      returnMetadata: true,
      filter: { law_code: lawCode },
    });
    const matches = Array.isArray(result?.matches) ? result.matches as VectorizeMatch[] : [];
    return matches.filter(match => (match.score ?? 0) >= minScore);
  }

  private async loadLegalReferences(
    matches: VectorizeMatch[],
    lawCode: string,
    env: Env
  ): Promise<LegalReferenceHit[]> {
    if (matches.length === 0) {
      return [];
    }

    const ids = matches.map(match => match.id);
    const placeholders = ids.map(() => '?').join(', ');
    const rows = await env.DB.prepare(`
      SELECT vector_id, law_code, article, subarticle, article_title, chunk_text, source_url
      FROM legal_chunks
      WHERE law_code = ? AND vector_id IN (${placeholders})
    `).bind(lawCode, ...ids).all();

    const rowsById = new Map<string, LegalChunkRow>(
      ((rows.results || []) as unknown as LegalChunkRow[]).map(row => [row.vector_id, row])
    );

    return matches
      .map(match => {
        const row = rowsById.get(match.id);
        if (!row) {
          return null;
        }
        const reference: LegalReferenceHit = {
          article: row.article,
          subarticle: row.subarticle,
          articleTitle: row.article_title || '',
          quote: row.chunk_text,
          sourceUrl: row.source_url,
          lawCode: row.law_code,
          score: match.score ?? 0,
          vectorId: row.vector_id,
        };
        if (match.retrievalScores) {
          reference.retrievalScores = match.retrievalScores;
        }
        return reference;
      })
      .filter((reference): reference is LegalReferenceHit => reference !== null);
  }

  private getEmbeddingModel(env: Env = this.env): string {
    return this.getStringEnv('LEGAL_RAG_EMBEDDING_MODEL', DEFAULT_EMBEDDING_MODEL, env);
  }

  private getStringEnv(name: string, fallback: string, env: Env): string {
    const value = (env as any)[name];
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
  }

  private getNumberEnv(name: string, fallback: number, env: Env): number {
    const value = (env as any)[name];
    const parsed = typeof value === 'number' ? value : Number(String(value ?? ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
