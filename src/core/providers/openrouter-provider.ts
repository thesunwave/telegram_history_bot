import { Env } from '../env';
import { Logger } from '../logger';
import { getBudgetTracker, FeatureType, TokenUsage } from '../llm';
import {
  AIProvider,
  ChatMessage,
  CriminalAnalysisResult,
  CriminalContextAnalysisInput,
  CriminalViolation,
  MESSAGE_SEPARATOR,
  ProfanityAnalysisResult,
  ProviderError,
  ProviderInfo,
  SummaryOptions,
  SummaryRequest,
  getCriminalCodePrompts,
} from './ai-provider';

interface OpenRouterChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    code?: number;
    message?: string;
  };
}

type UsageCallback = (model: string, feature: FeatureType, usage: TokenUsage) => void;

const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_OPENROUTER_MODEL = 'nvidia/nemotron-3-super-120b-a12b:free';

function safeNoViolation(targetMessageId?: number): CriminalAnalysisResult {
  return {
    hasViolations: false,
    decision: 'no_violation',
    evidence: {
      subject: 'unknown',
      object: 'unknown',
      intent: 'analysis unavailable',
      contextSummary: 'safe fallback',
      whyNotBenign: 'not enough reliable model output to classify as violation',
    },
    violations: [],
    totalSeverity: 0,
    riskLevel: 'low',
    analysisTimestamp: Date.now(),
    targetMessageId,
  };
}

export class OpenRouterProvider implements AIProvider {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly usageCallback: UsageCallback;

  constructor(private env: Env, modelOverride?: string) {
    this.apiKey = env.OPENROUTER_API_KEY;
    this.baseUrl = (env.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER_BASE_URL).replace(/\/$/, '');
    this.model = modelOverride?.trim() || env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
    this.usageCallback = (model: string, feature: FeatureType, usage: TokenUsage) => {
      try {
        getBudgetTracker(env).recordUsage(model, feature, usage);
      } catch (error) {
        Logger.warn('Failed to record OpenRouter usage', {
          error: error instanceof Error ? error.message : String(error),
          model,
          feature,
        });
      }
    };
  }

  async summarize(request: SummaryRequest, options: SummaryOptions, env?: Env): Promise<string> {
    const content = request.messages.map(m => `${m.username}: ${m.text}`).join(';');
    const messages: ChatMessage[] = [
      { role: 'system', content: `${request.systemPrompt || ''}\n${request.limitNote}`.trim() },
      { role: 'user', content: `${request.userPrompt}\n${MESSAGE_SEPARATOR}\n${content}` },
    ];
    const response = await this.callOpenRouter(messages, options, options.forceJsonResponse ?? false, 'summary', env);
    return response.choices?.[0]?.message?.content?.trim() || '';
  }

  async analyzeProfanity(_text: string): Promise<ProfanityAnalysisResult> {
    return { hasProfanity: false, words: [] };
  }

  async analyzeCriminalCode(text: string, env?: Env): Promise<CriminalAnalysisResult> {
    const { systemPrompt, userPrompt } = getCriminalCodePrompts(env || this.env);
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `${userPrompt}\n${text}` },
    ];
    return await this.analyzeMessages(messages, undefined, env);
  }

  async analyzeCriminalCodeWithContext(
    input: CriminalContextAnalysisInput,
    env?: Env
  ): Promise<CriminalAnalysisResult> {
    const { systemPrompt } = getCriminalCodePrompts(env || this.env);
    const userPayload = {
      task: 'contextual_criminal_risk_analysis',
      rules: [
        'Return compact JSON only. Do not include reasoning, markdown, prose, or analysis outside JSON.',
        'Do not calculate, convert, or return analysisTimestamp; the application adds it after parsing.',
        'Analyze only Russian Criminal Code and extremist/incitement risks.',
        'Return violation only when the target message has concrete subject, object, intent, and legal relevance.',
        'If the target message is only a short clarification, denial, joke fragment, or neutral reply without concrete illegal act, return no_violation.',
        'Profanity or sexual slang alone is not a violation.',
        'If context shows the object is furniture, equipment, code, game object, or another non-person thing, return no_violation.',
        'If confidence is below 0.8, return no_violation or uncertain, never violation.',
      ],
      input,
    };
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(userPayload) },
    ];
    const result = await this.analyzeMessages(messages, input.targetMessageId, env);
    result.targetMessageId = input.targetMessageId;
    result.contextWindow = input.contextWindow;
    result.violations = result.violations.map(violation => ({
      ...violation,
      targetMessageId: violation.targetMessageId ?? input.targetMessageId,
      contextWindow: violation.contextWindow ?? input.contextWindow,
      evidence: violation.evidence ?? result.evidence,
      decision: violation.decision ?? result.decision,
    }));
    return result;
  }

  validateConfig(): void {
    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY is required for OpenRouter provider');
    }
  }

  getProviderInfo(): ProviderInfo {
    return { name: 'openrouter', model: this.model };
  }

  private async analyzeMessages(
    messages: ChatMessage[],
    targetMessageId?: number,
    env?: Env
  ): Promise<CriminalAnalysisResult> {
    try {
      const response = await this.callOpenRouter(
        messages,
        {
          maxTokens: Number((env || this.env).OPENAI_MAX_TOKENS || 1200),
          temperature: 0.1,
          topP: 0.9,
        },
        true,
        'criminal',
        env
      );
      const content = response.choices?.[0]?.message?.content?.trim();
      if (!content) {
        Logger.warn('OpenRouter criminal analysis returned empty response', { targetMessageId });
        return safeNoViolation(targetMessageId);
      }
      return this.parseCriminalResponse(content, targetMessageId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Logger.warn('OpenRouter criminal analysis failed with safe fallback', {
        targetMessageId,
        error: message,
      });
      return safeNoViolation(targetMessageId);
    }
  }

  private async callOpenRouter(
    messages: ChatMessage[],
    options: SummaryOptions,
    forceJsonResponse: boolean,
    feature: FeatureType,
    env?: Env
  ): Promise<OpenRouterChatResponse> {
    this.validateConfig();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
    if ((env || this.env).OPENROUTER_REFERER) {
      headers['HTTP-Referer'] = String((env || this.env).OPENROUTER_REFERER);
    }
    headers['X-OpenRouter-Title'] = String((env || this.env).OPENROUTER_TITLE || 'Telegram History Bot');

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        top_p: options.topP,
        response_format: forceJsonResponse ? { type: 'json_object' } : undefined,
      }),
    });

    const parsed = await response.json().catch(() => null) as OpenRouterChatResponse | null;
    if (!response.ok) {
      const detail = parsed?.error?.message || response.statusText;
      if ([402, 429].includes(response.status) || response.status >= 500) {
        throw new ProviderError(`OpenRouter temporary error ${response.status}: ${detail}`, 'openrouter');
      }
      throw new ProviderError(`OpenRouter API error ${response.status}: ${detail}`, 'openrouter');
    }

    if (!parsed) {
      throw new ProviderError('OpenRouter API returned non-JSON response', 'openrouter');
    }

    if (parsed.usage) {
      this.usageCallback(this.model, feature, {
        promptTokens: parsed.usage.prompt_tokens || 0,
        completionTokens: parsed.usage.completion_tokens || 0,
        totalTokens: parsed.usage.total_tokens || 0,
      });
    }

    return parsed;
  }

  private parseCriminalResponse(response: string, targetMessageId?: number): CriminalAnalysisResult {
    try {
      const jsonMatch = response.trim().match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : response);
      const violations = Array.isArray(parsed.violations) ? parsed.violations : [];
      const validViolations: CriminalViolation[] = violations
        .filter((violation: any) => (
          typeof violation.article === 'string' &&
          typeof violation.articleTitle === 'string' &&
          typeof violation.quote === 'string' &&
          typeof violation.punishment === 'string' &&
          typeof violation.severity === 'number' &&
          typeof violation.confidence === 'number'
        ))
        .map((violation: any) => ({
          article: violation.article,
          subarticle: violation.subarticle === undefined ? null : violation.subarticle,
          articleTitle: violation.articleTitle,
          quote: violation.quote,
          punishment: violation.punishment,
          severity: violation.severity,
          confidence: violation.confidence,
          evidence: violation.evidence || parsed.evidence,
          decision: violation.decision || parsed.decision,
          targetMessageId: violation.targetMessageId ?? targetMessageId,
          contextWindow: violation.contextWindow || parsed.contextWindow,
        }));

      const decision = parsed.decision === 'violation' || parsed.decision === 'uncertain'
        ? parsed.decision
        : 'no_violation';
      const confirmedViolations = decision === 'violation'
        ? validViolations.filter(violation => violation.confidence >= 0.8)
        : [];

      return {
        hasViolations: confirmedViolations.length > 0,
        decision: confirmedViolations.length > 0 ? 'violation' : decision,
        evidence: parsed.evidence,
        violations: confirmedViolations,
        totalSeverity: confirmedViolations.reduce((sum, violation) => sum + violation.severity, 0),
        riskLevel: confirmedViolations.length > 0 ? (parsed.riskLevel || 'medium') : 'low',
        analysisTimestamp: Date.now(),
        targetMessageId,
        contextWindow: parsed.contextWindow,
      };
    } catch (error) {
      Logger.warn('OpenRouter criminal analysis response parsing failed', {
        targetMessageId,
        error: error instanceof Error ? error.message : String(error),
      });
      return safeNoViolation(targetMessageId);
    }
  }
}
