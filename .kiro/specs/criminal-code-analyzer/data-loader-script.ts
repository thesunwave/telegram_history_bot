/**
 * Скрипт для загрузки данных УК РФ в Cloudflare D1 + Vectorize
 * Запуск: npx wrangler dev --local и вызов через fetch
 */

import { D1Database } from "@miniflare/d1";

import { D1Database } from "@miniflare/d1";

import { D1Database } from "@miniflare/d1";

import { D1Database } from "@miniflare/d1";

interface CriminalCodeData {
  metadata: {
    version: string;
    source: string;
    scrapedAt: string;
    totalArticles: number;
    description: string;
  };
  articles: Article[];
  categories: Record<string, Category>;
  severityLevels: Record<string, SeverityLevel>;
}

interface Article {
  number: string;
  title: string;
  content: string;
  parts: ArticlePart[];
  category: string;
  subcategory: string;
  keywords: string[];
  relatedArticles: string[];
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

interface ArticlePart {
  partNumber: string;
  content: string;
  penalties: Penalty[];
}

interface Penalty {
  type: string;
  minTerm?: string;
  maxTerm?: string;
  description: string;
  optional?: boolean;
  note?: string;
}

interface Category {
  name: string;
  description: string;
  articles: string[];
}

interface SeverityLevel {
  description: string;
  maxPenalty: string;
}

/**
 * Основная функция загрузки данных
 */
export async function loadCriminalCodeData(
  criminalCodeData: CriminalCodeData,
  env: { DB: D1Database; VECTORIZE: VectorizeIndex; AI: Ai }
): Promise<{ success: boolean; loaded: number; errors: string[] }> {
  const errors: string[] = [];
  let loaded = 0;

  try {
    // 1. Сохраняем версию УК РФ
    await env.DB.prepare(`
      INSERT OR REPLACE INTO criminal_code_versions 
      (version, source, updated_at, articles_count, checksum)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      criminalCodeData.metadata.version,
      criminalCodeData.metadata.source,
      new Date().toISOString(),
      criminalCodeData.articles.length,
      await generateChecksum(criminalCodeData)
    ).run();

    // 2. Сохраняем категории
    for (const [categoryId, category] of Object.entries(criminalCodeData.categories)) {
      await env.DB.prepare(`
        INSERT OR REPLACE INTO crime_categories (id, name, description, articles)
        VALUES (?, ?, ?, ?)
      `).bind(
        categoryId,
        category.name,
        category.description,
        JSON.stringify(category.articles)
      ).run();
    }

    // 3. Сохраняем конфигурацию уровней серьезности
    for (const [level, config] of Object.entries(criminalCodeData.severityLevels)) {
      await env.DB.prepare(`
        INSERT OR REPLACE INTO criminal_system_config (key, value)
        VALUES (?, ?)
      `).bind(
        `severity_level_${level.toLowerCase()}`,
        JSON.stringify(config)
      ).run();
    }

    // 4. Загружаем каждую статью
    for (const article of criminalCodeData.articles) {
      try {
        // Сохраняем статью в D1
        await env.DB.prepare(`
          INSERT OR REPLACE INTO criminal_articles 
          (number, title, content, category, subcategory, severity, keywords, related_articles)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          article.number,
          article.title,
          article.content,
          article.category,
          article.subcategory || null,
          article.severity,
          JSON.stringify(article.keywords),
          JSON.stringify(article.relatedArticles)
        ).run();

        // Генерируем эмбеддинг для семантического поиска
        const embedding = await generateEmbedding(article, env.AI);

        // Сохраняем эмбеддинг в Vectorize
        await env.VECTORIZE.upsert([
          {
            id: article.number,
            values: embedding,
            metadata: {
              title: article.title,
              category: article.category,
              severity: article.severity,
              keywords: article.keywords.join(', ')
            }
          }
        ]);

        // Сохраняем части статей с санкциями
        for (const part of article.parts) {
          await env.DB.prepare(`
            INSERT OR REPLACE INTO article_parts 
            (article_number, part_number, content, penalties)
            VALUES (?, ?, ?, ?)
          `).bind(
            article.number,
            part.partNumber,
            part.content,
            JSON.stringify(part.penalties)
          ).run();
        }

        loaded++;
      } catch (error) {
        errors.push(`Ошибка загрузки статьи ${article.number}: ${error}`);
      }
    }

    // 5. Сохраняем метаданные
    await env.DB.prepare(`
      INSERT OR REPLACE INTO criminal_system_config (key, value)
      VALUES (?, ?)
    `).bind(
      'metadata',
      JSON.stringify(criminalCodeData.metadata)
    ).run();

    return { success: errors.length === 0, loaded, errors };

  } catch (error) {
    errors.push(`Критическая ошибка: ${error}`);
    return { success: false, loaded, errors };
  }
}

/**
 * Генерация эмбеддинга для статьи используя Cloudflare AI
 */
async function generateEmbedding(article: Article, ai: Ai): Promise<number[]> {
  // Подготавливаем текст для эмбеддинга
  const text = `${article.title}. ${article.content}. Ключевые слова: ${article.keywords.join(', ')}`;
  
  try {
    // Используем Cloudflare AI для генерации эмбеддингов
    const response = await ai.run('@cf/baai/bge-base-en-v1.5', {
      text: [text]
    });
    
    // Возвращаем первый (и единственный) эмбеддинг
    return response.data[0];
  } catch (error) {
    console.error('Error generating embedding:', error);
    
    // Fallback: простой хеш-эмбеддинг
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    const array = new Uint8Array(hash);
    return Array.from(array.slice(0, 384)).map(x => (x - 128) / 128);
  }
}

/**
 * Семантический поиск статей через Vectorize
 */
export async function findSimilarArticles(
  queryText: string,
  limit: number = 5,
  env: { VECTORIZE: VectorizeIndex; AI: Ai; DB: D1Database }
): Promise<Array<{ article: Article; similarity: number }>> {
  try {
    // Генерируем эмбеддинг для запроса
    const queryEmbedding = await generateQueryEmbedding(queryText, env.AI);
    
    // Ищем похожие статьи в Vectorize
    const results = await env.VECTORIZE.query(queryEmbedding, {
      topK: limit,
      returnMetadata: true
    });

    // Получаем полную информацию о статьях из D1
    const articles: Array<{ article: Article; similarity: number }> = [];
    
    for (const match of results.matches) {
      const article = await getArticleByNumber(match.id, env);
      if (article) {
        articles.push({
          article,
          similarity: match.score
        });
      }
    }

    return articles;
  } catch (error) {
    console.error('Error in semantic search:', error);
    return [];
  }
}

/**
 * Генерация эмбеддинга для поискового запроса
 */
async function generateQueryEmbedding(queryText: string, ai: Ai): Promise<number[]> {
  try {
    const response = await ai.run('@cf/baai/bge-base-en-v1.5', {
      text: [queryText]
    });
    return response.data[0];
  } catch (error) {
    console.error('Error generating query embedding:', error);
    // Fallback
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(queryText));
    const array = new Uint8Array(hash);
    return Array.from(array.slice(0, 384)).map(x => (x - 128) / 128);
  }
}

/**
 * Поиск статей по ключевым словам (используя FTS)
 */
export async function searchArticlesByKeywords(
  query: string,
  env: { DB: D1Database }
): Promise<Article[]> {
  const result = await env.DB.prepare(`
    SELECT ca.* FROM criminal_articles ca
    JOIN criminal_articles_fts fts ON ca.rowid = fts.rowid
    WHERE criminal_articles_fts MATCH ?
    ORDER BY rank
    LIMIT 10
  `).bind(query).all();

  return result.results.map(row => ({
    number: row.number as string,
    title: row.title as string,
    content: row.content as string,
    category: row.category as string,
    subcategory: row.subcategory as string,
    severity: row.severity as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
    keywords: JSON.parse(row.keywords as string),
    relatedArticles: JSON.parse(row.related_articles as string),
    parts: [] // Загружаем отдельно при необходимости
  }));
}

/**
 * Получение статьи по номеру
 */
export async function getArticleByNumber(
  articleNumber: string,
  env: { DB: D1Database }
): Promise<Article | null> {
  const articleResult = await env.DB.prepare(`
    SELECT * FROM criminal_articles WHERE number = ?
  `).bind(articleNumber).first();

  if (!articleResult) return null;

  const partsResult = await env.DB.prepare(`
    SELECT * FROM article_parts WHERE article_number = ? ORDER BY part_number
  `).bind(articleNumber).all();

  return {
    number: articleResult.number as string,
    title: articleResult.title as string,
    content: articleResult.content as string,
    category: articleResult.category as string,
    subcategory: articleResult.subcategory as string,
    severity: articleResult.severity as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
    keywords: JSON.parse(articleResult.keywords as string),
    relatedArticles: JSON.parse(articleResult.related_articles as string),
    parts: partsResult.results.map(part => ({
      partNumber: part.part_number as string,
      content: part.content as string,
      penalties: JSON.parse(part.penalties as string)
    }))
  };
}

/**
 * Генерация чексуммы для проверки целостности данных
 */
async function generateChecksum(data: CriminalCodeData): Promise<string> {
  const dataString = JSON.stringify(data, null, 0);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dataString));
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Cloudflare Worker endpoint для загрузки данных
 */
export async function handleDataLoad(request: Request, env: any): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const criminalCodeData: CriminalCodeData = await request.json();
    
    // Валидация данных
    if (!criminalCodeData.articles || !Array.isArray(criminalCodeData.articles)) {
      return new Response('Invalid data format', { status: 400 });
    }

    const result = await loadCriminalCodeData(criminalCodeData, env);
    
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ 
      success: false, 
      error: `Ошибка обработки: ${error}` 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Тестовый endpoint для проверки семантического поиска
 */
export async function handleSemanticSearch(request: Request, env: any): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { query, limit = 5 } = await request.json();
    
    if (!query) {
      return new Response('Query is required', { status: 400 });
    }

    const results = await findSimilarArticles(query, limit, env);
    
    return new Response(JSON.stringify({
      query,
      results: results.map(r => ({
        article: {
          number: r.article.number,
          title: r.article.title,
          category: r.article.category,
          severity: r.article.severity
        },
        similarity: r.similarity
      }))
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ 
      error: `Search error: ${error}` 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}