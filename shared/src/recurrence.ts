import {
  addDays, addMinutes, datePart, dayDiff, daysInMonth, durationMin, minutesOf, MONTHS_SHORT, startOfWeek, weekdayMon, withMinutes,
} from './time.ts';
import type { EventRecord, Occurrence, OccurrencePatch, Ymd } from './types.ts';

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface RRule {
  freq: Freq;
  interval: number;
  /** Weekdays, 0 = Monday … 6 = Sunday. */
  byDay?: number[];
  /** Numbered weekdays within the month: { n: 2, day: 1 } is the 2nd Tuesday, n: -1 the last. */
  byNthDay?: { n: number; day: number }[];
  /** Days of the month; negative counts from the end (-1 = last day). */
  byMonthDay?: number[];
  /** Months, 1 = January. */
  byMonth?: number[];
  /** Picks from each month's matches: 1 = first, -1 = last. */
  bySetPos?: number[];
  /** Last allowed date, inclusive. */
  until?: Ymd;
  count?: number;
}

const DAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const FREQS: Freq[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
/** Parts that would change which dates match; rather than guess, rules using them are rejected. */
const UNSUPPORTED = ['BYWEEKNO', 'BYYEARDAY', 'BYHOUR', 'BYMINUTE', 'BYSECOND', 'RSCALE'];

const intList = (s: string, lo: number, hi: number) =>
  s.split(',').map((x) => Number.parseInt(x, 10)).filter((n) => Number.isInteger(n) && n !== 0 && Math.abs(n) >= lo && Math.abs(n) <= hi);

export function parseRRule(s: string): RRule {
  const fields = new Map(
    s.replace(/^RRULE:/i, '').split(';').filter(Boolean).map((p) => {
      const [k, v = ''] = p.split('=');
      return [k.trim().toUpperCase(), v.trim()] as const;
    }),
  );
  const freq = fields.get('FREQ')?.toUpperCase() as Freq;
  if (!FREQS.includes(freq)) throw new Error(`Unsupported repeat rule: ${s}`);
  const bad = UNSUPPORTED.find((k) => fields.has(k));
  if (bad) throw new Error(`Unsupported repeat rule (${bad}): ${s}`);
  const rule: RRule = { freq, interval: Math.max(1, Number.parseInt(fields.get('INTERVAL') ?? '1', 10) || 1) };
  const byDay = fields.get('BYDAY');
  if (byDay) {
    for (const part of byDay.toUpperCase().split(',')) {
      const m = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/.exec(part.trim());
      if (!m) throw new Error(`Unsupported repeat rule: ${s}`);
      const day = DAY_CODES.indexOf(m[2]);
      const n = m[1] ? Number.parseInt(m[1], 10) : 0;
      // A number only means something for monthly and yearly rules; elsewhere it's just the weekday.
      if (n && (freq === 'MONTHLY' || freq === 'YEARLY')) (rule.byNthDay ??= []).push({ n, day });
      else if (!rule.byDay?.includes(day)) (rule.byDay ??= []).push(day);
    }
  }
  const byMonthDay = fields.get('BYMONTHDAY');
  if (byMonthDay) rule.byMonthDay = intList(byMonthDay, 1, 31);
  const byMonth = fields.get('BYMONTH');
  if (byMonth) rule.byMonth = intList(byMonth, 1, 12).filter((n) => n > 0);
  const bySetPos = fields.get('BYSETPOS');
  if (bySetPos) rule.bySetPos = intList(bySetPos, 1, 366);
  // "20th Monday of the year" style rules count across the whole year, which we don't expand.
  if (freq === 'YEARLY' && rule.byNthDay && !rule.byMonth) throw new Error(`Unsupported repeat rule: ${s}`);
  const until = fields.get('UNTIL');
  if (until && /^\d{8}/.test(until)) rule.until = `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`;
  const count = fields.get('COUNT');
  if (count) rule.count = Math.max(1, Number.parseInt(count, 10) || 1);
  return rule;
}

export function formatRRule(r: RRule): string {
  const out = [`FREQ=${r.freq}`];
  if (r.interval > 1) out.push(`INTERVAL=${r.interval}`);
  const days = [...(r.byNthDay ?? []).map((x) => `${x.n}${DAY_CODES[x.day]}`), ...[...(r.byDay ?? [])].sort().map((d) => DAY_CODES[d])];
  if (days.length) out.push(`BYDAY=${days.join(',')}`);
  if (r.byMonthDay?.length) out.push(`BYMONTHDAY=${r.byMonthDay.join(',')}`);
  if (r.byMonth?.length) out.push(`BYMONTH=${r.byMonth.join(',')}`);
  if (r.bySetPos?.length) out.push(`BYSETPOS=${r.bySetPos.join(',')}`);
  if (r.until) out.push(`UNTIL=${r.until.replaceAll('-', '')}`);
  if (r.count) out.push(`COUNT=${r.count}`);
  return out.join(';');
}

export function isValidRRule(s: string): boolean {
  try {
    parseRRule(s);
    return true;
  } catch {
    return false;
  }
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Days of month (y, m) a monthly or yearly rule lands on. With no BYDAY/BYMONTHDAY it's the
 * series' own day, clamped to short months (the 31st becomes Feb 28).
 */
function monthDays(r: RRule, y: number, m: number, startDay: number): number[] {
  const dim = daysInMonth(y, m);
  const weekdayRule = !!(r.byDay?.length || r.byNthDay?.length);
  if (!weekdayRule && !r.byMonthDay?.length) return [Math.min(startDay, dim)];
  let out: number[] = [];
  for (let day = 1; day <= dim; day++) {
    if (r.byMonthDay?.length && !r.byMonthDay.some((x) => (x > 0 ? x : dim + x + 1) === day)) continue;
    if (weekdayRule) {
      const wd = weekdayMon(`${y}-${pad2(m)}-${pad2(day)}`);
      const nth = r.byNthDay?.some((x) => x.day === wd && (x.n > 0 ? Math.ceil(day / 7) === x.n : Math.ceil((dim - day + 1) / 7) === -x.n));
      if (!nth && !r.byDay?.includes(wd)) continue;
    }
    out.push(day);
  }
  if (r.bySetPos?.length) {
    const all = out;
    out = [...new Set(r.bySetPos.map((p) => (p > 0 ? all[p - 1] : all[all.length + p])).filter((x) => x !== undefined))].sort((a, b) => a - b);
  }
  return out;
}

/** A test for "does the series starting at `start` land on date d?", caching per-month work. */
function matcher(r: RRule, start: Ymd): (d: Ymd) => boolean {
  const [sy, sm, sd] = start.split('-').map(Number);
  const cache = new Map<string, number[]>();
  const inMonth = (y: number, m: number, day: number) => {
    const k = `${y}-${m}`;
    let days = cache.get(k);
    if (!days) cache.set(k, (days = monthDays(r, y, m, sd)));
    return days.includes(day);
  };
  return (d) => {
    const diff = dayDiff(start, d);
    if (diff < 0) return false;
    const [y, m, day] = d.split('-').map(Number);
    const wd = weekdayMon(d);
    switch (r.freq) {
      case 'DAILY':
        return diff % r.interval === 0 && (!r.byDay?.length || r.byDay.includes(wd))
          && (!r.byMonth?.length || r.byMonth.includes(m)) && (!r.byMonthDay?.length || inMonth(y, m, day));
      case 'WEEKLY': {
        const weeks = Math.round(dayDiff(startOfWeek(start), startOfWeek(d)) / 7);
        const days = r.byDay?.length ? r.byDay : [weekdayMon(start)];
        return weeks % r.interval === 0 && days.includes(wd) && (!r.byMonth?.length || r.byMonth.includes(m));
      }
      case 'MONTHLY': {
        const months = (y - sy) * 12 + (m - sm);
        return months % r.interval === 0 && (!r.byMonth?.length || r.byMonth.includes(m)) && inMonth(y, m, day);
      }
      case 'YEARLY':
        return (y - sy) % r.interval === 0 && (r.byMonth?.length ? r.byMonth : [sm]).includes(m) && inMonth(y, m, day);
    }
  };
}

/** Dates in [from, to) on which a series starting at `start` occurs. */
export function expandDates(start: Ymd, rule: string | RRule, from: Ymd, to: Ymd): Ymd[] {
  const r = typeof rule === 'string' ? parseRRule(rule) : rule;
  const stop = r.until && r.until < to ? addDays(r.until, 1) : to;
  // COUNT needs every occurrence from the start; otherwise skip straight to the window.
  let d = r.count || start >= from ? start : from;
  let seen = 0;
  const out: Ymd[] = [];
  const matches = matcher(r, start);
  while (d < stop) {
    if (matches(d)) {
      seen++;
      if (r.count && seen > r.count) break;
      if (d >= from) out.push(d);
    }
    d = addDays(d, 1);
  }
  return out;
}

/**
 * Concrete occurrences of an event that overlap [from, to), with per-date patches applied
 * (moved, cancelled, or a different driver just for that day).
 */
export function expandEvent(
  ev: EventRecord,
  patches: ReadonlyMap<Ymd, OccurrencePatch>,
  from: Ymd,
  to: Ymd,
): Occurrence[] {
  const dur = durationMin(ev.start, ev.end);
  const startMin = minutesOf(ev.start);
  const base = datePart(ev.start);
  // Widen the window so a long event or one moved into range from nearby is still found.
  const dates = ev.rrule ? expandDates(base, ev.rrule, addDays(from, -14), addDays(to, 14)) : [base];
  const lo = `${from}T00:00`;
  const hi = `${to}T00:00`;
  const out: Occurrence[] = [];
  for (const d of dates) {
    const patch = ev.rrule ? patches.get(d) : undefined;
    if (patch?.cancelled) continue;
    let start = withMinutes(d, startMin);
    let end = addMinutes(start, dur);
    if (patch?.start) {
      start = patch.start;
      end = patch.end ?? addMinutes(start, dur);
    }
    const driverId = patch && 'driverId' in patch ? (patch.driverId ?? null) : ev.driverId;
    const overlaps = start < hi && (end > lo || (start >= lo && end === start));
    if (!overlaps) continue;
    out.push({ ...ev, start, end, driverId, key: `${ev.id}:${d}`, originalDate: d, isException: !!patch });
  }
  return out;
}

export const REPEAT_PRESETS = [
  { id: 'none', label: 'Does not repeat' },
  { id: 'daily', label: 'Every day' },
  { id: 'weekdays', label: 'Every weekday (Mon–Fri)' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'biweekly', label: 'Every 2 weeks' },
  { id: 'monthly', label: 'Monthly' },
] as const;
export type RepeatPreset = (typeof REPEAT_PRESETS)[number]['id'];

export function presetToRRule(preset: RepeatPreset, weekdays: number[]): string | null {
  switch (preset) {
    case 'none': return null;
    case 'daily': return 'FREQ=DAILY';
    case 'weekdays': return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    case 'weekly': return formatRRule({ freq: 'WEEKLY', interval: 1, byDay: weekdays });
    case 'biweekly': return formatRRule({ freq: 'WEEKLY', interval: 2, byDay: weekdays });
    case 'monthly': return 'FREQ=MONTHLY';
  }
}

export function rruleToPreset(rrule: string | null): { preset: RepeatPreset; weekdays: number[] } {
  if (!rrule) return { preset: 'none', weekdays: [] };
  const r = parseRRule(rrule);
  const days = r.byDay ?? [];
  if (r.freq === 'DAILY') return { preset: 'daily', weekdays: [] };
  if (r.freq === 'MONTHLY') return { preset: 'monthly', weekdays: [] };
  if (r.freq === 'WEEKLY' && r.interval === 1 && days.join() === '0,1,2,3,4') return { preset: 'weekdays', weekdays: days };
  if (r.freq === 'WEEKLY') return { preset: r.interval === 2 ? 'biweekly' : 'weekly', weekdays: days };
  return { preset: 'none', weekdays: [] };
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

export function describeRRule(rrule: string | null): string {
  if (!rrule) return 'Does not repeat';
  const r = parseRRule(rrule);
  const names = (r.byDay ?? []).map((d) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d]);
  let s: string;
  if (r.freq === 'DAILY') s = r.interval > 1 ? `Every ${r.interval} days` : 'Every day';
  else if (r.freq === 'WEEKLY') {
    if (names.join() === 'Mon,Tue,Wed,Thu,Fri' && r.interval === 1) s = 'Every weekday';
    else s = `${r.interval > 1 ? `Every ${r.interval} weeks` : 'Weekly'}${names.length ? ` on ${names.join(', ')}` : ''}`;
  } else if (r.freq === 'MONTHLY') s = r.interval > 1 ? `Every ${r.interval} months` : 'Monthly';
  else s = r.interval > 1 ? `Every ${r.interval} years` : 'Yearly';
  if (r.freq === 'MONTHLY' || r.freq === 'YEARLY') {
    const nth = (n: number) => (n === -1 ? 'last' : n < 0 ? `${ordinal(-n)} to last` : ordinal(n));
    const on = [
      ...(r.byNthDay ?? []).map((x) => `the ${nth(x.n)} ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][x.day]}`),
      ...(r.byMonthDay ?? []).map((d) => `the ${nth(d)}${d === -1 ? ' day' : ''}`),
    ];
    if (on.length) s += ` on ${on.join(', ')}`;
    else if (names.length) s += ` on ${names.join(', ')}`;
    if (r.freq === 'YEARLY' && r.byMonth?.length) s += ` in ${r.byMonth.map((m) => MONTHS_SHORT[m - 1]).join(', ')}`;
  }
  if (r.until) s += ` until ${r.until}`;
  if (r.count) s += `, ${r.count} times`;
  return s;
}
