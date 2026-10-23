import { describe, expect, it } from 'vitest';
import { DAY_OFF, daysLabel, isDayOff, statusAt } from '../src/status.ts';
import type { Occurrence } from '../src/types.ts';

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
