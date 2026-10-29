import type {
  CriminalContextAnalysisInput,
  CriminalViolation,
  MessageReplyContext,
} from '../../../core/env';
import type { CriminalPrefilterReason } from '../prefilter';
import type { LocalProfanityResult } from '../../profanity/local-detector';

export interface QueuedCriminalAnalysisTask {
  text: string;
  chatId: number;
  userId?: number;
  messageId?: number;
  username?: string;
  replyTo?: MessageReplyContext;
  day?: string;
  ts?: number;
  sequence?: number;
  reasons: CriminalPrefilterReason[];
  enqueuedAt: number;
  localProfanity?: LocalProfanityResult;
}

export interface CriminalFinalJudgeResult {
  decision?: 'violation' | 'no_violation' | 'uncertain';
  confidence?: number;
  contextResolvesBenign?: boolean;
  meaning?: {
    speechAct?: 'threat' | 'admission' | 'fantasy' | 'endorsement' | 'incitement' | 'plan' | 'instruction' | 'prediction' | 'taunt' | 'report' | 'quote' | 'metaphor' | 'other' | 'unclear';
    evidence?: string;
  };
  evidence?: {
    subject?: string;
    object?: string;
    intent?: string;
    contextSummary?: string;
    whyNotBenign?: string;
  };
  violations?: CriminalFinalJudgeViolation[];
}

export interface CriminalFinalJudgeViolation extends Partial<CriminalViolation> {
}

export interface CriminalPrefilterBatchItem {
  id: string;
  input: CriminalContextAnalysisInput;
  task: QueuedCriminalAnalysisTask;
  shadowEvaluationId?: string;
  shadowCreatedAt?: number;
}
