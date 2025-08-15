import { describe, it, expect } from 'vitest';
import { htmlFormatting, HTMLBuilder, getSeverityEmoji, escapeHtml } from '../src/html-formatting';

describe('HTML Formatting Integration', () => {
  it('should provide all components through main export', () => {
    expect(htmlFormatting.builder).toBeInstanceOf(HTMLBuilder);
    expect(htmlFormatting.utils.getSeverityEmoji).toBe(getSeverityEmoji);
    expect(htmlFormatting.utils.escapeHtml).toBe(escapeHtml);
  });

  it('should create a complete violation message using all components', () => {
    const builder = new HTMLBuilder();
    
    const violationData = {
      article: '282 УК РФ',
      quote: 'Текст с <script>alert("xss")</script>',
      punishment: 'Штраф до 300 000 рублей',
      severity: 8,
      confidence: 0.75
    };

    const message = builder.buildViolationMessage(violationData);
    
    // Should contain escaped HTML
    expect(message).toContain('&lt;script&gt;');
    expect(message).not.toContain('<script>');
    
    // Should contain severity emoji
    expect(message).toContain('🔴'); // High severity
    
    // Should contain formatted elements
    expect(message).toContain('<b>Статья 282 УК РФ</b>');
    expect(message).toContain('<b>Серьезность:</b> 8/10');
    expect(message).toContain('<b>Уровень доверия:</b> 75%');
  });

  it('should create formatted statistics using utilities', () => {
    const { utils } = htmlFormatting;
    
    const statsItems = [
      utils.createListItem('Всего нарушений', 15, utils.getSeverityEmoji(7)),
      utils.createListItem('Средняя серьезность', '6.2', utils.getSeverityEmoji(6)),
      utils.createListItem('Последнее нарушение', 'Вчера')
    ];
    
    const statsMessage = utils.createSection('Статистика пользователя', statsItems.join('\n'));
    
    expect(statsMessage).toContain('<b>Статистика пользователя</b>');
    expect(statsMessage).toContain('🔴 <b>Всего нарушений:</b> 15');
    expect(statsMessage).toContain('🟡 <b>Средняя серьезность:</b> 6.2');
    expect(statsMessage).toContain('<b>Последнее нарушение:</b> Вчера');
  });

  it('should handle edge cases properly', () => {
    const builder = new HTMLBuilder();
    
    // Test with minimal data
    const minimalData = {
      article: '1',
      quote: '',
      punishment: '',
      severity: 1,
      confidence: 1
    };

    const message = builder.buildViolationMessage(minimalData);
    expect(message).toContain('🟢'); // Low severity
    expect(message).toContain('<b>Статья 1 УК РФ</b>');
    
    // Test with low confidence
    const lowConfidenceData = {
      ...minimalData,
      confidence: 0.5
    };

    const lowConfidenceMessage = builder.buildViolationMessage(lowConfidenceData);
    expect(lowConfidenceMessage).toContain('⚠️');
    expect(lowConfidenceMessage).toContain('Низкий уровень доверия');
  });
});