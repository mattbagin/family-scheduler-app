import { describe, expect, it } from 'vitest';
import { computeFlags } from '../src/flags.ts';
import { parseQuickAdd } from '../src/quickadd.ts';
import type { Member, Occurrence } from '../src/types.ts';

const members: Member[] = [
  { id: 1, name: 'Mom', role: 'adult', color: '#D9487A', avatar: '👩', hasPin: true, sort: 0 },
  { id: 2, name: 'Dad', role: 'adult', color: '#2F7DE1', avatar: '👨', hasPin: true, sort: 1 },
  { id: 3, name: 'Emma', role: 'kid', color: '#DB8616', avatar: '👧', hasPin: false, sort: 2 },
  { id: 4, name: 'Leo', role: 'kid', color: '#1F9C62', avatar: '👦', hasPin: false, sort: 3 },
];
const MONDAY = '2026-09-28';

describe('parseQuickAdd', () => {
  it('reads title, day, time, person, repeat and place', () => {
    const r = parseQuickAdd('Swim Tuesday 4pm Emma weekly at Aquatic Centre', members, MONDAY)!;
    expect(r).toMatchObject({ title: 'Swim', date: '2026-09-29', startMin: 16 * 60, memberIds: [3], weekly: true, location: 'Aquatic Centre', icon: '🏊', category: 'sports' });
  });

  it('keeps "with" in titles and handles minutes', () => {
    const r = parseQuickAdd('Playdate with Noah Friday 3:30pm Leo', members, MONDAY)!;
    expect(r).toMatchObject({ title: 'Playdate with Noah', date: '2026-10-02', startMin: 15 * 60 + 30, memberIds: [4] });
  });

  it('understands tomorrow, family and bare afternoon hours', () => {
    const r = parseQuickAdd('Pizza night tomorrow at 6 family', members, MONDAY)!;
    expect(r).toMatchObject({ title: 'Pizza night', date: '2026-09-29', startMin: 18 * 60, memberIds: [1, 2, 3, 4] });
  });

  it('treats a weekday that is today as today, and "next" as a week later', () => {
    expect(parseQuickAdd('Dentist Monday 10am Dad', members, MONDAY)!.date).toBe(MONDAY);
    expect(parseQuickAdd('Dentist next Monday 10am Dad', members, MONDAY)!.date).toBe('2026-10-05');
  });

  it('leaves unknown parts empty', () => {
    expect(parseQuickAdd('Call the plumber', members, MONDAY)).toMatchObject({ title: 'Call the plumber', date: null, startMin: null, memberIds: [] });
    expect(parseQuickAdd('   ', members, MONDAY)).toBeNull();
  });
});

describe('computeFlags', () => {
  const occ = (key: string, start: string, end: string, over: Partial<Occurrence> = {}): Occurrence => ({
    id: Number(key), key, originalDate: start.slice(0, 10), isException: false, calendarId: null, title: key, kidTitle: null,
    icon: '📅', category: 'family', start, end, allDay: false, rrule: null, location: null, notes: null, bring: null,
    travelMin: 0, driverId: null, needsDriver: false, fun: false, memberIds: [], planId: null, ...over,
  });

  it('flags a kid in two places, a double-booked driver and a missing ride', () => {
    const flags = computeFlags([
      occ('1', '2026-09-29T17:00', '2026-09-29T17:45', { memberIds: [3], driverId: 1 }),
      occ('2', '2026-09-29T17:30', '2026-09-29T18:00', { memberIds: [3, 4], driverId: 1 }),
      occ('3', '2026-09-29T19:00', '2026-09-29T20:00', { memberIds: [4], needsDriver: true }),
    ], members);
    expect(flags.get('1')?.map((f) => f.text)).toEqual(['Overlap', 'Mom double-booked']);
    expect(flags.get('3')).toEqual([{ kind: 'warn', text: 'Needs a ride' }]);
  });

  it('ignores back-to-back events and work', () => {
    const flags = computeFlags([
      occ('1', '2026-09-29T08:00', '2026-09-29T09:00', { memberIds: [3] }),
      occ('2', '2026-09-29T09:00', '2026-09-29T10:00', { memberIds: [3] }),
    ], members);
    expect(flags.size).toBe(0);
  });
});
