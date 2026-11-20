import { absMin, hhmmToMin, weekdayMon, WEEKDAYS } from './time.ts';
import type { DailyStatus, Member, Occurrence, Ymd } from './types.ts';

/** All-day event titles that mean someone isn’t where they usually are (“PA day”, “Vacation”, “March Break”). */
export const DAY_OFF = /\b(p\.?a\.? day|p\.?d\.? day|pro(fessional)? d(evelopment)? day|vacation|day off|off work|no school|sick( day)?|pto|stat(utory)? holiday|(march|winter|spring|summer|christmas|holiday|reading) break)\b/i;

/**
 * Whether `day` is a day off for this person: an all-day event for them (or for nobody, meaning
 * everyone) that has a day-off title or comes from a calendar of days off, such as public holidays.
 */
export function isDayOff(memberId: number, day: Ymd, occs: Occurrence[], offCalendarIds: number[]): boolean {
  return occs.some((o) => o.allDay && o.start.slice(0, 10) <= day && day < o.end.slice(0, 10)
    && (!o.memberIds.length || o.memberIds.includes(memberId))
    && (DAY_OFF.test(o.title) || (o.calendarId !== null && offCalendarIds.includes(o.calendarId))));
}

/** The status someone is in on `day` at `min` minutes past midnight, if any. */
export function statusAt(statuses: DailyStatus[], day: Ymd, min: number): DailyStatus | undefined {
  const wd = weekdayMon(day);
  return statuses.find((s) => s.days.includes(wd) && hhmmToMin(s.start) <= min && min < hhmmToMin(s.end));
}

/** Where someone is right now: their status, unless the day is a day off for them. */
export function statusNow(m: Member, day: Ymd, min: number, occs: Occurrence[], offCalendarIds: number[]): DailyStatus | undefined {
  const s = statusAt(m.statuses, day, min);
  return s && !isDayOff(m.id, day, occs, offCalendarIds) ? s : undefined;
}

export const PLACES = ['home', 'office', 'school', 'daycare', 'field', 'rink', 'pool', 'clinic', 'road', 'out'] as const;
export type PlaceKey = typeof PLACES[number];

const bare = (e: string) => e.replaceAll('\uFE0F', '');

/**
 * Which place someone is at right now, for the ambient screen. First match wins: driving to an event
 * (the travel time before it starts), then an event they're on, then their daily status, then home.
 */
export function whereNow(m: Member, day: Ymd, min: number, occs: Occurrence[], offCalendarIds: number[]): { place: PlaceKey; label: string; icon?: string } {
  const timed = occs.filter((o) => !o.allDay);
  if (timed.some((o) => o.driverId === m.id && o.travelMin > 0 && absMin(day, o.start) - o.travelMin <= min && min < absMin(day, o.start))) {
    return { place: 'road', label: 'On the road' };
  }
  const ev = timed.filter((o) => o.memberIds.includes(m.id) && absMin(day, o.start) <= min && min < absMin(day, o.end))
    .sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0))[0];
  if (ev) {
    const icon = bare(ev.icon);
    const place: PlaceKey = icon === '🏊' ? 'pool' : icon === '⛸' || icon === '🏒' ? 'rink'
      : ev.category === 'school' ? 'school' : ev.category === 'sports' ? 'field' : ev.category === 'medical' ? 'clinic' : ev.category === 'work' ? 'office' : 'out';
    return place === 'out' && ev.icon ? { place, label: ev.title, icon: ev.icon } : { place, label: ev.title };
  }
  const s = statusNow(m, day, min, occs, offCalendarIds);
  if (s) {
    const icon = bare(s.icon);
    const place: PlaceKey | undefined = icon === '🏢' || icon === '💼' ? 'office' : icon === '🏫' ? 'school' : icon === '🧸' ? 'daycare' : icon === '🏠' ? 'home' : undefined;
    return place ? { place, label: s.label } : { place: 'out', label: s.label, icon: s.icon };
  }
  return { place: 'home', label: 'At home' };
}

/** Weekdays in a few words: “Mon–Fri”, “Every day”, “Mon, Wed, Fri”. */
export function daysLabel(days: number[]): string {
  const d = [...days].sort((a, b) => a - b);
  if (d.length === 7) return 'Every day';
  const short = (i: number) => WEEKDAYS[i].slice(0, 3);
  const run = d.length > 2 && d.every((x, i) => !i || x === d[i - 1] + 1);
  return run ? `${short(d[0])}–${short(d[d.length - 1])}` : d.map(short).join(', ');
}
