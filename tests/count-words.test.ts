import { describe, expect, it } from 'vitest';
import { countWords } from '../src/api/update';

describe('countWords', () => {
  it('counts normal words', () => {
    expect(countWords('бля ор')).toBe(2);
    expect(countWords('hello world 123')).toBe(3);
  });

  it('ignores URLs when counting words', () => {
    expect(
      countWords('бля ор\n\nhttps://youtube.com/shorts/ErOEPMS9A8M?si=rSS8ed0edDidfyVE'),
    ).toBe(2);
    expect(countWords('смотри www.example.com/path?x=1 тест')).toBe(2);
  });
});
