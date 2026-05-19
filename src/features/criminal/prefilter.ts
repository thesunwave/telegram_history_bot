export type CriminalPrefilterReason =
  | 'command'
  | 'empty'
  | 'too_short'
  | 'semantic_prefilter';

export interface CriminalPrefilterInput {
  text?: string;
  isCommand?: boolean;
  previousTexts?: string[];
}

export interface CriminalPrefilterResult {
  shouldQueue: boolean;
  reasons: CriminalPrefilterReason[];
}

const MIN_SIGNAL_LENGTH = 8;

export function criminalPrefilter(input: CriminalPrefilterInput): CriminalPrefilterResult {
  const text = input.text?.trim() || '';

  if (!text) {
    return { shouldQueue: false, reasons: ['empty'] };
  }
  if (input.isCommand || text.startsWith('/')) {
    return { shouldQueue: false, reasons: ['command'] };
  }
  if (text.length < MIN_SIGNAL_LENGTH) {
    return { shouldQueue: false, reasons: ['too_short'] };
  }

  return { shouldQueue: true, reasons: ['semantic_prefilter'] };
}
