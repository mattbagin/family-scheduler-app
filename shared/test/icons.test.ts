import { describe, expect, it } from 'vitest';
import { guessTaskIcon } from '../src/icons.ts';

describe('task icons', () => {
  it('matches the longer word first (plants are not plans)', () => {
    expect(guessTaskIcon('Water the plants')).toBe('🪴');
    expect(guessTaskIcon('Plan the menu')).toBe('📝');
  });
});
