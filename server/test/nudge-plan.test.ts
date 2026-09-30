import { describe, expect, it } from 'vitest';
import type { Bill, Member, Occurrence, PrepItem } from '../../shared/src/index.ts';
import { planNudges, type PlanInput } from '../src/nudges/plan.ts';

const members: Member[] = [
  { id: 1, name: 'Mom', role: 'adult', color: '#D9487A', avatar: '👩', hasPin: true, sort: 0 },
  { id: 2, name: 'Dad', role: 'adult', color: '#2F7DE1', avatar: '👨', hasPin: true, sort: 1 },
  { id: 3, name: 'Emma', role: 'kid', color: '#DB8616', avatar: '👧', hasPin: false, sort: 2 },
];
const DAY = '2026-10-05';
const NEXT = '2026-10-06';

const occ = (id: number, start: string, end: string, over: Partial<Occurrence> = {}): Occurrence => ({
  id, key: `${id}:${start.slice(0, 10)}`, originalDate: start.slice(0, 10), isException: false, calendarId: null,
  title: 'Soccer practice', kidTitle: null, icon: '⚽', category: 'sports', start, end, allDay: false, rrule: null,
  location: 'Riverside Park', notes: null, bring: null, travelMin: 0, driverId: null, needsDriver: false, fun: false,
  memberIds: [3], planId: null, reminders: [], ...over,
});
const bill = (id: number, due: string, over: Partial<Bill> = {}): Bill => ({
  id, name: 'Hydro', icon: '💡', amountCents: 14260, due, monthly: true, autopay: false, paidAt: null, ...over,
});
const prep = (date: string, text: string): PrepItem => ({
  key: `todo:${text}`, date, text, icon: '🎒', memberIds: [3], done: false, eventId: null, eventTitle: null, startMin: null, todoId: 1,
});

const plan = (now: string, over: Partial<PlanInput> = {}) =>
  planNudges({ now, members, occurrences: [], prep: [], bills: [], todos: [], morningAt: '07:00', eveningAt: '19:30', ...over });
const keys = (now: string, over: Partial<PlanInput> = {}) => plan(now, over).map((n) => n.key);

describe('leave-by nudges', () => {
  const practice = occ(10, `${DAY}T16:30`, `${DAY}T17:30`, { travelMin: 15, driverId: 2 });

  it('fire at start − drive time − 10 minutes, until the start, to the driver', () => {
    expect(keys(`${DAY}T16:04`, { occurrences: [practice] })).toEqual([]);
    const [n] = plan(`${DAY}T16:05`, { occurrences: [practice] });
    expect(n).toMatchObject({
      key: `leave:10:${DAY}`, kind: 'leave_by', urgent: true, audience: [2],
      title: '🚗 Time to leave for Soccer practice', body: 'Dad is driving Emma to Riverside Park · starts 4:30 PM',
    });
    expect(keys(`${DAY}T16:29`, { occurrences: [practice] })).toHaveLength(1);
    expect(keys(`${DAY}T16:30`, { occurrences: [practice] })).toEqual([]);
  });

  it('go to every parent when nobody is driving a kid', () => {
    const [n] = plan(`${DAY}T16:10`, { occurrences: [{ ...practice, driverId: null }] });
    expect(n.audience).toEqual([1, 2]);
    expect(n.body).toMatch(/^Nobody is down to drive Emma/);
  });
});

describe('event reminders', () => {
  it('fire the chosen time before, including the day before', () => {
    const ev = occ(11, `${NEXT}T16:30`, `${NEXT}T17:30`, { reminders: [15, 1440], memberIds: [3, 1] });
    const dayBefore = plan(`${DAY}T16:30`, { occurrences: [ev] });
    expect(dayBefore).toHaveLength(1);
    expect(dayBefore[0]).toMatchObject({ key: `rem:11:${NEXT}:1440`, title: '⚽ Soccer practice tomorrow at 4:30 PM', audience: [1], urgent: false });
    const soon = plan(`${NEXT}T16:15`, { occurrences: [ev] }).find((n) => n.key.endsWith(':15'))!;
    expect(soon).toMatchObject({ title: '⚽ Soccer practice in 15 min', urgent: true });
  });
});

describe('daily digests', () => {
  it('send the evening digest from 7:30 PM with what to pack, only if there is something', () => {
    const tomorrow = [occ(12, `${NEXT}T08:30`, `${NEXT}T15:00`, { title: 'School', category: 'school' })];
    expect(keys(`${DAY}T19:29`, { occurrences: tomorrow })).toEqual([]);
    const [n] = plan(`${DAY}T19:30`, { occurrences: tomorrow, prep: [prep(NEXT, 'Gym shoes')] });
    expect(n).toMatchObject({ key: `evening:${DAY}`, title: '🎒 Pack for tomorrow: 1 thing', audience: [1, 2] });
    expect(n.body).toBe('Pack: Gym shoes (Emma)\n8:30 AM School (Emma)');
    expect(keys(`${DAY}T19:30`)).toEqual([]);
  });

  it('send the morning briefing from 7 AM until 11', () => {
    const today = [occ(13, `${DAY}T13:00`, `${DAY}T14:00`, { title: 'Dentist', memberIds: [1] })];
    expect(keys(`${DAY}T06:59`, { occurrences: today })).toEqual([]);
    expect(plan(`${DAY}T07:00`, { occurrences: today })[0]).toMatchObject({ title: '☀️ Today: 1 thing on', body: '1:00 PM Dentist (Mom)' });
    expect(keys(`${DAY}T11:00`, { occurrences: today })).toEqual([]);
  });
});

describe('bill nudges', () => {
  it('come 3 days before, the day before, on the day and daily once overdue, but not for autopay', () => {
    const due = (d: string) => keys(`${DAY}T09:00`, { bills: [bill(1, d)] });
    expect(due('2026-10-08')).toEqual(['bill:1:2026-10-08:3']);
    expect(due('2026-10-07')).toEqual([]);
    expect(due('2026-10-06')).toEqual(['bill:1:2026-10-06:1']);
    expect(due(DAY)).toContain(`bill:1:${DAY}:0`);
    expect(due('2026-10-03')).toContain(`bill:1:2026-10-03:late:${DAY}`);
    expect(keys(`${DAY}T09:00`, { bills: [bill(1, NEXT, { autopay: true })] })).toEqual([]);
    expect(keys(`${DAY}T06:59`, { bills: [bill(1, NEXT)] })).toEqual([]);
  });
});

describe('late briefings', () => {
  it('leave out what has already finished', () => {
    const today = [
      occ(20, `${DAY}T08:30`, `${DAY}T09:30`, { title: 'School run' }),
      occ(21, `${DAY}T13:00`, `${DAY}T14:00`, { title: 'Dentist', memberIds: [1] }),
    ];
    expect(plan(`${DAY}T10:15`, { occurrences: today })[0].body).toBe('1:00 PM Dentist (Mom)');
  });
});
