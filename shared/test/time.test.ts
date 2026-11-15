import { describe, expect, it } from 'vitest';
import { dayWithDate, isLocalDateTime, isYmd } from '../src/time.ts';

describe('isYmd / isLocalDateTime', () => {
  it('accept real dates and times only', () => {
    expect(isYmd('2026-02-28')).toBe(true);
    expect(isYmd('2028-02-29')).toBe(true);
    expect(isYmd('2026-02-31')).toBe(false);
    expect(isYmd('2026-13-01')).toBe(false);
    expect(isLocalDateTime('2026-02-28T23:59')).toBe(true);
    expect(isLocalDateTime('2026-02-28T10:75')).toBe(false);
    expect(isLocalDateTime('2026-02-28T24:00')).toBe(false);
    expect(isLocalDateTime('2026-02-31T10:00')).toBe(false);
  });
});

describe('dayWithDate', () => {
  it('says the date once, near or far', () => {
    expect(dayWithDate('2026-10-09', '2026-10-10')).toBe('Tomorrow, Oct 10');
    expect(dayWithDate('2026-10-09', '2026-10-13')).toBe('Tuesday, Oct 13');
    expect(dayWithDate('2026-10-09', '2026-10-16')).toBe('Fri, Oct 16');
  });
});
