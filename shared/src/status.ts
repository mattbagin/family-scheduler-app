import { hhmmToMin, weekdayMon, WEEKDAYS } from './time.ts';
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

/** Weekdays in a few words: “Mon–Fri”, “Every day”, “Mon, Wed, Fri”. */
export function daysLabel(days: number[]): string {
  const d = [...days].sort((a, b) => a - b);
  if (d.length === 7) return 'Every day';
  const short = (i: number) => WEEKDAYS[i].slice(0, 3);
  const run = d.length > 2 && d.every((x, i) => !i || x === d[i - 1] + 1);
  return run ? `${short(d[0])}–${short(d[d.length - 1])}` : d.map(short).join(', ');
}
