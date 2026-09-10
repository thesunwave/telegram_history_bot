import { describe, expect, it } from "vitest";
import {
  isObsoleteLegalArticle,
  prepareLegalDocument,
  stripObsoleteLegalFragments,
} from "../src/features/legal-rag/corpus";

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

  it("rebalances a tiny trailing fragment and keeps word boundaries", async () => {
    const text = Array.from({ length: 13 }, (_, index) => `условие${index}`).join(" ");
    const document = await prepareLegalDocument({
      lawCode: "uk-rf",
      title: "УК РФ",
      versionDate: "2026-09-10",
      articles: [{
        article: "322.3",
        articleTitle: "Фиктивная постановка на учет",
        text,
      }],
    }, 100);

    expect(document.chunks).toHaveLength(2);
    expect(document.chunks.every(chunk => chunk.chunkText.length <= 100)).toBe(true);
    expect(document.chunks[1].chunkText.length).toBeGreaterThanOrEqual(25);
    expect(document.chunks.map(chunk => chunk.chunkText).join(" ")).toBe(text);
  });

  it("drops trailing document structure that belongs after the article", async () => {
    const document = await prepareLegalDocument({
      lawCode: "uk-rf",
      title: "УК РФ",
      versionDate: "2026-09-10",
      articles: [{
        article: "23",
        articleTitle: "Ответственность в состоянии опьянения",
        text: [
          "Статья 23. Ответственность в состоянии опьянения",
          "Лицо подлежит уголовной ответственности.",
          "",
          "Раздел II. Преступление",
          "",
          "Глава 5. Вина",
        ].join("\n"),
      }],
    });

    const text = document.chunks.map(chunk => chunk.chunkText).join(" ");
    expect(text).toContain("Лицо подлежит уголовной ответственности.");
    expect(text).not.toContain("Раздел II");
    expect(text).not.toContain("Глава 5");
  });

  it("removes obsolete legal fragments before chunking", async () => {
    const document = await prepareLegalDocument({
      lawCode: "uk-rf",
      title: "УК РФ",
      versionDate: "2026-05-20",
      articles: [{
        article: "205.2",
        articleTitle: "Публичные призывы",
        text: [
          "Статья 205.2. Публичные призывы",
          "",
          "Примечание. Утратило силу. Примечания. 1. Действующее определение.",
          "2. Утратил силу. 3. Еще действующая норма.",
        ].join("\n"),
      }],
    });

    const text = document.chunks.map(chunk => chunk.chunkText).join(" ");
    expect(text).not.toMatch(/утратил[аои]? силу/i);
    expect(text).toContain("Примечания. 1. Действующее определение.");
    expect(text).toContain("3. Еще действующая норма.");
  });

  it("strips obsolete text helper without removing active notes", () => {
    expect(stripObsoleteLegalFragments(
      "Примечание. Утратило силу. Примечания. 1. Активное определение."
    )).toBe("Примечания. 1. Активное определение.");
  });

  it("strips obsolete numbered clauses with effective dates", () => {
    expect(stripObsoleteLegalFragments(
      "1. Рабочая часть. 1.1. Утратила силу с 12 апреля 2020 г. - Федеральный закон от 1 апреля 2020 г. N 73-ФЗ 2. Следующая часть."
    )).toBe("1. Рабочая часть. 2. Следующая часть.");
  });

  it("detects fully obsolete articles", () => {
    expect(isObsoleteLegalArticle(
      "Утратила силу c 21 октября 2018 г. - Федеральный закон от 23 апреля 2018 г. N 114-ФЗ.",
      "Статья 269. Утратила силу c 21 октября 2018 г. - Федеральный закон от 23 апреля 2018 г. N 114-ФЗ."
    )).toBe(true);
  });
});
