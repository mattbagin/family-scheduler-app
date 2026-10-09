import type { LocalDateTime, Ymd } from './types.ts';

// All scheduling math works on wall-clock strings so DST changes never shift a 5 PM practice.

const pad = (n: number) => String(n).padStart(2, '0');
const parts = (s: Ymd) => s.split('-').map(Number) as [number, number, number];

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function ymd(d: Date): Ymd {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toLocalDateTime(d: Date): LocalDateTime {
  return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function parseYmd(s: Ymd): Date {
  const [y, m, d] = parts(s);
  return new Date(y, m - 1, d);
}

export function isYmd(s: unknown): s is Ymd {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseYmd(s).getTime());
}

export function isLocalDateTime(s: unknown): s is LocalDateTime {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) && minutesOf(s) < 1440;
}

export function datePart(s: LocalDateTime): Ymd {
  return s.slice(0, 10);
}

export function minutesOf(s: LocalDateTime): number {
  const [h, m] = s.slice(11, 16).split(':').map(Number);
  return h * 60 + m;
}

export function dayDiff(a: Ymd, b: Ymd): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export function addDays(s: Ymd, n: number): Ymd {
  const [y, m, d] = parts(s);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Adds months, clamping to the end of shorter months (Jan 31 + 1 month = Feb 28). */
export function addMonths(s: Ymd, n: number): Ymd {
  const [y, m, d] = parts(s);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(d, daysInMonth(ny, nm)))}`;
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayMon(s: Ymd): number {
  const [y, m, d] = parts(s);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function startOfWeek(s: Ymd): Ymd {
  return addDays(s, -weekdayMon(s));
}

export function withMinutes(date: Ymd, min: number): LocalDateTime {
  const days = Math.floor(min / 1440);
  const m = ((min % 1440) + 1440) % 1440;
  return `${addDays(date, days)}T${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function addMinutes(dt: LocalDateTime, n: number): LocalDateTime {
  return withMinutes(datePart(dt), minutesOf(dt) + n);
}

export function durationMin(start: LocalDateTime, end: LocalDateTime): number {
  return dayDiff(datePart(start), datePart(end)) * 1440 + minutesOf(end) - minutesOf(start);
}

/** Minutes from midnight of `today` (negative in the past, > 1440 on later days). */
export function absMin(today: Ymd, dt: LocalDateTime): number {
  return dayDiff(today, datePart(dt)) * 1440 + minutesOf(dt);
}

export function fmtTime(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${pad(m % 60)} ${h >= 12 ? 'PM' : 'AM'}`;
}

export function fmtDur(min: number): string {
  const x = Math.max(0, Math.round(min));
  if (x < 60) return `${x} min`;
  const h = Math.floor(x / 60);
  const m = x % 60;
  if (h >= 48 && !m) return `${Math.round(h / 24)} days`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function fmtShortDate(s: Ymd): string {
  const [, m, d] = parts(s);
  return `${MONTHS_SHORT[m - 1]} ${d}`;
}

/** "Today", "Tomorrow", "Thursday" (within a week), otherwise "Thu, Oct 8". */
export function dayLabel(today: Ymd, d: Ymd): string {
  const diff = dayDiff(today, d);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return WEEKDAYS[weekdayMon(d)];
  return `${WEEKDAYS[weekdayMon(d)].slice(0, 3)}, ${fmtShortDate(d)}`;
}

/** "Tomorrow, Oct 10" or "Fri, Oct 16": the date said once (dayLabel already carries it beyond a week). */
export function dayWithDate(today: Ymd, d: Ymd): string {
  const label = dayLabel(today, d);
  return label.includes(fmtShortDate(d)) ? label : `${label}, ${fmtShortDate(d)}`;
}

/** The instant a wall-clock time happens here (the family's time zone is the device's own). */
export function parseLocal(dt: LocalDateTime): Date {
  const [y, m, d] = parts(datePart(dt));
  const min = minutesOf(dt);
  return new Date(y, m - 1, d, Math.floor(min / 60), min % 60);
}
