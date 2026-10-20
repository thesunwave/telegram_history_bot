// Pure helpers for the semantic prefilter: prompts, payloads, response parsing
// and normalization. Moved from CriminalCodeAnalyzerDO.

import type {
  CriminalContextAnalysisInput,
  CriminalContextMessage,
  CriminalSemanticPrefilterResult,
} from '../../../core/env';
import {
  countNormalizedProfanityTokens,
  normalizeProfanityWord,
  type LocalProfanityResult,
} from '../../profanity/local-detector';
import type { ShadowEvaluationUsage } from '../../model-shadow/evaluation-store';
import { clampNumber } from './legal-references';

const SEMANTIC_PREFILTER_CONTEXT_BEFORE = 2;
const SEMANTIC_PREFILTER_CONTEXT_AFTER = 1;

export function buildQwenPrefilterResponseFormat(isBatch: boolean): Record<string, unknown> {
  const resultProperties = {
    shouldAnalyze: { type: 'boolean' },
    reason: {
      type: 'string',
      enum: [
        'threat', 'sexual_threat', 'incitement', 'self_incrimination', 'extremism',
        'dangerous_instruction', 'violent_expression', 'other_criminal', 'none',
      ],
    },
    confidence: { type: 'number' },
    explanation: { type: 'string' },
    searchQuery: { type: 'string' },
    semanticFrame: {
      type: 'object',
      properties: {
        speechAct: {
          type: 'string',
          enum: [
            'threat', 'prediction', 'taunt', 'admission', 'incitement', 'instruction',
            'fantasy', 'endorsement', 'plan', 'report', 'quote', 'hypothetical', 'other',
            'unknown',
          ],
        },
        actor: { type: 'string', enum: ['author', 'third_party', 'unknown'] },
        action: { type: 'string' },
        targetKind: {
          type: 'string',
          enum: ['person', 'group', 'property', 'institution', 'abstract', 'unknown'],
        },
        harmKind: {
          type: 'string',
          enum: [
            'death', 'grievous_bodily_harm', 'bodily_harm', 'sexual_violence',
            'property_damage', 'coercion', 'other', 'none', 'unknown',
          ],
        },
        modality: {
          type: 'string',
          enum: ['intended', 'promised', 'desired', 'predicted', 'hypothetical', 'reported', 'unknown'],
        },
        evidenceSpans: { type: 'array', items: { type: 'string' } },
      },
      required: ['speechAct', 'actor', 'action', 'targetKind', 'harmKind', 'modality', 'evidenceSpans'],
      additionalProperties: false,
    },
    profanity: {
      type: 'object',
      properties: {
        hasProfanity: { type: 'boolean' },
        words: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              word: { type: 'string' },
              count: { type: 'integer' },
              confidence: { type: 'number' },
            },
            required: ['word', 'count', 'confidence'],
            additionalProperties: false,
          },
        },
      },
      required: ['hasProfanity', 'words'],
      additionalProperties: false,
    },
  };
  const resultRequired = [
    'shouldAnalyze', 'reason', 'confidence', 'explanation', 'searchQuery', 'semanticFrame', 'profanity',
  ];
  const resultSchema = {
    type: 'object',
    properties: resultProperties,
    required: resultRequired,
    additionalProperties: false,
  };
  const schema = isBatch
    ? {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, ...resultProperties },
            required: ['id', ...resultRequired],
            additionalProperties: false,
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    }
    : resultSchema;

  return {
    type: 'json_schema',
    json_schema: {
      name: isBatch ? 'criminal_prefilter_batch' : 'criminal_prefilter',
      strict: true,
      schema,
    },
  };
}

export function buildSemanticPrefilterSystemPrompt(
  isBatch: boolean,
  variant: 'ru' | 'hybrid_en_v1' = 'ru'
): string {
  if (variant === 'hybrid_en_v1') {
    return buildHybridEnglishSemanticPrefilterSystemPrompt(isBatch);
  }
  return [
    'Ты быстрый prefilter для Telegram-чата.',
    'Реши, нужно ли отправлять target-сообщение в дорогой юридический анализ УК РФ.',
    'Квалифицируй только target-сообщение. Короткий соседний контекст дан только для восстановления смысла target: местоимений, пропущенного субъекта/объекта, сленга, эллипсиса и переносных выражений.',
    'Если передан replyTo, это сообщение, на которое target отвечает напрямую. Для коротких ответов, подколов, эллипсиса и местоимений replyTo важнее обычных соседних сообщений при восстановлении смысла target.',
    'Никогда не переноси угрозу, насилие или иной криминальный смысл из replyTo на target. Если target в связке с replyTo является только ответной шуткой, сексуальным/грубым подколом, уточнением или отрицанием без собственного уголовно значимого действия автора, верни shouldAnalyze=false.',
    'Опасный смысл только в соседних сообщениях не является причиной анализировать target. Если контекст однозначно раскрывает target как бытовую, предметную, игровую или иную некриминальную реплику, верни shouldAnalyze=false.',
    'Не достраивай отсутствующее насильственное действие, жертву или умысел из грубой, двусмысленной или эллиптической фразы.',
    'Сначала опиши фактический смысл target в semanticFrame, а уже потом выбирай shouldAnalyze/reason.',
    'Отличай обещание/угрозу действия автора от прогноза, насмешки, цитаты или сообщения о действиях третьих лиц.',
    'Негативный прогноз сам по себе не является угрозой: фразы вроде "скоро не будет вашей школы/компании/образования" без обещания насилия классифицируй как prediction или taunt, а не threat.',
    'Для этого продукта считай значимыми не только угрозы и признания, но и выраженные автором фантазии, планы, одобрение или пожелание конкретного уголовно наказуемого насилия/деяния.',
    'Если автор от себя фантазирует о насилии, одобряет его, предлагает его или планирует его, ставь shouldAnalyze=true; используй speechAct=fantasy|endorsement|incitement|plan по смыслу и reason=violent_expression, если более специальный reason не подходит.',
    'Не ограничивай уголовный сигнал насилием. Если автор от себя одобряет, предлагает, планирует, желает, инструктирует или признаётся в конкретном потенциально уголовно наказуемом деянии, которое не подходит под более специальный reason, используй reason=other_criminal.',
    'В частности, reason=other_criminal должен пропускать в юридический анализ одобрение или предложение сексуальных действий с несовершеннолетними, хищения, мошенничества, незаконного оборота наркотиков и иных конкретных деяний. Простое обсуждение закона, новости, чужих действий или абстрактный вопрос без позиции/намерения автора не пропускай.',
    'Если автор только пересказывает чужую угрозу, цитирует новость или использует слово "убить" метафорически/технически, не превращай это в угрозу автора.',
    'Ищи реальные смысловые признаки: угрозы, угрозы сексуального насилия, призывы/одобрение насилия, экстремизм/терроризм, признание в совершенном преступлении, опасные инструкции.',
    'Мат, сексуальный сленг, шутки, бытовые фразы и действия с предметами сами по себе не являются причиной.',
    'Но разговорные угрозы причинить вред человеку должны проходить: обещания избить, ударить, покалечить, убить, изнасиловать или совершить иное насилие.',
    'semanticFrame.evidenceSpans должен содержать только точные короткие цитаты из target-сообщения, подтверждающие выбранный смысл.',
    'Если shouldAnalyze=true, reason не может быть none.',
    'Для угроз сексуального насилия используй reason=sexual_threat.',
    'Для бытовых угроз физической расправы без сексуального смысла используй reason=threat, не sexual_threat.',
    'Если shouldAnalyze=true, добавь searchQuery на русском: нейтральную юридическую формулировку для поиска по УК РФ без номера статьи и без цитирования мата.',
    'searchQuery должен сохранять тип речевого акта и суть деяния, а не сводить любое насилие к угрозе.',
    'Примеры searchQuery: "угроза убийством адресату", "признание в тайном хищении чужого имущества", "призыв к насилию против группы по национальному признаку", "одобрение причинения тяжкого вреда здоровью".',
    'Не используй английский язык, жаргон, странные слова, номера статей или фразы вроде "без указания конкретной статьи" в searchQuery.',
    'Одновременно проверь target-сообщение на русскую обсценную лексику. Это не влияет на shouldAnalyze.',
    'В profanity.words возвращай только точные словоформы мата из target-сообщения и count по ним, не леммы и не базовые формы.',
    'Не включай морально-негативные, религиозные или просто грубые слова, если они не являются русской обсценной лексикой.',
    isBatch
      ? 'Верни строго JSON: {"items":[{"id":"same id","shouldAnalyze":boolean,"reason":"threat|sexual_threat|incitement|self_incrimination|extremism|dangerous_instruction|violent_expression|other_criminal|none","confidence":0..1,"explanation":"short","searchQuery":"short or empty","semanticFrame":{"speechAct":"threat|prediction|taunt|admission|incitement|instruction|fantasy|endorsement|plan|report|quote|hypothetical|other|unknown","actor":"author|third_party|unknown","action":"short factual action","targetKind":"person|group|property|institution|abstract|unknown","harmKind":"death|grievous_bodily_harm|bodily_harm|sexual_violence|property_damage|coercion|other|none|unknown","modality":"intended|promised|desired|predicted|hypothetical|reported|unknown","evidenceSpans":["exact target quote"]},"profanity":{"hasProfanity":boolean,"words":[{"word":"string","count":1,"confidence":0..1}]}}]}'
      : 'Верни строго JSON: {"shouldAnalyze":boolean,"reason":"threat|sexual_threat|incitement|self_incrimination|extremism|dangerous_instruction|violent_expression|other_criminal|none","confidence":0..1,"explanation":"short","searchQuery":"short or empty","semanticFrame":{"speechAct":"threat|prediction|taunt|admission|incitement|instruction|fantasy|endorsement|plan|report|quote|hypothetical|other|unknown","actor":"author|third_party|unknown","action":"short factual action","targetKind":"person|group|property|institution|abstract|unknown","harmKind":"death|grievous_bodily_harm|bodily_harm|sexual_violence|property_damage|coercion|other|none|unknown","modality":"intended|promised|desired|predicted|hypothetical|reported|unknown","evidenceSpans":["exact target quote"]},"profanity":{"hasProfanity":boolean,"words":[{"word":"string","count":1,"confidence":0..1}]}}'
  ].join('\n');
}

export function buildHybridEnglishSemanticPrefilterSystemPrompt(isBatch: boolean): string {
  return [
    'You are a fast semantic prefilter for a Russian-language Telegram chat.',
    'Decide whether the TARGET message should be sent to expensive legal analysis under the Criminal Code of the Russian Federation (УК РФ).',
    'Classify only the TARGET message. Neighboring context is provided only to resolve the meaning of TARGET: pronouns, omitted subject/object, slang, ellipsis, and figurative language.',
    'If replyTo is present, it is the message that TARGET directly replies to. Use it as stronger context than ordinary neighboring messages when resolving short replies, jokes, ellipsis, and pronouns.',
    'Never transfer a threat, violence, criminal intent, or any other criminal meaning from replyTo or neighboring context onto TARGET.',
    'If TARGET is only a reply joke, crude or sexual taunt, clarification, denial, report, quote, or neutral discussion without its own criminally relevant act or stance by the author, return shouldAnalyze=false.',
    'If dangerous meaning exists only in neighboring messages, that is not a reason to analyze TARGET.',
    'Do not invent a violent act, victim, intent, or criminal plan that TARGET does not express.',
    'First describe the factual meaning of TARGET in semanticFrame. Only then choose shouldAnalyze and reason.',
    'Distinguish an act promised or intended by the author from a prediction, taunt, quote, hypothetical, report, or third-party action.',
    'A negative prediction is not a threat by itself. For example, a statement like "скоро не будет вашей школы" without a promise of violence is prediction/taunt, not threat.',
    'For this product, pass explicit fantasies, plans, endorsements, wishes, or proposals by the author for a concrete potentially criminal act, not only direct threats or confessions.',
    'If the author personally fantasizes about, endorses, proposes, wishes, or plans concrete violence, use shouldAnalyze=true and speechAct=fantasy|endorsement|plan|incitement as appropriate; use reason=violent_expression when no more specific reason fits.',
    'Do not limit criminal signals to violence. If the author personally endorses, proposes, plans, instructs, wishes, or admits a concrete potentially criminal act that has no more specific reason, use reason=other_criminal.',
    'Simple discussion of a law, news, another person’s conduct, or an abstract question without the author’s own stance or intent should not pass.',
    'If the author merely reports another person’s threat or uses violent wording metaphorically or technically, do not turn it into a threat by the author.',
    'Relevant semantic signals include threats, sexual-violence threats, incitement or endorsement of violence, extremism/terrorism, self-incrimination, and dangerous instructions.',
    'Profanity, sexual slang, jokes, everyday frustration, and actions involving objects are not criminal signals by themselves.',
    'Conversational threats to harm a person should pass when TARGET itself expresses a promise or intent to beat, injure, kill, rape, or otherwise commit violence.',
    'semanticFrame.evidenceSpans must contain only exact short quotes from TARGET that support the selected meaning.',
    'If shouldAnalyze=true, reason must not be none.',
    'Use reason=sexual_threat only for threats of sexual violence. Use reason=threat for ordinary physical threats without sexual meaning.',
    'If shouldAnalyze=true, write searchQuery in Russian as a neutral legal search phrase for УК РФ. Do not include an article number and do not quote profanity.',
    'searchQuery must preserve the speech act and the substance of the conduct instead of reducing every violent statement to a threat.',
    'Examples of searchQuery: "угроза убийством адресату", "признание в тайном хищении чужого имущества", "призыв к насилию против группы по национальному признаку", "одобрение причинения тяжкого вреда здоровью".',
    'At the same time, detect Russian obscene profanity in TARGET. Profanity does not affect shouldAnalyze.',
    'In profanity.words return only exact obscene word forms that literally occur in TARGET, with their counts. Do not return lemmas, normalized forms, or profanity copied from context.',
    'Do not include merely rude, insulting, religious, sexual, or morally negative words unless they are Russian obscene profanity.',
    isBatch
      ? 'Return strict JSON only: {"items":[{"id":"same id","shouldAnalyze":boolean,"reason":"threat|sexual_threat|incitement|self_incrimination|extremism|dangerous_instruction|violent_expression|other_criminal|none","confidence":0..1,"explanation":"short","searchQuery":"short Russian phrase or empty","semanticFrame":{"speechAct":"threat|prediction|taunt|admission|incitement|instruction|fantasy|endorsement|plan|report|quote|hypothetical|other|unknown","actor":"author|third_party|unknown","action":"short factual action","targetKind":"person|group|property|institution|abstract|unknown","harmKind":"death|grievous_bodily_harm|bodily_harm|sexual_violence|property_damage|coercion|other|none|unknown","modality":"intended|promised|desired|predicted|hypothetical|reported|unknown","evidenceSpans":["exact target quote"]},"profanity":{"hasProfanity":boolean,"words":[{"word":"string","count":1,"confidence":0..1}]}}]}'
      : 'Return strict JSON only: {"shouldAnalyze":boolean,"reason":"threat|sexual_threat|incitement|self_incrimination|extremism|dangerous_instruction|violent_expression|other_criminal|none","confidence":0..1,"explanation":"short","searchQuery":"short Russian phrase or empty","semanticFrame":{"speechAct":"threat|prediction|taunt|admission|incitement|instruction|fantasy|endorsement|plan|report|quote|hypothetical|other|unknown","actor":"author|third_party|unknown","action":"short factual action","targetKind":"person|group|property|institution|abstract|unknown","harmKind":"death|grievous_bodily_harm|bodily_harm|sexual_violence|property_damage|coercion|other|none|unknown","modality":"intended|promised|desired|predicted|hypothetical|reported|unknown","evidenceSpans":["exact target quote"]},"profanity":{"hasProfanity":boolean,"words":[{"word":"string","count":1,"confidence":0..1}]}}'
  ].join('\n');
}

export function buildSemanticPrefilterPayload(input: CriminalContextAnalysisInput): Record<string, unknown> {
  return {
    targetMessageId: input.targetMessageId,
    targetText: input.targetText,
    targetUsername: input.targetUsername,
    replyTo: input.replyTo,
    contextWindow: input.contextWindow,
    messages: selectSemanticPrefilterMessages(input)
      .map(message => ({
        username: message.username,
        text: message.text,
        relativePosition: message.relativePosition,
        isTarget: message.isTarget
      }))
  };
}

export function selectSemanticPrefilterMessages(input: CriminalContextAnalysisInput): CriminalContextMessage[] {
  return input.messages.filter(message => {
    if (message.isTarget) {
      return true;
    }
    if (message.relativePosition < 0) {
      return Math.abs(message.relativePosition) <= SEMANTIC_PREFILTER_CONTEXT_BEFORE;
    }
    return message.relativePosition <= SEMANTIC_PREFILTER_CONTEXT_AFTER;
  });
}

export function normalizeSemanticPrefilterResult(
  result: Partial<CriminalSemanticPrefilterResult>,
  targetText?: string
): CriminalSemanticPrefilterResult {
  const reason = result.reason === 'threat' ||
    result.reason === 'sexual_threat' ||
    result.reason === 'incitement' ||
    result.reason === 'self_incrimination' ||
    result.reason === 'extremism' ||
    result.reason === 'dangerous_instruction' ||
    result.reason === 'violent_expression' ||
    result.reason === 'other_criminal'
    ? result.reason
    : 'none';

  const profanity = normalizeSemanticPrefilterProfanity((result as any).profanity);
  return {
    shouldAnalyze: Boolean(result.shouldAnalyze),
    reason,
    confidence: typeof result.confidence === 'number' ? Math.max(0, Math.min(1, result.confidence)) : 0,
    explanation: typeof result.explanation === 'string' ? result.explanation.slice(0, 200) : '',
    searchQuery: typeof result.searchQuery === 'string' ? result.searchQuery.slice(0, 300) : '',
    semanticFrame: normalizeSemanticFrame((result as any).semanticFrame),
    profanity: targetText
      ? groundSemanticPrefilterProfanity(profanity, targetText)
      : profanity,
  };
}

export function normalizeSemanticFrame(result: any): CriminalSemanticPrefilterResult['semanticFrame'] {
  if (!result || typeof result !== 'object') {
    return undefined;
  }

  const speechActs = new Set([
    'threat', 'prediction', 'taunt', 'admission', 'incitement', 'instruction',
    'fantasy', 'endorsement', 'plan', 'report', 'quote', 'hypothetical', 'other', 'unknown',
  ]);
  const actors = new Set(['author', 'third_party', 'unknown']);
  const targetKinds = new Set(['person', 'group', 'property', 'institution', 'abstract', 'unknown']);
  const harmKinds = new Set([
    'death', 'grievous_bodily_harm', 'bodily_harm', 'sexual_violence',
    'property_damage', 'coercion', 'other', 'none', 'unknown',
  ]);
  const modalities = new Set([
    'intended', 'promised', 'desired', 'predicted', 'hypothetical', 'reported', 'unknown',
  ]);
  const evidenceSpans = Array.isArray(result.evidenceSpans)
    ? result.evidenceSpans
      .filter((value: unknown): value is string => typeof value === 'string')
      .map((value: string) => value.replace(/\s+/g, ' ').trim().slice(0, 300))
      .filter(Boolean)
      .slice(0, 5)
    : [];

  return {
    speechAct: speechActs.has(result.speechAct) ? result.speechAct : 'unknown',
    actor: actors.has(result.actor) ? result.actor : 'unknown',
    action: typeof result.action === 'string' ? result.action.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
    targetKind: targetKinds.has(result.targetKind) ? result.targetKind : 'unknown',
    harmKind: harmKinds.has(result.harmKind) ? result.harmKind : 'unknown',
    modality: modalities.has(result.modality) ? result.modality : 'unknown',
    evidenceSpans,
  } as CriminalSemanticPrefilterResult['semanticFrame'];
}

export function normalizeSemanticPrefilterProfanity(
  result: any
): CriminalSemanticPrefilterResult['profanity'] {
  const words = Array.isArray(result?.words)
    ? result.words
      .map((word: any) => {
        const normalized = normalizeProfanityCounterWord(word);
        if (!normalized) {
          return null;
        }
        const confidence = typeof word?.confidence === 'number'
          ? clampNumber(word.confidence, 0, 1)
          : 0.5;
        return { ...normalized, confidence };
      })
      .filter((word: any): word is { word: string; count: number; confidence: number } => Boolean(word))
    : [];
  return {
    hasProfanity: Boolean(result?.hasProfanity) && words.length > 0,
    words,
  };
}

export function groundSemanticPrefilterProfanity(
  profanity: CriminalSemanticPrefilterResult['profanity'],
  targetText: string
): CriminalSemanticPrefilterResult['profanity'] {
  const tokenCounts = countNormalizedProfanityTokens(targetText);
  const words = (profanity?.words || []).flatMap(word => {
    const targetCount = tokenCounts.get(word.word) || 0;
    if (targetCount <= 0) {
      return [];
    }
    return [{ ...word, count: Math.min(word.count, targetCount) }];
  });
  return {
    hasProfanity: words.length > 0,
    words,
  };
}

export function semanticFrameSupportsReason(
  frame: CriminalSemanticPrefilterResult['semanticFrame'],
  reason: CriminalSemanticPrefilterResult['reason']
): boolean {
  if (!frame || frame.evidenceSpans.length === 0 || frame.actor === 'third_party') {
    return false;
  }

  switch (reason) {
    case 'threat':
    case 'sexual_threat':
      return frame.speechAct === 'threat';
    case 'incitement':
      return frame.speechAct === 'incitement';
    case 'self_incrimination':
      return frame.speechAct === 'admission';
    case 'dangerous_instruction':
      return frame.speechAct === 'instruction';
    case 'violent_expression':
      return frame.speechAct === 'fantasy' ||
        frame.speechAct === 'endorsement' ||
        frame.speechAct === 'incitement' ||
        frame.speechAct === 'plan';
    case 'extremism':
      return frame.speechAct === 'threat' ||
        frame.speechAct === 'incitement' ||
        frame.speechAct === 'instruction' ||
        frame.speechAct === 'fantasy' ||
        frame.speechAct === 'endorsement' ||
        frame.speechAct === 'plan';
    case 'other_criminal':
      return frame.speechAct === 'admission' ||
        frame.speechAct === 'instruction' ||
        frame.speechAct === 'fantasy' ||
        frame.speechAct === 'endorsement' ||
        frame.speechAct === 'incitement' ||
        frame.speechAct === 'plan';
    case 'none':
    default:
      return false;
  }
}

export function buildNoSignalPrefilter(explanation: string): CriminalSemanticPrefilterResult {
  return {
    shouldAnalyze: false,
    reason: 'none',
    confidence: 0,
    explanation,
    searchQuery: '',
  };
}

export function normalizeTextForSemanticCache(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function extractOpenAIResponsesText(response: any): string | null {
  if (typeof response?.output_text === 'string') {
    return response.output_text;
  }
  const nestedJson = findJsonLikeText(response?.output);
  if (nestedJson) {
    return nestedJson;
  }
  if (!Array.isArray(response?.output)) {
    return null;
  }
  for (const item of response.output) {
    const content = item?.content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const part of content) {
      if (typeof part?.text === 'string') {
        return part.text;
      }
    }
  }
  return null;
}

export function findJsonLikeText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (
      trimmed.includes('"shouldAnalyze"') ||
      (trimmed.startsWith('{') && trimmed.includes('"confidence"'))
    ) {
      return value;
    }
    return null;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJsonLikeText(item);
      if (found) {
        return found;
      }
    }
    return null;
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    const found = findJsonLikeText(nested);
    if (found) {
      return found;
    }
  }
  return null;
}

export function buildShadowUsage(usage: any, batchSize: number): ShadowEvaluationUsage | undefined {
  if (!usage) {
    return undefined;
  }
  const promptTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
  const completionTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
  const totalTokens = Number(usage.total_tokens ?? (promptTokens + completionTokens)) || 0;
  const promptDetails = usage.prompt_tokens_details ?? {};
  const cachedTokens = Number(
    promptDetails.cached_tokens ?? usage.cache_read_input_tokens ?? 0
  ) || 0;
  const cacheCreationTokens = Number(
    promptDetails.cache_creation_input_tokens ?? usage.cache_creation_input_tokens ?? 0
  ) || 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cachedTokens,
    cacheCreationTokens,
    scope: 'request',
    batchSize,
  };
}

export function getShadowErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 500);
  }
  return 'Unknown provider error';
}

export function normalizeProfanityCounterWord(rawWord: any): { word: string; count: number } | null {
  const confidence = typeof rawWord?.confidence === 'number'
    ? clampNumber(rawWord.confidence, 0, 1)
    : 0;
  if (confidence < 0.5) {
    return null;
  }

  const word = normalizeProfanityWord(String(rawWord?.word || rawWord?.baseForm || ''));
  const count = Math.round(clampNumber(Number(rawWord?.count ?? 1), 0, 100));
  if (!word || count <= 0) {
    return null;
  }
  return { word, count };
}

export function mergeProfanityWords(
  text: string,
  localResult?: LocalProfanityResult,
  modelResult?: CriminalSemanticPrefilterResult['profanity']
): Array<{ word: string; count: number }> {
  const counts = new Map<string, number>();
  const tokenCounts = countNormalizedProfanityTokens(text);

  for (const source of [localResult, modelResult]) {
    if (!source?.hasProfanity || !Array.isArray(source.words)) {
      continue;
    }
    const sourceCounts = new Map<string, number>();
    for (const rawWord of source.words) {
      const normalized = normalizeProfanityCounterWord(rawWord);
      if (!normalized) {
        continue;
      }
      const tokenCount = tokenCounts.get(normalized.word) || 0;
      if (tokenCount <= 0) {
        continue;
      }
      const count = Math.min(normalized.count, tokenCount);
      sourceCounts.set(
        normalized.word,
        (sourceCounts.get(normalized.word) || 0) + count
      );
    }
    for (const [word, count] of sourceCounts) {
      counts.set(word, Math.max(counts.get(word) || 0, count));
    }
  }
  return Array.from(counts.entries()).map(([word, count]) => ({ word, count }));
}
