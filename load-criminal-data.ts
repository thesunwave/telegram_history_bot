/**
 * Временный endpoint для загрузки данных УК РФ
 * Добавьте этот код в src/index.ts для тестирования
 */

import { loadCriminalCodeData, handleDataLoad, handleSemanticSearch } from './.kiro/specs/criminal-code-analyzer/data-loader-script';

// Добавьте в основной fetch handler:
export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const url = new URL(request.url);
    
    // Endpoint для загрузки данных УК РФ
    if (url.pathname === '/load-criminal-code' && request.method === 'POST') {
      return await handleDataLoad(request, env);
    }
    
    // Endpoint для семантического поиска
    if (url.pathname === '/search-criminal-code' && request.method === 'POST') {
      return await handleSemanticSearch(request, env);
    }
    
    // Endpoint для проверки загруженных данных
    if (url.pathname === '/check-criminal-data' && request.method === 'GET') {
      try {
        const result = await env.DB.prepare(`
          SELECT COUNT(*) as count FROM criminal_articles
        `).first();
        
        const versions = await env.DB.prepare(`
          SELECT * FROM criminal_code_versions ORDER BY updated_at DESC LIMIT 1
        `).first();
        
        // Проверяем количество векторов в Vectorize
        const vectorStats = await env.VECTORIZE.describe();
        
        return new Response(JSON.stringify({
          articlesCount: result.count,
          vectorsCount: vectorStats.vectorsCount,
          latestVersion: versions,
          status: 'ready'
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          error: `Database error: ${error}`,
          status: 'error'
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    // Остальная логика вашего бота...
    return new Response('Not Found', { status: 404 });
  }
};