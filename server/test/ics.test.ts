import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { expandDates } from '../../shared/src/index.ts';
import { parseIcs } from '../src/ics/parse.ts';
import { normalizeFeedUrl, upcomingOf } from '../src/ics/sync.ts';
import { resolveZone, utcToLocal, zonedToUtc } from '../src/ics/zones.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const ZONE = 'America/Toronto';

describe('time zones', () => {
  it('converts between instants and wall clocks, across DST', () => {
    expect(utcToLocal(Date.UTC(2026, 6, 1, 16, 0), ZONE)).toBe('2026-07-01T12:00'); // EDT, UTC-4
    expect(utcToLocal(Date.UTC(2026, 11, 1, 17, 0), ZONE)).toBe('2026-12-01T12:00'); // EST, UTC-5
    expect(zonedToUtc(2026, 11, 2, 9, 0, 0, ZONE)).toBe(Date.UTC(2026, 10, 2, 14, 0)); // day after DST ends
    expect(zonedToUtc(2026, 10, 31, 9, 0, 0, ZONE)).toBe(Date.UTC(2026, 9, 31, 13, 0)); // day before
  });

  it('recognizes IANA, prefixed and Windows zone names', () => {
    expect(resolveZone('Europe/London')).toBe('Europe/London');
    expect(resolveZone('/mozilla.org/20050126_1/America/New_York')).toBe('America/New_York');
    expect(resolveZone('Pacific Standard Time')).toBe('America/Los_Angeles');
    expect(resolveZone('Somewhere/Nowhere Standard')).toBeNull();
  });
});

describe('parseIcs: school feed', () => {
  const cal = parseIcs(fixture('school.ics'), ZONE);
  const byUid = new Map(cal.events.map((e) => [e.uid, e]));

  it('reads the calendar name and skips cancelled events', () => {
    expect(cal.name).toBe('Lincoln Elementary');
    expect(byUid.has('cancelled@lincoln')).toBe(false);
    expect(cal.events).toHaveLength(8);
  });

  it('reads all-day events with escaped text', () => {
    expect(byUid.get('pd-day@lincoln')).toMatchObject({
      title: 'PD Day - no school', allDay: true, start: '2026-10-09T00:00', end: '2026-10-10T00:00',
      notes: 'No classes today, daycare open.\nBring a lunch.',
    });
  });

  it('keeps repeat rules, localizes UNTIL, and turns EXDATE and RECURRENCE-ID into skipped dates', () => {
    const pta = byUid.get('pta@lincoln')!;
    expect(pta).toMatchObject({
      start: '2026-09-08T19:00', end: '2026-09-08T20:30', location: 'Library, Room 12', notes: null,
      rrule: 'FREQ=MONTHLY;BYDAY=2TU;UNTIL=20270615', exdates: ['2026-11-10', '2026-12-08'],
    });
    expect(byUid.get('pta@lincoln#2026-11-10')).toMatchObject({
      title: 'PTA meeting (moved for Remembrance Day)', start: '2026-11-12T18:30', end: '2026-11-12T20:00', rrule: null,
    });
  });

  it('converts UTC and other zones to family time, and unfolds long lines', () => {
    expect(byUid.get('concert@lincoln')).toMatchObject({
      title: 'Winter concert with a very long title that goes on and is folded', start: '2026-12-17T18:00', end: '2026-12-17T19:30',
    });
    expect(byUid.get('london@lincoln')).toMatchObject({ start: '2026-10-20T10:00', end: '2026-10-20T11:00' });
    expect(byUid.get('outlook@lincoln')).toMatchObject({ start: '2026-10-21T12:00', end: '2026-10-21T13:00' });
  });

  it('falls back to a single date for rules it cannot expand, and says so', () => {
    expect(byUid.get('weird@lincoln')!.rrule).toBeNull();
    expect(cal.warnings.some((w) => w.includes('Week 36 thing'))).toBe(true);
  });

  it('previews the next occurrences, honouring COUNT and skipped dates', () => {
    const next = upcomingOf(cal.events, '2026-09-14', '2026-12-31', 50);
    expect(next.filter((o) => o.title === 'Hot lunch').map((o) => o.start.slice(0, 10))).toEqual([
      '2026-09-14', '2026-09-16', '2026-09-18', '2026-09-21', '2026-09-23', '2026-09-25',
    ]);
    // 2nd Tuesdays, minus the moved November meeting and the skipped December one.
    expect(next.filter((o) => o.title === 'PTA meeting').map((o) => o.start)).toEqual(['2026-10-13T19:00']);
  });
});

describe('parseIcs: a real public holidays feed', () => {
  const cal = parseIcs(fixture('us-holidays.ics'), ZONE);

  it('reads every event as an all-day holiday', () => {
    expect(cal.name).toBe('Holidays in United States');
    expect(cal.events.length).toBeGreaterThan(300);
    expect(cal.warnings).toEqual([]);
    expect(cal.events.every((e) => e.allDay && e.end > e.start)).toBe(true);
  });

  it('agrees with our own yearly rule for Thanksgiving (4th Thursday of November)', () => {
    const feed = cal.events.filter((e) => e.title === 'Thanksgiving Day').map((e) => e.start.slice(0, 10)).sort();
    expect(feed.length).toBeGreaterThan(5);
    const ours = expandDates('2021-11-25', 'FREQ=YEARLY;BYMONTH=11;BYDAY=4TH', feed[0], `${Number(feed.at(-1)!.slice(0, 4)) + 1}-01-01`);
    expect(ours).toEqual(feed);
  });
});

describe('parseIcs: bad input', () => {
  it('rejects a web page with a helpful message', () => {
    expect(() => parseIcs('<!doctype html><html>Sign in</html>', ZONE)).toThrow(/iCal/);
  });

  it('keeps one copy of a repeated single-occurrence change (the highest SEQUENCE)', () => {
    const ev = (lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];
    const text = ['BEGIN:VCALENDAR',
      ...ev(['UID:x', 'DTSTART:20261005T090000', 'RRULE:FREQ=WEEKLY', 'SUMMARY:Class']),
      ...ev(['UID:x', 'RECURRENCE-ID:20261012T090000', 'SEQUENCE:2', 'DTSTART:20261012T110000', 'SUMMARY:Class (late start)']),
      ...ev(['UID:x', 'RECURRENCE-ID:20261012T090000', 'SEQUENCE:1', 'DTSTART:20261012T100000', 'SUMMARY:Class (old)']),
      'END:VCALENDAR'].join('\r\n');
    const cal = parseIcs(text, ZONE);
    expect(cal.events.map((e) => [e.uid, e.title, e.start])).toEqual([
      ['x', 'Class', '2026-10-05T09:00'],
      ['x#2026-10-12', 'Class (late start)', '2026-10-12T11:00'],
    ]);
    expect(cal.events[0].exdates).toEqual(['2026-10-12']);
  });
});

describe('normalizeFeedUrl', () => {
  it('turns webcal links into https and rejects other schemes', () => {
    expect(normalizeFeedUrl('webcal://example.com/cal.ics')).toBe('https://example.com/cal.ics');
    expect(normalizeFeedUrl('  https://example.com/a b.ics ')).toBe('https://example.com/a%20b.ics');
    expect(() => normalizeFeedUrl('ftp://example.com/cal.ics')).toThrow(/https/);
    expect(() => normalizeFeedUrl('not a link')).toThrow();
  });
});
