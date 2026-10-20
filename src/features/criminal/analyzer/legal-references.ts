// Pure helpers for the final judge: legal reference selection, grounding and
// normalization of judged violations. Moved from CriminalCodeAnalyzerDO.

import type {
  CriminalAnalysisResult,
  CriminalContextAnalysisInput,
  CriminalViolation,
  LegalReferenceHit,
} from '../../../core/env';
import type { CriminalFinalJudgeResult, CriminalFinalJudgeViolation } from './types';

export function buildAllowedReferenceMap(references: LegalReferenceHit[]): Map<string, LegalReferenceHit> {
  const result = new Map<string, LegalReferenceHit>();
  const referencesByArticle = new Map<string, LegalReferenceHit[]>();

  for (const reference of references) {
    result.set(`${reference.article}:${reference.subarticle || ''}`, reference);
    const articleReferences = referencesByArticle.get(reference.article) || [];
    articleReferences.push(reference);
    referencesByArticle.set(reference.article, articleReferences);
  }

  for (const [article, articleReferences] of referencesByArticle) {
    if (articleReferences.length === 1) {
      result.set(`${article}:`, articleReferences[0]);
    }
  }

  return result;
}

export function buildStoredPunishment(reference: LegalReferenceHit): string {
  const referenceText = cleanLegalReferenceText(reference.quote);
  const punishmentText = extractPunishmentText(referenceText);
  return (punishmentText || referenceText).slice(0, 1000);
}

export function selectPunishmentReference(
  references: LegalReferenceHit[],
  qualificationReference: LegalReferenceHit
): LegalReferenceHit | null {
  const matching = references.filter(reference =>
    reference.article === qualificationReference.article &&
    (reference.subarticle || null) === (qualificationReference.subarticle || null) &&
    hasPunishmentSignal(reference.quote || '')
  );
  return matching.sort((a, b) => (b.score || 0) - (a.score || 0))[0] || null;
}

export function extractPunishmentText(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }

  const startIndex = normalized.search(/наказыва(?:ет|ю)тся/i);
  if (startIndex < 0) {
    return '';
  }

  const tail = normalized.slice(startIndex);
  const nextPartIndex = tail.search(/\s\d+(?:\.\d+)*\.\s+[А-ЯЁA-Z]/);
  const clause = nextPartIndex > 0 ? tail.slice(0, nextPartIndex) : tail;
  return clause
    .replace(/\((?:в\s+ред\.|см\.).*$/i, '')
    .trim();
}

export function cleanJudgeText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, 1000) : fallback;
}

export function selectFinalJudgeReferences(
  references: LegalReferenceHit[],
  maxReferences: number
): LegalReferenceHit[] {
  const bestByArticle = new Map<string, LegalReferenceHit>();
  for (const reference of references) {
    const key = `${reference.article}:${reference.subarticle || ''}`;
    const existing = bestByArticle.get(key);
    if (!existing || isBetterQualificationReference(reference, existing)) {
      bestByArticle.set(key, reference);
    }
  }

  const ranked = Array.from(bestByArticle.values())
    .sort((a, b) => (b.score || 0) - (a.score || 0));
  const firstPerArticle: LegalReferenceHit[] = [];
  const extraParts: LegalReferenceHit[] = [];
  const seenArticles = new Set<string>();

  for (const reference of ranked) {
    if (seenArticles.has(reference.article)) {
      extraParts.push(reference);
      continue;
    }
    seenArticles.add(reference.article);
    firstPerArticle.push(reference);
  }

  return [...firstPerArticle, ...extraParts].slice(0, maxReferences);
}

export function isBetterQualificationReference(
  candidate: LegalReferenceHit,
  existing: LegalReferenceHit
): boolean {
  const candidateIndex = getLegalChunkIndex(candidate);
  const existingIndex = getLegalChunkIndex(existing);
  if (candidateIndex !== null && existingIndex !== null && candidateIndex !== existingIndex) {
    return candidateIndex < existingIndex;
  }
  return (candidate.score || 0) > (existing.score || 0);
}

export function getLegalChunkIndex(reference: LegalReferenceHit): number | null {
  const parts = reference.vectorId?.split(':') || [];
  for (const rawIndex of [parts[parts.length - 2], parts[parts.length - 1]]) {
    const index = Number(rawIndex);
    if (Number.isInteger(index) && index >= 0) {
      return index;
    }
  }
  return null;
}

export function isQuoteGroundedInTarget(quote: string, targetText: string): boolean {
  const normalizedQuote = normalizeForGrounding(quote);
  const normalizedTarget = normalizeForGrounding(targetText);
  if (!normalizedQuote || !normalizedTarget) {
    return false;
  }
  return normalizedTarget.includes(normalizedQuote) || normalizedQuote.includes(normalizedTarget);
}

export function isUsefulFinalJudgeReference(reference: LegalReferenceHit): boolean {
  const text = cleanLegalReferenceText(reference.quote);
  if (!reference.articleTitle?.trim()) {
    return false;
  }
  if (/утратил[аои]? силу/i.test(reference.quote || '')) {
    return false;
  }
  if (!hasQualificationContent(text)) {
    return false;
  }
  const titleAndText = `${reference.articleTitle} ${text}`;
  if (text.length < 80) {
    return /^Статья\s+\d/i.test(text) && hasLegalDispositionSignal(titleAndText);
  }
  return hasLegalDispositionSignal(titleAndText);
}

export function hasQualificationContent(text: string): boolean {
  const normalized = cleanLegalReferenceText(text);
  if (!normalized) {
    return false;
  }
  const punishmentIndex = normalized.search(
    /наказыва(?:ет|ю)тся|лишением свободы|штрафом|обязательными работами|принудительными работами|арестом/i
  );
  const qualificationText = punishmentIndex >= 0
    ? normalized.slice(0, punishmentIndex).trim()
    : normalized;
  return qualificationText.length >= 40;
}

export function hasLegalDispositionSignal(text: string): boolean {
  return /Статья\s+\d|наказыва(?:ет|ю)тся|угроза|призывы|склонение|вовлечение|причинение|насильственн|полов/i
    .test(text);
}

export function normalizeForGrounding(value: string): string {
  return value
    .replace(/[«»"“”]/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function hasPunishmentSignal(text: string): boolean {
  return /наказыва(?:ет|ю)тся|лишением свободы|штрафом|обязательными работами|принудительными работами|арестом/i
    .test(text);
}

export function cleanLegalReferenceText(value: string): string {
  return value
    .replace(/\([^)]*утратил[аои]? силу[^)]*\)/gi, ' ')
    .replace(/(?:Примечани[ея]\.?\s*)?Утратил[аои]? силу\.\s*/gi, ' ')
    .replace(/(?:^|\s)\d+(?:\.\d+)*\.\s*Утратил[аои]? силу\.\s*/gim, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

export function calculateRiskLevel(totalSeverity: number): 'low' | 'medium' | 'high' | 'critical' {
  if (totalSeverity >= 16) {
    return 'critical';
  }
  if (totalSeverity >= 8) {
    return 'high';
  }
  if (totalSeverity >= 4) {
    return 'medium';
  }
  return 'low';
}

export function evaluateFinalJudgeMeaning(
  meaning: CriminalFinalJudgeResult['meaning'],
  input: CriminalContextAnalysisInput
): 'criminal' | 'benign' | 'unclear' {
  if (!meaning || typeof meaning !== 'object') {
    return 'unclear';
  }
  const evidence = cleanJudgeText(meaning.evidence, '');
  if (!evidence || !isQuoteGroundedInTarget(evidence, input.targetText)) {
    return 'unclear';
  }

  const criminalActs = new Set([
    'threat', 'admission', 'fantasy', 'endorsement', 'incitement', 'plan', 'instruction',
  ]);
  if (criminalActs.has(meaning.speechAct || '')) {
    return 'criminal';
  }
  if (
    meaning.speechAct === 'prediction' ||
    meaning.speechAct === 'taunt' ||
    meaning.speechAct === 'report' ||
    meaning.speechAct === 'quote' ||
    meaning.speechAct === 'metaphor'
  ) {
    return 'benign';
  }
  return 'unclear';
}

export function getGroundedFinalJudgeMeaningEvidence(
  meaning: CriminalFinalJudgeResult['meaning'],
  input: CriminalContextAnalysisInput
): string {
  if (!meaning || typeof meaning !== 'object') {
    return '';
  }
  const evidence = cleanJudgeText(meaning.evidence, '').slice(0, 500);
  return isQuoteGroundedInTarget(evidence, input.targetText) ? evidence : '';
}

export function normalizeJudgedViolation(
  violation: CriminalFinalJudgeViolation,
  allowedReferences: Map<string, LegalReferenceHit>,
  allReferences: LegalReferenceHit[],
  evidence: NonNullable<CriminalAnalysisResult['evidence']>,
  input: CriminalContextAnalysisInput,
  fallbackConfidence?: number,
  groundedMeaningQuote?: string
): CriminalViolation | null {
  const article = typeof violation.article === 'string' ? violation.article.trim() : '';
  const subarticle = typeof violation.subarticle === 'string' && violation.subarticle.trim()
    ? violation.subarticle.trim()
    : null;
  const reference = allowedReferences.get(`${article}:${subarticle || ''}`);
  if (!article || !reference) {
    return null;
  }

  const confidence = clampNumber(Number(violation.confidence ?? fallbackConfidence ?? 0), 0, 1);
  const severity = Math.round(clampNumber(Number(violation.severity ?? 1), 1, 10));
  const modelQuote = cleanJudgeText(violation.quote, '').slice(0, 500);
  const quote = isQuoteGroundedInTarget(modelQuote, input.targetText)
    ? modelQuote
    : groundedMeaningQuote || '';
  if (!quote) {
    console.warn('Criminal final judge rejected ungrounded violation quote', {
      op: 'finalJudgeQuote',
      errorCode: 'UNGROUNDED_QUOTE',
    });
    return null;
  }
  if (quote !== modelQuote) {
    console.warn('Criminal final judge replaced ungrounded violation quote with grounded meaning evidence', {
      op: 'finalJudgeQuote',
      errorCode: 'QUOTE_FALLBACK_TO_MEANING',
    });
  }

  const punishmentReference = selectPunishmentReference(allReferences, reference) || reference;
  return {
    article: reference.article,
    subarticle: reference.subarticle || null,
    articleTitle: reference.articleTitle || cleanJudgeText(violation.articleTitle, ''),
    quote,
    punishment: buildStoredPunishment(punishmentReference),
    severity,
    confidence,
    decision: 'violation',
    evidence,
    targetMessageId: input.targetMessageId,
    contextWindow: input.contextWindow,
  };
}
