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
