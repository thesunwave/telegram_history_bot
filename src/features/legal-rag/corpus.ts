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
  const rawText = stripTrailingDocumentStructure(stripObsoleteLegalFragments(text)).trim();
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
    chunks.push(...splitLongParagraph(paragraph, safeMax));
  }
  return chunks;
}

function stripTrailingDocumentStructure(text: string): string {
  const lines = text.split('\n');
  while (lines.length > 0) {
    const line = lines[lines.length - 1].trim();
    if (!line || isDocumentStructureLine(line)) {
      lines.pop();
      continue;
    }
    break;
  }
  return lines.join('\n').trim();
}

function isDocumentStructureLine(line: string): boolean {
  return /^(?:Общая|Особенная)\s+часть(?:\s+Раздел\b.*)?$/i.test(line) ||
    /^Раздел\s+[IVXLCDM]+\./i.test(line) ||
    /^Глава\s+\d+(?:\.\d+)*\./i.test(line) ||
    /^Президент Российской Федерации$/i.test(line) ||
    /^[А-ЯЁ]\.?\s+[А-ЯЁ][а-яё-]+$/u.test(line) ||
    /^Москва,\s*Кремль$/i.test(line) ||
    /^\d{1,2}\s+[а-яё]+\s+\d{4}\s+года$/i.test(line) ||
    /^N\s*\d+(?:-[A-ZА-ЯЁ]+)?$/i.test(line) ||
    /^HYPERLINK\b/i.test(line) ||
    /^https?:\/\//i.test(line);
}

function splitLongParagraph(paragraph: string, maxChunkChars: number): string[] {
  const chunks: string[] = [];
  const minTailChars = Math.min(300, Math.max(1, Math.floor(maxChunkChars / 4)));
  let remaining = paragraph.trim();

  while (remaining.length > maxChunkChars) {
    let targetEnd = maxChunkChars;
    const tailLength = remaining.length - targetEnd;
    if (tailLength < minTailChars) {
      targetEnd = remaining.length - minTailChars;
    }

    const splitAt = findNaturalChunkBoundary(remaining, targetEnd, maxChunkChars);
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }
  return chunks;
}

function findNaturalChunkBoundary(text: string, targetEnd: number, maxChunkChars: number): number {
  const lookback = Math.min(240, Math.max(20, Math.floor(maxChunkChars / 5)));
  const windowStart = Math.max(1, targetEnd - lookback);
  const window = text.slice(windowStart, targetEnd);
  let bestBoundary = -1;

  for (const delimiter of ['. ', '; ', ': ']) {
    const index = window.lastIndexOf(delimiter);
    if (index >= 0) {
      bestBoundary = Math.max(bestBoundary, windowStart + index + 1);
    }
  }
  if (bestBoundary > 0) {
    return bestBoundary;
  }

  const whitespaceIndex = window.lastIndexOf(' ');
  return whitespaceIndex >= 0 ? windowStart + whitespaceIndex : targetEnd;
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
