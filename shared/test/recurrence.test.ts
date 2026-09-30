import { describe, expect, it } from 'vitest';
import { describeRRule, expandDates, expandEvent, formatRRule, parseRRule, presetToRRule, rruleToPreset } from '../src/recurrence.ts';
import { addMonths, dayLabel, fmtTime, withMinutes } from '../src/time.ts';
import type { EventRecord, OccurrencePatch } from '../src/types.ts';

const event = (over: Partial<EventRecord> = {}): EventRecord => ({
  id: 1, calendarId: null, title: 'Soccer', kidTitle: null, icon: '⚽', category: 'sports',
  start: '2026-09-01T16:30', end: '2026-09-01T17:30', allDay: false, rrule: null, location: null, notes: null,
  bring: null, travelMin: 0, driverId: null, needsDriver: false, fun: false, memberIds: [3], planId: null, ...over,
});

describe('parseRRule / formatRRule', () => {
  it('round-trips a weekly rule', () => {
    const r = parseRRule('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;UNTIL=20261231T235959Z');
    expect(r).toEqual({ freq: 'WEEKLY', interval: 2, byDay: [1, 3], until: '2026-12-31' });
    expect(formatRRule(r)).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;UNTIL=20261231');
  });

  it('rejects rules it cannot expand', () => {
    expect(() => parseRRule('FREQ=HOURLY')).toThrow();
  });
});

describe('expandDates', () => {
  it('expands weekdays within the window only', () => {
    // 2026-09-28 is a Monday.
    const dates = expandDates('2026-09-01', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', '2026-09-26', '2026-10-03');
    expect(dates).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
  });

  it('uses the start weekday when BYDAY is missing, and honours INTERVAL', () => {
    // 2026-09-01 is a Tuesday.
    expect(expandDates('2026-09-01', 'FREQ=WEEKLY;INTERVAL=2', '2026-09-01', '2026-10-01')).toEqual(['2026-09-01', '2026-09-15', '2026-09-29']);
  });

  it('stops at UNTIL (inclusive) and COUNT', () => {
    expect(expandDates('2026-09-01', 'FREQ=DAILY;UNTIL=20260903', '2026-09-01', '2026-09-10')).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(expandDates('2026-09-01', 'FREQ=DAILY;COUNT=5', '2026-09-04', '2026-09-30')).toEqual(['2026-09-04', '2026-09-05']);
  });

  it('clamps monthly rules to short months', () => {
    expect(expandDates('2026-01-31', 'FREQ=MONTHLY', '2026-01-01', '2026-04-01')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  it('keeps wall-clock times across a DST change', () => {
    // US DST ends 2026-11-01; a 4:30 PM practice stays at 4:30 PM.
    const occ = expandEvent(event({ rrule: 'FREQ=WEEKLY;BYDAY=SA,SU' }), new Map(), '2026-10-31', '2026-11-02');
    expect(occ.map((o) => o.start)).toEqual(['2026-10-31T16:30', '2026-11-01T16:30']);
  });
});

describe('rules from subscribed feeds', () => {
  it('expands numbered weekdays: 2nd Tuesday and last Friday', () => {
    expect(expandDates('2026-09-08', 'FREQ=MONTHLY;BYDAY=2TU', '2026-09-01', '2026-12-01')).toEqual(['2026-09-08', '2026-10-13', '2026-11-10']);
    expect(expandDates('2026-09-25', 'FREQ=MONTHLY;BYDAY=-1FR', '2026-09-01', '2026-12-01')).toEqual(['2026-09-25', '2026-10-30', '2026-11-27']);
  });

  it('expands BYMONTHDAY (including from the end) and BYSETPOS', () => {
    expect(expandDates('2026-09-15', 'FREQ=MONTHLY;BYMONTHDAY=1,15', '2026-09-01', '2026-11-01')).toEqual(['2026-09-15', '2026-10-01', '2026-10-15']);
    expect(expandDates('2026-01-31', 'FREQ=MONTHLY;BYMONTHDAY=-1', '2026-01-01', '2026-04-01')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    // Last weekday of the month.
    expect(expandDates('2026-10-30', 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', '2026-10-01', '2027-01-01')).toEqual(['2026-10-30', '2026-11-30', '2026-12-31']);
  });

  it('expands yearly rules with a month and numbered weekday', () => {
    expect(expandDates('2026-11-26', 'FREQ=YEARLY;BYMONTH=11;BYDAY=4TH', '2026-01-01', '2029-01-01')).toEqual(['2026-11-26', '2027-11-25', '2028-11-23']);
  });

  it('rejects parts it would otherwise misread', () => {
    expect(() => parseRRule('FREQ=YEARLY;BYWEEKNO=20')).toThrow();
    expect(() => parseRRule('FREQ=YEARLY;BYDAY=20MO')).toThrow();
    expect(() => parseRRule('FREQ=WEEKLY;BYDAY=XX')).toThrow();
  });

  it('round-trips and describes the new parts', () => {
    expect(formatRRule(parseRRule('FREQ=MONTHLY;BYDAY=2TU;UNTIL=20270615'))).toBe('FREQ=MONTHLY;BYDAY=2TU;UNTIL=20270615');
    expect(describeRRule('FREQ=MONTHLY;BYDAY=2TU')).toBe('Monthly on the 2nd Tue');
    expect(describeRRule('FREQ=MONTHLY;BYDAY=-1FR')).toBe('Monthly on the last Fri');
    expect(describeRRule('FREQ=YEARLY;BYMONTH=11;BYDAY=4TH')).toBe('Yearly on the 4th Thu in Nov');
  });
});

describe('expandEvent', () => {
  const weekly = event({ rrule: 'FREQ=WEEKLY;BYDAY=TU', driverId: 2 });

  it('applies moved, cancelled and driver patches to single occurrences', () => {
    const patches = new Map<string, OccurrencePatch>([
      ['2026-09-08', { cancelled: true }],
      ['2026-09-15', { start: '2026-09-17T18:00' }],
      ['2026-09-22', { driverId: 1 }],
    ]);
    const occ = expandEvent(weekly, patches, '2026-09-07', '2026-09-28');
    expect(occ.map((o) => [o.start, o.end, o.driverId, o.key])).toEqual([
      ['2026-09-17T18:00', '2026-09-17T19:00', 2, '1:2026-09-15'],
      ['2026-09-22T16:30', '2026-09-22T17:30', 1, '1:2026-09-22'],
    ]);
  });

  it('finds an occurrence moved into the window from outside it', () => {
    const patches = new Map<string, OccurrencePatch>([['2026-10-06', { start: '2026-09-30T10:00' }]]);
    const occ = expandEvent(weekly, patches, '2026-09-30', '2026-10-01');
    expect(occ).toHaveLength(1);
    expect(occ[0].originalDate).toBe('2026-10-06');
  });

  it('includes a one-off event only when it overlaps the window', () => {
    const single = event({ start: '2026-09-30T23:00', end: '2026-10-01T01:00' });
    expect(expandEvent(single, new Map(), '2026-10-01', '2026-10-02')).toHaveLength(1);
    expect(expandEvent(single, new Map(), '2026-10-02', '2026-10-03')).toHaveLength(0);
  });
});

describe('repeat presets', () => {
  it('converts both ways', () => {
    expect(presetToRRule('weekly', [1, 3])).toBe('FREQ=WEEKLY;BYDAY=TU,TH');
    expect(rruleToPreset('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR').preset).toBe('weekdays');
    expect(rruleToPreset('FREQ=WEEKLY;INTERVAL=2;BYDAY=SA')).toEqual({ preset: 'biweekly', weekdays: [5] });
  });
});

describe('time helpers', () => {
  it('formats and rolls over', () => {
    expect(fmtTime(16 * 60 + 5)).toBe('4:05 PM');
    expect(fmtTime(0)).toBe('12:00 AM');
    expect(withMinutes('2026-09-30', 1440 + 30)).toBe('2026-10-01T00:30');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(dayLabel('2026-09-28', '2026-09-29')).toBe('Tomorrow');
    expect(dayLabel('2026-09-28', '2026-10-01')).toBe('Thursday');
    expect(dayLabel('2026-09-28', '2026-10-09')).toBe('Fri, Oct 9');
  });
});
