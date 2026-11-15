import { describe, expect, it } from 'vitest';
import { guessEventStyle, guessTaskIcon } from '../src/icons.ts';

describe('event icons', () => {
  it('gives hockey a stick and skating a skate', () => {
    expect(guessEventStyle('Hockey practice')).toEqual({ icon: '🏒', category: 'sports' });
    expect(guessEventStyle('Skating lessons')).toEqual({ icon: '⛸️', category: 'sports' });
  });
});

describe('task icons', () => {
  it('matches the longer word first (plants are not plans)', () => {
    expect(guessTaskIcon('Water the plants')).toBe('🪴');
    expect(guessTaskIcon('Plan the menu')).toBe('📝');
  });
});
