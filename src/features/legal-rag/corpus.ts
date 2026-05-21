export interface LegalArticleInput {
  article: string;
  subarticle?: string | null;
  articleTitle?: string;
  text: string;
}

export interface LegalDocumentInput {
  lawCode: string;
  title: string;
  versionDate: string;
  sourceUrl?: string | null;
  articles: LegalArticleInput[];
}

export interface PreparedLegalChunk {
  lawCode: string;
  article: string;
  subarticle: string | null;
  articleTitle: string;
  chunkText: string;
  vectorId: string;
  sourceUrl: string | null;
  checksum: string;
}

export interface PreparedLegalDocument {
  lawCode: string;
  title: string;
  versionDate: string;
  sourceUrl: string | null;
  checksum: string;
  chunks: PreparedLegalChunk[];
}

const DEFAULT_MAX_CHUNK_CHARS = 1800;

export async function prepareLegalDocument(
  input: LegalDocumentInput,
  maxChunkChars: number = DEFAULT_MAX_CHUNK_CHARS
): Promise<PreparedLegalDocument> {
  const normalizedLawCode = normalizeRequired(input.lawCode, 'lawCode');
  const normalizedTitle = normalizeRequired(input.title, 'title');
  const normalizedVersionDate = normalizeRequired(input.versionDate, 'versionDate');
  const sourceUrl = input.sourceUrl || null;

  const chunks: PreparedLegalChunk[] = [];
  for (const article of input.articles) {
    const articleNumber = normalizeRequired(article.article, 'article');
    const subarticle = normalizeOptional(article.subarticle);
    const articleTitle = normalizeOptional(article.articleTitle) || '';
    if (isObsoleteLegalArticle(articleTitle, article.text)) {
      continue;
    }
    const paragraphs = splitIntoChunks(article.text, maxChunkChars);

    for (let index = 0; index < paragraphs.length; index += 1) {
      const chunkText = paragraphs[index];
      const checksum = await sha256Hex([
        normalizedLawCode,
        normalizedVersionDate,
        articleNumber,
        subarticle || '',
        articleTitle,
        chunkText,
      ].join('\n'));
      const vectorId = [
        normalizedLawCode,
        articleNumber,
        subarticle || 'main',
        index,
        checksum.slice(0, 12),
      ].join(':');

      chunks.push({
        lawCode: normalizedLawCode,
        article: articleNumber,
        subarticle,
        articleTitle,
        chunkText,
        vectorId,
        sourceUrl,
        checksum,
      });
    }
  }

  const checksum = await sha256Hex(JSON.stringify({
    lawCode: normalizedLawCode,
    title: normalizedTitle,
    versionDate: normalizedVersionDate,
    sourceUrl,
    chunkChecksums: chunks.map(chunk => chunk.checksum),
  }));

  return {
    lawCode: normalizedLawCode,
    title: normalizedTitle,
    versionDate: normalizedVersionDate,
    sourceUrl,
    checksum,
    chunks,
  };
}

function splitIntoChunks(text: string, maxChunkChars: number): string[] {
  const rawText = stripObsoleteLegalFragments(text)?.trim();
  if (!rawText) {
    throw new Error('text is required');
  }
  const safeMax = Number.isFinite(maxChunkChars) && maxChunkChars > 0
    ? Math.floor(maxChunkChars)
    : DEFAULT_MAX_CHUNK_CHARS;
  const paragraphs = rawText
    .split(/\n{2,}/)
    .map(part => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const chunks: string[] = [];
  for (const paragraph of paragraphs.length > 0 ? paragraphs : [rawText.replace(/\s+/g, ' ')]) {
    if (paragraph.length <= safeMax) {
      chunks.push(paragraph);
      continue;
    }
    for (let start = 0; start < paragraph.length; start += safeMax) {
      chunks.push(paragraph.slice(start, start + safeMax).trim());
    }
  }
  return chunks;
}

export function stripObsoleteLegalFragments(text: string): string {
  return text
    .replace(/\([^)]*утратил[аои]? силу[^)]*\)/gi, ' ')
    .replace(
      /(?:^|\s)\d+(?:\.\d+)*\.\s*Утратил[аои]? силу\.?(?:\s+[сc]\s+[^.]+?г\.)?(?:\s*-\s*Федеральный закон от .*?N\s*\d+(?:-\S+)?)?\s*/gim,
      ' '
    )
    .replace(
      /(?:Примечани[ея]\.?\s*)?Утратил[аои]? силу\.?(?:\s+[сc]\s+[^.]+?г\.)?(?:\s*-\s*Федеральный закон от .*?N\s*\d+(?:-\S+)?)?\s*/gi,
      ' '
    )
    .replace(/(?:Примечани[ея]\.?\s*)?Утратил[аои]? силу\.\s*/gi, ' ')
    .replace(/(?:^|\s)\d+(?:\.\d+)*\.\s*Утратил[аои]? силу\.\s*/gim, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function isObsoleteLegalArticle(articleTitle: string, text: string): boolean {
  return /утратил[аои]? силу/i.test(articleTitle) ||
    /^Статья\s+\d+(?:\.\d+)*\.\s*Утратил[аои]? силу/i.test(text.trim());
}

function normalizeRequired(value: string | null | undefined, field: string): string {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

function normalizeOptional(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}
