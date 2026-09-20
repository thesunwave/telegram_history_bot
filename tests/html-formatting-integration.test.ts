import { describe, it, expect } from 'vitest';
import { HTMLBuilder, getSeverityEmoji, createSection, createListItem } from '../src/core/html-formatting';

describe('HTML Formatting Integration', () => {
  it('should create formatted statistics using utilities', () => {
    const statsItems = [
      createListItem('Всего нарушений', 15, getSeverityEmoji(7)),
      createListItem('Средняя серьезность', '6.2', getSeverityEmoji(6)),
      createListItem('Последнее нарушение', 'Вчера')
    ];
    
    const statsMessage = createSection('Статистика пользователя', statsItems.join('\n'));
    
    expect(statsMessage).toContain('<b>Статистика пользователя</b>');
    expect(statsMessage).toContain('🔴 <b>Всего нарушений:</b> 15');
    expect(statsMessage).toContain('🟡 <b>Средняя серьезность:</b> 6.2');
    expect(statsMessage).toContain('<b>Последнее нарушение:</b> Вчера');
  });
});