import { describe, expect, it } from 'vitest';
import { DAY_OFF, daysLabel, isDayOff, statusAt, whereNow } from '../src/status.ts';
import type { Member, Occurrence } from '../src/types.ts';

describe('daily status', () => {
  const school = { icon: '🏫', label: 'At school', days: [0, 1, 2, 3, 4], start: '08:30', end: '15:15' };
  it('applies on its weekdays, inside its hours', () => {
    expect(statusAt([school], '2026-10-23', 9 * 60)).toBe(school); // a Friday
    expect(statusAt([school], '2026-10-23', 15 * 60 + 15)).toBeUndefined();
    expect(statusAt([school], '2026-10-24', 9 * 60)).toBeUndefined(); // Saturday
  });
  it('says the days briefly', () => {
    expect(daysLabel([4, 0, 1, 2, 3])).toBe('Mon–Fri');
    expect(daysLabel([0, 2, 4])).toBe('Mon, Wed, Fri');
    expect(daysLabel([0, 1])).toBe('Mon, Tue');
    expect(daysLabel([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
  });
});

describe('whereNow', () => {
  const D = '2026-10-23'; // a Friday
  const m = { id: 1, statuses: [] as any[] } as Member;
  const ev = (o: Record<string, unknown>) =>
    ({ title: 'Thing', icon: '📅', category: 'family', start: `${D}T10:00`, end: `${D}T11:00`, allDay: false, memberIds: [1], driverId: null, travelMin: 0, calendarId: null, ...o }) as Occurrence;
  const at = (h: number, mm = 0) => h * 60 + mm;
  const where = (min: number, occs: Occurrence[], mem = m, off: number[] = []) => whereNow(mem, D, min, occs, off);

  it('is on the road for the drive before an event they drive to', () => {
    const o = ev({ driverId: 1, memberIds: [2], travelMin: 20 });
    expect(where(at(9, 40), [o])).toEqual({ place: 'road', label: 'On the road' });
    expect(where(at(9, 39), [o]).place).toBe('home'); // before the drive
    expect(where(at(10, 0), [o]).place).toBe('home'); // arrived (driver isn't on the event)
  });
  it('road beats an event they are on and their status', () => {
    const drive = ev({ driverId: 1, memberIds: [2], travelMin: 30, start: `${D}T10:00`, end: `${D}T11:00` });
    const now = ev({ category: 'school', start: `${D}T09:00`, end: `${D}T10:30` });
    const mem = { ...m, statuses: [{ icon: '🏫', label: 'At school', days: [4], start: '08:00', end: '16:00' }] } as Member;
    expect(where(at(9, 45), [now, drive], mem)).toEqual({ place: 'road', label: 'On the road' });
    expect(where(at(9, 45), [now], mem).place).toBe('school'); // without the drive it's the event
  });
  it('puts them where their event is, by icon then category', () => {
    expect(where(at(10, 30), [ev({ icon: '🏊', title: 'Swim' })])).toEqual({ place: 'pool', label: 'Swim' });
    expect(where(at(10, 30), [ev({ icon: '⛸️', category: 'sports' })]).place).toBe('rink'); // stored form, with the variation selector
    expect(where(at(10, 30), [ev({ icon: '⛸', category: 'sports' })]).place).toBe('rink');
    expect(where(at(10, 30), [ev({ icon: '🏒' })]).place).toBe('rink');
    for (const [category, place] of [['school', 'school'], ['sports', 'field'], ['medical', 'clinic'], ['work', 'office'], ['playdate', 'out']])
      expect(where(at(10, 30), [ev({ category })]).place, category).toBe(place);
    expect(where(at(10, 30), [ev({ title: 'Party', icon: '🎈', category: 'playdate' })])).toEqual({ place: 'out', label: 'Party', icon: '🎈' });
    expect(where(at(11, 0), [ev({ category: 'school' })]).place).toBe('home'); // end is exclusive
  });
  it('ignores all-day events and other people’s events; the later start wins', () => {
    expect(where(at(10, 30), [ev({ allDay: true, category: 'school' })]).place).toBe('home');
    expect(where(at(10, 30), [ev({ category: 'school', memberIds: [2] })]).place).toBe('home');
    const a = ev({ title: 'A', category: 'school', start: `${D}T09:00` });
    const b = ev({ title: 'B', category: 'medical', start: `${D}T10:00` });
    expect(where(at(10, 30), [a, b])).toEqual({ place: 'clinic', label: 'B' });
    expect(where(at(10, 30), [b, a]).label).toBe('B');
  });
  it('falls back to the daily status, then home; events beat statuses', () => {
    const st = (icon: string, label = 'Somewhere') => ({ icon, label, days: [4], start: '08:00', end: '16:00' });
    const withSt = (icon: string) => ({ ...m, statuses: [st(icon)] }) as Member;
    for (const [icon, place] of [['🏢', 'office'], ['💼', 'office'], ['🏫', 'school'], ['🧸', 'daycare'], ['🏠', 'home']])
      expect(where(at(12), [], withSt(icon)), icon).toEqual({ place, label: 'Somewhere' });
    for (const [icon, place] of [['🏢️', 'office'], ['🏠️', 'home'], ['🏫️', 'school']]) // with the variation selector
      expect(where(at(12), [], withSt(icon)).place, icon).toBe(place);
    expect(where(at(12), [], withSt('🏖️'))).toEqual({ place: 'out', label: 'Somewhere', icon: '🏖️' });
    expect(where(at(10, 30), [ev({ category: 'medical' })], withSt('🏫')).place).toBe('clinic');
    expect(where(at(17), [], withSt('🏫'))).toEqual({ place: 'home', label: 'At home' });
  });
  it('hides a status on a day off', () => {
    const mem = { ...m, statuses: [{ icon: '🏫', label: 'At school', days: [4], start: '08:00', end: '16:00' }] } as Member;
    const off = { title: 'PA Day', start: `${D}T00:00`, end: `2026-10-24T00:00`, allDay: true, memberIds: [], calendarId: null } as unknown as Occurrence;
    expect(where(at(12), [off], mem)).toEqual({ place: 'home', label: 'At home' });
  });
});

describe('days off', () => {
  const allDay = (title: string, start: string, end: string, memberIds: number[] = [], calendarId: number | null = null) =>
    ({ title, start: `${start}T00:00`, end: `${end}T00:00`, allDay: true, memberIds, calendarId }) as Occurrence;
  it('knows day-off words, but not look-alikes', () => {
    for (const t of ['PA Day', 'P.A. day', 'PD day', 'Vacation 🏝️', 'Day off', 'Sick', 'March Break', 'No school', 'Stat holiday']) expect(DAY_OFF.test(t), t).toBe(true);
    for (const t of ['Holiday concert', 'Breakfast with Santa', 'SickKids appointment', 'Paday', 'Swim']) expect(DAY_OFF.test(t), t).toBe(false);
  });
  it('applies to the people on the event, through its last day', () => {
    const trip = [allDay('Vacation', '2026-10-21', '2026-10-24', [1])];
    expect(isDayOff(1, '2026-10-23', trip, [])).toBe(true);
    expect(isDayOff(1, '2026-10-24', trip, [])).toBe(false); // the end is exclusive
    expect(isDayOff(2, '2026-10-23', trip, [])).toBe(false);
  });
  it('counts every event on a days-off calendar, for everyone when it has nobody', () => {
    const hols = [allDay('Thanksgiving', '2026-10-12', '2026-10-13', [], 7)];
    expect(isDayOff(3, '2026-10-12', hols, [7])).toBe(true);
    expect(isDayOff(3, '2026-10-12', hols, [])).toBe(false);
    expect(isDayOff(3, '2026-10-12', [{ ...hols[0], allDay: false }], [7])).toBe(false);
  });
});
