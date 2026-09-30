import {
  addDays, addMinutes, datePart, isValidRRule, type LocalDateTime, type Ymd,
} from '../../../shared/src/index.ts';
import { resolveZone, utcToLocal, zonedToUtc } from './zones.ts';

/** One event from a feed, already in the family's wall-clock time. */
export interface IcsEvent {
  /** UID, or `UID#YYYY-MM-DD` for a single occurrence changed upstream (RECURRENCE-ID). */
  uid: string;
  title: string;
  start: LocalDateTime;
  end: LocalDateTime;
  allDay: boolean;
  rrule: string | null;
  /** Occurrences cancelled or moved upstream, by original date. */
  exdates: Ymd[];
  location: string | null;
  notes: string | null;
}

export interface IcsCalendar {
  name: string | null;
  events: IcsEvent[];
  /** Things we couldn't follow exactly, worded for a parent reading the settings page. */
  warnings: string[];
}

export class FeedError extends Error {}

interface Prop {
  params: Record<string, string>;
  value: string;
}
type Props = Map<string, Prop[]>;

/** Splits `NAME;P1=a;P2="b:c":value`, respecting quoted parameter values. */
function parseLine(line: string): [string, Prop] | null {
  let quoted = false;
  const cuts: number[] = [];
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === ';') cuts.push(i);
    else if (!quoted && c === ':') {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const bounds = [...cuts, colon];
  const name = head.slice(0, bounds[0]).toUpperCase();
  const params: Record<string, string> = {};
  for (let i = 0; i < cuts.length; i++) {
    const [k, v = ''] = line.slice(cuts[i] + 1, bounds[i + 1]).split(/=(.*)/s);
    params[k.toUpperCase()] = v.replace(/^"|"$/g, '');
  }
  return [name, { params, value: line.slice(colon + 1) }];
}

const unescape = (s: string) => s.replace(/\\([nN,;\\])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));

const clip = (s: string | undefined, max: number): string | null => {
  const t = s ? unescape(s).trim() : '';
  return t ? (t.length > max ? `${t.slice(0, max - 1)}…` : t) : null;
};

const pad = (n: number) => String(n).padStart(2, '0');

export function parseIcs(text: string, zone: string): IcsCalendar {
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    throw new FeedError('That link didn’t return a calendar file. Look for the “iCal” or “ICS” link, not the web page.');
  }
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const warnings = new Set<string>();

  const cal: Props = new Map();
  const vevents: Props[] = [];
  const stack: string[] = [];
  let current: Props | null = null;
  for (const raw of lines) {
    const parsed = parseLine(raw);
    if (!parsed) continue;
    const [name, prop] = parsed;
    if (name === 'BEGIN') {
      stack.push(prop.value.toUpperCase());
      if (prop.value.toUpperCase() === 'VEVENT') vevents.push((current = new Map()));
      continue;
    }
    if (name === 'END') {
      if (stack.pop() === 'VEVENT') current = null;
      continue;
    }
    const top = stack.at(-1);
    // Properties of an alarm inside an event belong to the alarm, not the event.
    const target = top === 'VEVENT' ? current : top === 'VCALENDAR' ? cal : null;
    if (!target) continue;
    const list = target.get(name) ?? [];
    list.push(prop);
    target.set(name, list);
  }

  const warnedZones = new Set<string>();
  /** A DATE or DATE-TIME value as family wall-clock time. */
  const toLocal = (p: Prop): { dt: LocalDateTime; allDay: boolean } => {
    const v = p.value.trim();
    const date = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
    if (date || p.params.VALUE === 'DATE') {
      const d = date ?? /^(\d{4})(\d{2})(\d{2})/.exec(v);
      if (!d) throw new Error(`bad date ${v}`);
      return { dt: `${d[1]}-${d[2]}-${d[3]}T00:00`, allDay: true };
    }
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
    if (!m) throw new Error(`bad date-time ${v}`);
    const [y, mo, d, h, mi, s] = m.slice(1, 7).map((x) => Number(x ?? 0));
    if (m[7]) return { dt: utcToLocal(Date.UTC(y, mo - 1, d, h, mi, s), zone), allDay: false };
    const tz = resolveZone(p.params.TZID);
    if (p.params.TZID && !tz && !warnedZones.has(p.params.TZID)) {
      warnedZones.add(p.params.TZID);
      warnings.add(`Unknown time zone “${p.params.TZID}”: those times are shown as they are, in your time zone.`);
    }
    if (!tz || tz === zone) return { dt: `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}`, allDay: false };
    return { dt: utcToLocal(zonedToUtc(y, mo, d, h, mi, s, tz), zone), allDay: false };
  };

  /** UNTIL as a local date, so it lines up with how we expand the series. */
  const localUntil = (rrule: string, startProp: Prop) =>
    rrule.replace(/UNTIL=(\d{8})(T\d{6}Z?)?/i, (_, d: string, t?: string) => {
      if (!t) return `UNTIL=${d}`;
      const local = toLocal({ params: t.endsWith('Z') ? {} : startProp.params, value: d + t }).dt;
      return `UNTIL=${datePart(local).replaceAll('-', '')}`;
    });

  const durationMin = (s: string): number | null => {
    const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(s.trim());
    if (!m) return null;
    const [w, d, h, mi] = m.slice(2, 6).map((x) => Number(x ?? 0));
    return (m[1] === '-' ? -1 : 1) * (((w * 7 + d) * 24 + h) * 60 + mi);
  };

  const first = (p: Props, k: string) => p.get(k)?.[0];
  const masters = new Map<string, IcsEvent>();
  /** Changed single occurrences by `uid#date`; if a feed repeats one, the highest SEQUENCE wins. */
  const changed = new Map<string, { uid: string; date: Ymd; seq: number; ev: IcsEvent | null }>();
  const cancelledUids = new Set<string>();
  let skipped = 0;

  for (const p of vevents) {
    const dtstart = first(p, 'DTSTART');
    if (!dtstart) {
      skipped++;
      continue;
    }
    try {
      const uid = first(p, 'UID')?.value.trim() || `nouid:${first(p, 'SUMMARY')?.value ?? ''}:${dtstart.value}`;
      const title = clip(first(p, 'SUMMARY')?.value, 120) ?? '(No title)';
      const cancelled = first(p, 'STATUS')?.value.trim().toUpperCase() === 'CANCELLED';
      const { dt: start, allDay } = toLocal(dtstart);

      let end: LocalDateTime;
      const dtend = first(p, 'DTEND');
      const dur = first(p, 'DURATION');
      const durMin = dur ? durationMin(dur.value) : null;
      if (dtend) end = toLocal(dtend).dt;
      else if (durMin !== null) end = addMinutes(start, durMin);
      else end = allDay ? `${addDays(datePart(start), 1)}T00:00` : start;
      if (allDay && end <= start) end = `${addDays(datePart(start), 1)}T00:00`;
      if (end < start) end = start;

      let rrule: string | null = null;
      const rr = first(p, 'RRULE');
      if (rr) {
        const body = localUntil(rr.value.trim().replace(/^RRULE:/i, ''), dtstart);
        if (isValidRRule(body)) rrule = body;
        else warnings.add(`“${title}” repeats in a way Homebase can’t follow yet, so only its first date is shown.`);
      }
      if (p.has('RDATE')) warnings.add(`“${title}” has extra one-off dates (RDATE) that aren’t shown.`);

      const exdates = (p.get('EXDATE') ?? []).flatMap((x) =>
        x.value.split(',').map((v) => datePart(toLocal({ params: x.params, value: v }).dt)));

      const ev: IcsEvent = {
        uid, title, start, end, allDay, rrule, exdates: [...new Set(exdates)].sort(),
        location: clip(first(p, 'LOCATION')?.value, 200), notes: clip(first(p, 'DESCRIPTION')?.value, 2000),
      };

      const rid = first(p, 'RECURRENCE-ID');
      if (rid) {
        const date = datePart(toLocal({ params: { ...dtstart.params, ...rid.params }, value: rid.value }).dt);
        const key = `${uid}#${date}`;
        const seq = Number.parseInt(first(p, 'SEQUENCE')?.value ?? '0', 10) || 0;
        if ((changed.get(key)?.seq ?? -1) <= seq) {
          changed.set(key, { uid, date, seq, ev: cancelled ? null : { ...ev, uid: key, rrule: null, exdates: [] } });
        }
      } else if (cancelled) {
        cancelledUids.add(uid);
      } else {
        // Some feeds reuse a UID for unrelated events; keep each, with a stable suffix.
        let key = uid;
        for (let n = 2; masters.has(key); n++) key = `${uid}#${n}`;
        masters.set(key, { ...ev, uid: key });
      }
    } catch {
      skipped++;
    }
  }

  // A changed single occurrence replaces that date of its series.
  const extra: IcsEvent[] = [];
  for (const c of changed.values()) {
    if (cancelledUids.has(c.uid)) continue;
    const master = masters.get(c.uid);
    if (master?.rrule && !master.exdates.includes(c.date)) master.exdates = [...master.exdates, c.date].sort();
    if (c.ev) extra.push(c.ev);
  }
  if (skipped) warnings.add(`${skipped} event${skipped === 1 ? '' : 's'} couldn’t be read and ${skipped === 1 ? 'was' : 'were'} skipped.`);

  return {
    name: clip(first(cal, 'X-WR-CALNAME')?.value, 60),
    events: [...masters.values(), ...extra],
    warnings: [...warnings],
  };
}
