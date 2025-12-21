import { AIProvider, SummaryRequest, SummaryOptions, ProviderInfo, ProfanityAnalysisResult, CriminalAnalysisResult } from './ai-provider';

export class MockProvider implements AIProvider {
  async summarize(request: SummaryRequest, options: SummaryOptions, env?: any): Promise<string> {
    console.log('MockProvider: summarize called');
    return 'Mock summary result';
  }

  async analyzeProfanity(text: string, env?: any): Promise<ProfanityAnalysisResult> {
    console.log('MockProvider: analyzeProfanity called with text:', text);
    
    // Simulate profanity detection for test phrases
    const profaneWords = ['убью', 'гнида', 'ебаная', 'тварь', 'пидорас', 'ебучий'];
    const foundWords: Array<{ word: string; baseForm: string; confidence: number }> = [];
    
    const lowerText = text.toLowerCase();
    
    for (const word of profaneWords) {
      if (lowerText.includes(word)) {
        foundWords.push({
          word: word,
          baseForm: word,
          confidence: 0.95
        });
      }
    }
    
    const result = {
      hasProfanity: foundWords.length > 0,
      words: foundWords
    };
    
    console.log('MockProvider: profanity analysis result:', result);
    return result;
  }

  async analyzeCriminalCode(text: string, env?: any): Promise<CriminalAnalysisResult> {
    console.log('MockProvider: analyzeCriminalCode called with text:', text);
    
    // Simulate criminal code analysis for threat phrases
    const threatWords = ['убью', 'убить', 'угроза', 'убийство'];
    const lowerText = text.toLowerCase();
    
    const violations = [];
    let totalSeverity = 0;
    
    for (const word of threatWords) {
      if (lowerText.includes(word)) {
        const violation = {
          article: 'Статья 119 УК РФ',
          quote: `Обнаружена угроза: "${word}"`,
          punishment: 'Штраф до 40 000 рублей или исправительные работы до 2 лет',
          severity: 6,
          confidence: 0.85
        };
        violations.push(violation);
        totalSeverity += violation.severity;
      }
    }
    
    let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (totalSeverity >= 8) riskLevel = 'critical';
    else if (totalSeverity >= 6) riskLevel = 'high';
    else if (totalSeverity >= 3) riskLevel = 'medium';
    
    const result = {
      hasViolations: violations.length > 0,
      violations,
      totalSeverity,
      riskLevel,
      analysisTimestamp: Date.now()
    };
    
    console.log('MockProvider: criminal code analysis result:', result);
    return result;
  }

  validateConfig(): void {
    console.log('MockProvider: config validation passed');
  }

  getProviderInfo(): ProviderInfo {
    return {
      name: 'mock',
      model: 'mock-model',
      version: '1.0.0'
    };
  }
}