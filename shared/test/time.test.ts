import { describe, expect, it } from 'vitest';
import { dayWithDate } from '../src/time.ts';

describe('dayWithDate', () => {
  it('says the date once, near or far', () => {
    expect(dayWithDate('2026-10-09', '2026-10-10')).toBe('Tomorrow, Oct 10');
    expect(dayWithDate('2026-10-09', '2026-10-13')).toBe('Tuesday, Oct 13');
    expect(dayWithDate('2026-10-09', '2026-10-16')).toBe('Fri, Oct 16');
  });
});
