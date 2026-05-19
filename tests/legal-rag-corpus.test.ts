import { describe, expect, it } from "vitest";
import { prepareLegalDocument } from "../src/features/legal-rag/corpus";

describe("legal RAG corpus preparation", () => {
  it("creates deterministic vector IDs and checksums for УК РФ chunks", async () => {
    const input = {
      lawCode: "uk-rf",
      title: "Уголовный кодекс Российской Федерации",
      versionDate: "2026-05-19",
      sourceUrl: "https://publication.pravo.gov.ru/",
      articles: [{
        article: "119",
        articleTitle: "Угроза убийством или причинением тяжкого вреда здоровью",
        text: "Угроза убийством или причинением тяжкого вреда здоровью.\n\nТот же состав.",
      }],
    };

    const first = await prepareLegalDocument(input);
    const second = await prepareLegalDocument(input);

    expect(first).toEqual(second);
    expect(first.lawCode).toBe("uk-rf");
    expect(first.chunks).toHaveLength(2);
    expect(first.chunks[0].vectorId).toMatch(/^uk-rf:119:main:0:[a-f0-9]{12}$/);
    expect(first.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it("normalizes whitespace so repeated ingestion is idempotent", async () => {
    const first = await prepareLegalDocument({
      lawCode: " uk-rf ",
      title: "УК РФ",
      versionDate: "2026-05-19",
      articles: [{
        article: " 280 ",
        subarticle: " 1 ",
        articleTitle: "  Публичные призывы   ",
        text: "Публичные   призывы\n\nк осуществлению экстремистской деятельности.",
      }],
    });
    const second = await prepareLegalDocument({
      lawCode: "uk-rf",
      title: "УК РФ",
      versionDate: "2026-05-19",
      articles: [{
        article: "280",
        subarticle: "1",
        articleTitle: "Публичные призывы",
        text: "Публичные призывы\n\nк осуществлению экстремистской деятельности.",
      }],
    });

    expect(first).toEqual(second);
    expect(first.chunks[0].vectorId).toContain("uk-rf:280:1:0:");
  });
});
