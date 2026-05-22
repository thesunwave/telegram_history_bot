#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';

const DEFAULT_SOURCE = 'data/legal/uk-rf/source.doc';
const DEFAULT_ENDPOINT = 'https://telegram-history-bot.thesunwave.workers.dev';
const DEFAULT_LAW_CODE = 'uk-rf';
const DEFAULT_TITLE = 'Уголовный кодекс Российской Федерации';
const DEFAULT_MAX_CHUNK_CHARS = 1800;
const DEFAULT_BATCH_SIZE = 25;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const env = loadDotEnv(options.envFile || '.env');
  const sourcePath = resolve(options.source || DEFAULT_SOURCE);
  const endpoint = trimTrailingSlash(options.endpoint || DEFAULT_ENDPOINT);
  const key = options.key || process.env.LEGAL_RAG_INGEST_KEY || process.env.SECRET || env.SECRET;

  if (!key) {
    throw new Error('Missing ingest key. Set LEGAL_RAG_INGEST_KEY or SECRET.');
  }

  const text = extractText(sourcePath);
  const articles = parseArticles(text);
  if (articles.length === 0) {
    throw new Error('No legal articles were found in source text');
  }

  const sourceUrl = options.sourceUrl || findSourceUrl(text);
  const versionDate = options.versionDate || getDefaultVersionDate(sourcePath);
  const document = await prepareDocument({
    lawCode: options.lawCode || DEFAULT_LAW_CODE,
    title: options.title || DEFAULT_TITLE,
    versionDate,
    sourceUrl,
    articles,
  }, Number(options.maxChunkChars || DEFAULT_MAX_CHUNK_CHARS));

  const batchSize = Number(options.batchSize || DEFAULT_BATCH_SIZE);
  const batches = chunkArray(document.chunks, batchSize);

  console.log(`Prepared ${articles.length} articles, ${document.chunks.length} chunks`);
  console.log(`Source checksum: ${document.checksum}`);
  console.log(`Version: ${document.versionDate}`);

  if (options.dryRun) {
    return;
  }

  for (let index = 0; index < batches.length; index += 1) {
    const response = await fetch(`${endpoint}/api/legal-rag/ingest-batch?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document: {
          lawCode: document.lawCode,
          title: document.title,
          versionDate: document.versionDate,
          sourceUrl: document.sourceUrl,
          checksum: document.checksum,
        },
        chunks: batches[index],
        replaceExisting: index === 0 && options.replace !== 'false',
      }),
    });

    const responseText = await response.text();
    const result = parseJsonResponse(responseText);
    if (!response.ok || !result.ok) {
      throw new Error(
        `Batch ${index + 1}/${batches.length} failed: HTTP ${response.status} ${responseText.slice(0, 500)}`
      );
    }
    console.log(`Uploaded batch ${index + 1}/${batches.length}: ${batches[index].length} chunks`);
  }
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      continue;
    }
    if (!arg.includes('=') && (args[index + 1] === undefined || args[index + 1].startsWith('--'))) {
      options[toCamelCase(arg.slice(2))] = true;
      continue;
    }
    const [rawKey, inlineValue] = arg.slice(2).split('=');
    options[toCamelCase(rawKey)] = inlineValue ?? args[index + 1];
    if (inlineValue === undefined) {
      index += 1;
    }
  }
  return options;
}

function loadDotEnv(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#') && line.includes('='))
        .map(line => {
          const separator = line.indexOf('=');
          return [line.slice(0, separator), line.slice(separator + 1).replace(/^['"]|['"]$/g, '')];
        })
    );
  } catch {
    return {};
  }
}

function extractText(sourcePath) {
  const extension = extname(sourcePath).toLowerCase();
  if (extension === '.txt') {
    return readFileSync(sourcePath, 'utf8');
  }
  if (extension === '.doc' || extension === '.docx' || extension === '.rtf') {
    return execFileSync('textutil', ['-convert', 'txt', '-stdout', sourcePath], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
  }
  throw new Error(`Unsupported source extension: ${extension}`);
}

function parseArticles(text) {
  const normalized = text
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n');

  const articleRegex = /^Статья\s+(\d+(?:\.\d+)*)\.\s+(.+)$/gm;
  const matches = [...normalized.matchAll(articleRegex)];

  return matches.map((match, index) => {
    const start = match.index;
    const end = index + 1 < matches.length ? matches[index + 1].index : normalized.length;
    const articleText = normalized.slice(start, end).trim();
    const articleTitle = match[2].replace(/\s+/g, ' ').trim();
    return {
      article: match[1],
      subarticle: null,
      articleTitle,
      text: articleText,
    };
  }).filter(article => !isObsoleteLegalArticle(article.articleTitle, article.text));
}

async function prepareDocument(input, maxChunkChars) {
  const chunks = [];
  for (const article of input.articles) {
    const sections = splitArticleIntoSections(article);
    for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
      const section = sections[sectionIndex];
      const subarticle = section.section || article.subarticle;
      const articleChunks = splitIntoChunks(section.text, maxChunkChars);
      for (let index = 0; index < articleChunks.length; index += 1) {
        const chunkText = articleChunks[index];
        const vectorIdParts = [
          input.lawCode,
          article.article,
          section.section || 'main',
          index,
        ];
        const checksum = sha256([
          input.lawCode,
          input.versionDate,
          article.article,
          subarticle || '',
          article.articleTitle,
          chunkText,
        ].join('\n'));
        chunks.push({
          lawCode: input.lawCode,
          article: article.article,
          subarticle,
          articleTitle: article.articleTitle,
          chunkText,
          vectorId: [...vectorIdParts, checksum.slice(0, 12)].join(':'),
          sourceUrl: input.sourceUrl,
          checksum,
        });
      }
    }
  }

  const checksum = sha256(JSON.stringify({
    lawCode: input.lawCode,
    title: input.title,
    versionDate: input.versionDate,
    sourceUrl: input.sourceUrl,
    chunkChecksums: chunks.map(chunk => chunk.checksum),
  }));

  return {
    lawCode: input.lawCode,
    title: input.title,
    versionDate: input.versionDate,
    sourceUrl: input.sourceUrl,
    checksum,
    chunks,
  };
}

function splitArticleIntoSections(article) {
  const cleanedText = stripObsoleteLegalFragments(article.text);
  const partRegex = /(?:^|\n)\s*(\d+(?:\.\d+)*)\.\s+/g;
  const matches = [...cleanedText.matchAll(partRegex)]
    .filter(match => match.index !== undefined && match.index > 0);

  if (matches.length === 0) {
    return [{ section: null, text: cleanedText }];
  }

  const header = cleanedText.slice(0, matches[0].index).trim();
  return matches.map((match, index) => {
    const start = match.index || 0;
    const end = index + 1 < matches.length ? matches[index + 1].index : cleanedText.length;
    const partText = cleanedText.slice(start, end).trim();
    return {
      section: match[1],
      text: [header, partText].filter(Boolean).join('\n'),
    };
  });
}

function splitIntoChunks(text, maxChunkChars) {
  const cleanedText = stripObsoleteLegalFragments(text);
  const paragraphs = cleanedText
    .split(/\n{2,}/)
    .map(part => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const chunks = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxChunkChars) {
      chunks.push(paragraph);
      continue;
    }
    for (let start = 0; start < paragraph.length; start += maxChunkChars) {
      chunks.push(paragraph.slice(start, start + maxChunkChars).trim());
    }
  }
  return chunks;
}

function stripObsoleteLegalFragments(text) {
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

function isObsoleteLegalArticle(articleTitle, text) {
  return /утратил[аои]? силу/i.test(articleTitle) ||
    /^Статья\s+\d+(?:\.\d+)*\.\s*Утратил[аои]? силу/i.test(text.trim());
}

function findSourceUrl(text) {
  return text.match(/https?:\/\/[^\s"]+/)?.[0] || null;
}

function getDefaultVersionDate(sourcePath) {
  return statSync(sourcePath).mtime.toISOString().slice(0, 10);
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function parseJsonResponse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
