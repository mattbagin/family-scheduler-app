import {
  absMin, addDays, dayDiff, dayLabel, DOOR_MIN, leaveByMin, minutesOf, WEEKDAYS, weekdayMon,
  type Occurrence, type Ymd,
} from '@shared';

/** Occurrences the main views share: today through ~6 weeks out (countdowns need the far end). */
export const mainRange = (today: Ymd) => ({ from: addDays(today, -1), to: addDays(today, 42) });

export const startAbs = (today: Ymd, o: Occurrence) => absMin(today, o.start);
export const endAbs = (today: Ymd, o: Occurrence) => absMin(today, o.end);
export const occDate = (o: Occurrence) => o.start.slice(0, 10);

/** Minutes after midnight (of the event's own day) when the driver should leave. */
export const leaveBy = (o: Occurrence) => leaveByMin(minutesOf(o.start), o.travelMin);

export interface PersonItem {
  occ: Occurrence;
  /** This person is driving someone else, not attending. */
  drive: boolean;
  /** Minutes relative to today's midnight. */
  s: number;
  e: number;
}

/** A person's own events plus the rides they're driving, in time order. */
export function personItems(today: Ymd, occs: Occurrence[], memberId: number): PersonItem[] {
  return occs
    .filter((o) => o.memberIds.includes(memberId) || o.driverId === memberId)
    .map((occ) => {
      const drive = !occ.memberIds.includes(memberId);
      const s = startAbs(today, occ);
      return drive
        ? { occ, drive, s: s - occ.travelMin - DOOR_MIN, e: s }
        : { occ, drive, s, e: endAbs(today, occ) };
    })
    .sort((a, b) => a.s - b.s);
}

export function dueLabel(today: Ymd, due: Ymd): string {
  const d = dayDiff(today, due);
  if (d < 0) return `${-d} day${d < -1 ? 's' : ''} overdue`;
  if (d === 0) return 'Due today';
  if (d === 1) return 'Due tomorrow';
  return `Due ${dayLabel(today, due)}`;
}

/** dayLabel for mid-sentence use: "due tomorrow" but "due Tuesday". */
export const relDay = (today: Ymd, d: Ymd) => {
  const l = dayLabel(today, d);
  return ['Today', 'Tomorrow', 'Yesterday'].includes(l) ? l.toLowerCase() : l;
};

export const shortWeekday = (d: Ymd) => WEEKDAYS[weekdayMon(d)].slice(0, 3);
export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
export const sleepsWord = (n: number) => `sleep${n === 1 ? '' : 's'}`;

/** "just now", "5 min ago", "3h ago", then a date. */
export function ago(iso: string, now = Date.now()): string {
  const min = Math.round((now - Date.parse(iso)) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.round(min / 60)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
