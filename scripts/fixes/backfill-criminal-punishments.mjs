#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const DEFAULT_DATABASE = 'summaries';
const DEFAULT_LAW_CODE = 'uk-rf';

const options = parseArgs(process.argv.slice(2));
const database = options.database || DEFAULT_DATABASE;
const lawCode = options.lawCode || DEFAULT_LAW_CODE;
const remote = options.local ? [] : ['--remote'];

const sql = `
UPDATE criminal_violations
SET
  article_title = COALESCE((
    SELECT lc.article_title
    FROM legal_chunks lc
    WHERE lc.law_code = '${escapeSql(lawCode)}'
      AND lc.article = criminal_violations.article
      AND (
        criminal_violations.subarticle IS NULL
        OR lc.subarticle IS NULL
        OR lc.subarticle = criminal_violations.subarticle
      )
    ORDER BY
      CASE WHEN lc.chunk_text LIKE '%наказыва%' THEN 0 ELSE 1 END,
      lc.id ASC
    LIMIT 1
  ), article_title),
  punishment = COALESCE((
    SELECT lc.chunk_text
    FROM legal_chunks lc
    WHERE lc.law_code = '${escapeSql(lawCode)}'
      AND lc.article = criminal_violations.article
      AND lc.chunk_text LIKE '%наказыва%'
      AND (
        criminal_violations.subarticle IS NULL
        OR lc.subarticle IS NULL
        OR lc.subarticle = criminal_violations.subarticle
      )
    ORDER BY lc.id ASC
    LIMIT 1
  ), punishment)
WHERE EXISTS (
  SELECT 1
  FROM legal_chunks lc
  WHERE lc.law_code = '${escapeSql(lawCode)}'
    AND lc.article = criminal_violations.article
    AND lc.chunk_text LIKE '%наказыва%'
)
AND (
  punishment IS NULL
  OR punishment NOT LIKE '%лишени%свобод%'
  OR article_title IS NULL
  OR article_title = ''
);
`.trim();

if (options.dryRun) {
  console.log(sql);
  process.exit(0);
}

execFileSync('npx', [
  'wrangler',
  'd1',
  'execute',
  database,
  ...remote,
  '--command',
  sql,
], {
  stdio: 'inherit',
});

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      continue;
    }
    const [key, inlineValue] = arg.slice(2).split('=');
    if (inlineValue !== undefined) {
      result[toCamelCase(key)] = inlineValue;
      continue;
    }
    const next = args[index + 1];
    if (!next || next.startsWith('--')) {
      result[toCamelCase(key)] = true;
      continue;
    }
    result[toCamelCase(key)] = next;
    index += 1;
  }
  return result;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function escapeSql(value) {
  return String(value).replace(/'/g, "''");
}
