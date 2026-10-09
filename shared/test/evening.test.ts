import { describe, expect, it } from 'vitest';
import { eveningBoardDay } from '../src/nudges.ts';

const hub = { eveningStart: '19:30', nightEnd: '06:30' };
const at = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

describe('eveningBoardDay', () => {
  it('shows tomorrow from the evening until midnight', () => {
    expect(eveningBoardDay('2026-10-09', at('19:29'), hub)).toBeNull();
    expect(eveningBoardDay('2026-10-09', at('19:30'), hub)).toBe('2026-10-10');
    expect(eveningBoardDay('2026-10-31', at('23:59'), hub)).toBe('2026-11-01');
  });

  it('carries the same day through to the morning, then hands back to Today', () => {
    expect(eveningBoardDay('2026-10-10', at('00:00'), hub)).toBe('2026-10-10');
    expect(eveningBoardDay('2026-10-10', at('06:29'), hub)).toBe('2026-10-10');
    expect(eveningBoardDay('2026-10-10', at('06:30'), hub)).toBeNull();
    expect(eveningBoardDay('2026-10-10', at('12:00'), hub)).toBeNull();
  });

  it('is off when the evening has no start time', () => {
    expect(eveningBoardDay('2026-10-09', at('21:00'), { ...hub, eveningStart: null })).toBeNull();
  });
});
