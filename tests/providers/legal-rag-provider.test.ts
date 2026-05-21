import { afterEach, describe, expect, it, vi } from "vitest";
import { LegalRagProvider } from "../../src/core/providers/legal-rag-provider";
import { createMockEnv } from "../test-utils";

describe("LegalRagProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns legal references without classifying violations", async () => {
    const env = createMockEnv({
      AI: {
        run: vi.fn().mockResolvedValue({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
      } as any,
      LEGAL_RAG_INDEX: {
        query: vi.fn().mockResolvedValue({
          matches: [{ id: "uk-rf:119:0", score: 0.82 }],
        }),
      } as any,
    });

    const all = vi.fn().mockResolvedValue({
      results: [{
        vector_id: "uk-rf:119:0",
        law_code: "uk-rf",
        article: "119",
        subarticle: null,
        article_title: "Угроза убийством или причинением тяжкого вреда здоровью",
        chunk_text: "Угроза убийством или причинением тяжкого вреда здоровью...",
        source_url: "https://publication.pravo.gov.ru/",
      }],
    });
    const bind = vi.fn().mockReturnValue({ all });
    env.DB.prepare = vi.fn().mockReturnValue({ bind }) as any;

    const provider = new LegalRagProvider(env);
    const result = await provider.analyzeCriminalCode("угроза убийством");

    expect(result.hasViolations).toBe(false);
    expect(result.decision).toBe("uncertain");
    expect(result.violations).toEqual([]);
    expect(result.legalReferences).toHaveLength(1);
    expect(result.legalReferences?.[0].article).toBe("119");
    expect(env.LEGAL_RAG_INDEX.query).toHaveBeenCalledWith(
      [0.1, 0.2, 0.3],
      expect.objectContaining({
        topK: 5,
        filter: { law_code: "uk-rf" },
      })
    );
  });

  it("does not call OpenRouter for private text", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const env = createMockEnv({
      AI: {
        run: vi.fn().mockResolvedValue({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
      } as any,
      LEGAL_RAG_INDEX: {
        query: vi.fn().mockResolvedValue({ matches: [] }),
      } as any,
    });

    const provider = new LegalRagProvider(env);
    await provider.analyzeCriminalCode("private telegram text");

    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("openrouter.ai"),
      expect.anything()
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts Workers AI embedding responses with raw vectors in data", async () => {
    const env = createMockEnv({
      AI: {
        run: vi.fn().mockResolvedValue({ data: [[0.4, 0.5, 0.6]] }),
      } as any,
      LEGAL_RAG_INDEX: {
        query: vi.fn().mockResolvedValue({ matches: [] }),
      } as any,
    });

    const provider = new LegalRagProvider(env);
    await provider.analyzeCriminalCode("угроза убийством");

    expect(env.LEGAL_RAG_INDEX.query).toHaveBeenCalledWith(
      [0.4, 0.5, 0.6],
      expect.anything()
    );
  });

  it("uses semantic searchQuery and target text for contextual retrieval when available", async () => {
    const run = vi.fn().mockResolvedValue({ data: [{ embedding: [0.7, 0.8, 0.9] }] });
    const env = createMockEnv({
      AI: { run } as any,
      LEGAL_RAG_INDEX: {
        query: vi.fn().mockResolvedValue({ matches: [] }),
      } as any,
    });

    const provider = new LegalRagProvider(env);
    await provider.analyzeCriminalCodeWithContext({
      targetText: "сырой сленговый текст",
      targetTimestamp: 1779200000,
      chatId: 123,
      contextWindow: { before: 0, after: 0, totalMessages: 1 },
      messages: [{
        username: "user",
        text: "сырой сленговый текст",
        ts: 1779200000,
        relativePosition: 0,
        isTarget: true,
      }],
      semanticPrefilter: {
        shouldAnalyze: true,
        reason: "threat",
        confidence: 0.9,
        explanation: "direct threat",
        searchQuery: "прямая угроза физической расправы адресату",
      },
    });

    expect(run).toHaveBeenCalledWith(
      expect.any(String),
      { text: "прямая угроза физической расправы адресату" }
    );
    expect(run).toHaveBeenCalledWith(
      expect.any(String),
      { text: "сырой сленговый текст" }
    );
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("deduplicates multi-query matches by best score", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ data: [{ embedding: [0.1, 0.2, 0.3] }] })
      .mockResolvedValueOnce({ data: [{ embedding: [0.4, 0.5, 0.6] }] });
    const query = vi.fn()
      .mockResolvedValueOnce({
        matches: [
          { id: "uk-rf:119:0", score: 0.7 },
          { id: "uk-rf:280:0", score: 0.62 },
        ],
      })
      .mockResolvedValueOnce({
        matches: [
          { id: "uk-rf:119:0", score: 0.84 },
          { id: "uk-rf:105:0", score: 0.6 },
        ],
      });
    const env = createMockEnv({
      AI: { run } as any,
      LEGAL_RAG_INDEX: { query } as any,
    });

    const all = vi.fn().mockResolvedValue({
      results: [
        {
          vector_id: "uk-rf:119:0",
          law_code: "uk-rf",
          article: "119",
          subarticle: null,
          article_title: "Угроза убийством или причинением тяжкого вреда здоровью",
          chunk_text: "Угроза убийством или причинением тяжкого вреда здоровью...",
          source_url: "https://publication.pravo.gov.ru/",
        },
        {
          vector_id: "uk-rf:280:0",
          law_code: "uk-rf",
          article: "280",
          subarticle: null,
          article_title: "Публичные призывы к осуществлению экстремистской деятельности",
          chunk_text: "Публичные призывы к осуществлению экстремистской деятельности...",
          source_url: "https://publication.pravo.gov.ru/",
        },
        {
          vector_id: "uk-rf:105:0",
          law_code: "uk-rf",
          article: "105",
          subarticle: null,
          article_title: "Убийство",
          chunk_text: "Убийство...",
          source_url: "https://publication.pravo.gov.ru/",
        },
      ],
    });
    env.DB.prepare = vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({ all }),
    }) as any;

    const provider = new LegalRagProvider(env);
    const result = await provider.analyzeCriminalCodeWithContext({
      targetText: "сырой сленговый текст",
      targetTimestamp: 1779200000,
      chatId: 123,
      contextWindow: { before: 0, after: 0, totalMessages: 1 },
      messages: [{
        username: "user",
        text: "сырой сленговый текст",
        ts: 1779200000,
        relativePosition: 0,
        isTarget: true,
      }],
      semanticPrefilter: {
        shouldAnalyze: true,
        reason: "threat",
        confidence: 0.9,
        explanation: "direct threat",
        searchQuery: "прямая угроза физической расправы адресату",
      },
    });

    expect(query).toHaveBeenCalledTimes(2);
    expect(result.legalReferences?.map(reference => reference.article)).toEqual(["119", "280", "105"]);
    expect(result.legalReferences?.[0].score).toBe(0.84);
  });

  it("filters out low-score matches", async () => {
    const env = createMockEnv({
      AI: {
        run: vi.fn().mockResolvedValue({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
      } as any,
      LEGAL_RAG_INDEX: {
        query: vi.fn().mockResolvedValue({
          matches: [{ id: "uk-rf:119:0", score: 0.4 }],
        }),
      } as any,
    });
    const all = vi.fn().mockResolvedValue({ results: [] });
    env.DB.prepare = vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({ all }) }) as any;

    const provider = new LegalRagProvider(env);
    const result = await provider.analyzeCriminalCode("угроза убийством");

    expect(result.hasViolations).toBe(false);
    expect(result.decision).toBe("no_violation");
    expect(result.legalReferences).toEqual([]);
    expect(env.DB.prepare).not.toHaveBeenCalled();
  });

  it("requires Cloudflare AI, Vectorize, and D1 bindings", () => {
    const env = createMockEnv({ LEGAL_RAG_INDEX: undefined });
    const provider = new LegalRagProvider(env);

    expect(() => provider.validateConfig()).toThrow(
      "LEGAL_RAG_INDEX Vectorize binding is required for legal-rag provider"
    );
  });
});
