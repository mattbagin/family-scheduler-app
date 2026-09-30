import {
  addDays, addMinutes, datePart, dayDiff, fmtDur, fmtTime, leaveByMin, minutesOf, WEEKDAYS, weekdayMon, withMinutes,
  type Bill, type LocalDateTime, type Member, type NotifyPrefs, type NudgeKind, type Occurrence, type PrepItem, type Todo,
} from '../../../shared/src/index.ts';

/** A nudge that should be showing right now, before delivery rules (quiet hours, preferences) apply. */
export interface NudgePlan {
  /** Makes it fire once: `leave:<eventId>:<date>`, `evening:<date>`… */
  key: string;
  kind: NudgeKind;
  title: string;
  body: string;
  url: string;
  audience: number[];
  /** Due from `at` until `until` (wall-clock). Held back by quiet hours, it can still go out later in the window. */
  at: LocalDateTime;
  until: LocalDateTime;
  /** Time-critical: repeats, then goes to the other parent, if nobody answers. */
  urgent: boolean;
}

export interface PlanInput {
  now: LocalDateTime;
  members: Member[];
  /** From yesterday to a couple of days out (reminders can be a day early). */
  occurrences: Occurrence[];
  /** Today and tomorrow. */
  prep: PrepItem[];
  bills: Bill[];
  todos: Todo[];
  morningAt: string;
  eveningAt: string;
}

/** Which preference switches each kind of nudge. */
export const PREF_OF: Record<NudgeKind, keyof NotifyPrefs> = {
  leave_by: 'leaveBy', reminder: 'reminders', morning: 'morning', evening: 'evening', bill: 'bills',
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const MAX_LINES = 5;

export function planNudges(inp: PlanInput): NudgePlan[] {
  const { now, members } = inp;
  const today = datePart(now);
  const tomorrow = addDays(today, 1);
  const byId = new Map(members.map((m) => [m.id, m]));
  const adults = members.filter((m) => m.role === 'adult').map((m) => m.id);
  const names = (ids: number[]) => ids.map((id) => byId.get(id)?.name).filter(Boolean).join(' & ');
  const adultsIn = (ids: number[]) => ids.filter((id) => byId.get(id)?.role === 'adult');
  const at = (hhmm: string, day = today): LocalDateTime => `${day}T${hhmm}`;
  const out: NudgePlan[] = [];

  for (const o of inp.occurrences) {
    const others = (id: number | null) => names(o.memberIds.filter((m) => m !== id));
    const starts = o.allDay ? 'all day' : `starts ${fmtTime(minutesOf(o.start))}`;

    // Leave-by: start minus drive time minus 10 minutes, to the driver (or whoever's going).
    if (!o.allDay && o.travelMin > 0) {
      const leave = withMinutes(datePart(o.start), leaveByMin(minutesOf(o.start), o.travelMin));
      const audience = o.driverId ? [o.driverId] : adultsIn(o.memberIds).length ? adultsIn(o.memberIds) : adults;
      const who = others(o.driverId);
      out.push({
        key: `leave:${o.id}:${o.originalDate}`, kind: 'leave_by', urgent: true, url: '/',
        title: `🚗 Time to leave for ${o.title}`,
        body: `${o.driverId ? `${names([o.driverId])} is driving` : 'Nobody is down to drive'}${who ? ` ${who}` : ''}`
          + `${o.location ? ` to ${o.location}` : ''} · ${starts}`,
        audience, at: leave, until: o.start,
      });
    }

    // "Remind me … before".
    for (const off of o.reminders) {
      const fire = addMinutes(o.start, -off);
      const audience = [...new Set([...adultsIn(o.memberIds), ...(o.driverId ? [o.driverId] : [])])];
      const when = off === 0 ? 'is starting'
        : off < 1440 ? `in ${fmtDur(off)}`
          : datePart(o.start) === addDays(datePart(fire), 1) ? `tomorrow${o.allDay ? '' : ` at ${fmtTime(minutesOf(o.start))}`}`
            : `on ${WEEKDAYS[weekdayMon(datePart(o.start))]}`;
      out.push({
        key: `rem:${o.id}:${o.originalDate}:${off}`, kind: 'reminder', urgent: off <= 60, url: '/',
        title: `${o.icon} ${o.title} ${when}`,
        body: [names(o.memberIds), o.location, o.bring ? `bring ${o.bring.toLowerCase()}` : null].filter(Boolean).join(' · ') || starts,
        audience: audience.length ? audience : adults,
        at: fire, until: off === 0 ? addMinutes(o.start, 15) : o.start,
      });
    }
  }

  // Only what's still ahead: a briefing sent late (the server was off at 7) skips what's over.
  const agenda = (day: string) => inp.occurrences
    .filter((o) => datePart(o.start) === day && o.category !== 'work' && (o.allDay || o.end > now))
    .map((o) => `${o.allDay ? 'All day' : fmtTime(minutesOf(o.start))} ${o.title}${o.memberIds.length ? ` (${names(o.memberIds)})` : ''}`);
  const packing = (day: string) => inp.prep.filter((p) => p.date === day && !p.done)
    .map((p) => `${p.text}${p.memberIds.length ? ` (${names(p.memberIds)})` : ''}`);
  const list = (lines: string[]) => lines.slice(0, MAX_LINES).join(' · ') + (lines.length > MAX_LINES ? ` · and ${lines.length - MAX_LINES} more` : '');

  // Morning briefing: today's plan, what to bring, bills and to-dos due.
  {
    const events = agenda(today);
    const bring = packing(today);
    const bills = inp.bills.filter((b) => !b.paidAt && !b.autopay && b.due <= today).map((b) => `${b.name} ${money(b.amountCents)}`);
    const todos = inp.todos.filter((t) => t.kind === 'todo' && !t.doneAt && t.due && t.due <= today);
    const parts = [
      events.length ? list(events) : null,
      bring.length ? `Bring: ${list(bring)}` : null,
      bills.length ? `Bills due: ${bills.join(', ')}` : null,
      todos.length ? `To-dos: ${todos.map((t) => t.text).join(', ')}` : null,
    ].filter(Boolean);
    if (parts.length) {
      out.push({
        key: `morning:${today}`, kind: 'morning', urgent: false, url: '/',
        title: `☀️ Today: ${events.length ? `${events.length} thing${events.length === 1 ? '' : 's'} on` : 'a quiet day'}`,
        body: parts.join('\n'), audience: adults, at: at(inp.morningAt), until: at('11:00'),
      });
    }
  }

  // Evening digest: tomorrow's plan and what to pack tonight.
  {
    const events = agenda(tomorrow);
    const pack = packing(tomorrow);
    if (events.length || pack.length) {
      out.push({
        key: `evening:${today}`, kind: 'evening', urgent: false, url: '/',
        title: pack.length ? `🎒 Pack for tomorrow: ${pack.length} thing${pack.length === 1 ? '' : 's'}` : `🌙 Tomorrow: ${events.length} thing${events.length === 1 ? '' : 's'} on`,
        body: [pack.length ? `Pack: ${list(pack)}` : null, events.length ? list(events) : null].filter(Boolean).join('\n'),
        audience: adults, at: at(inp.eveningAt), until: at('23:00'),
      });
    }
  }

  // Bills: 3 days before, the day before, on the day, and every day after until paid.
  for (const b of inp.bills) {
    if (b.paidAt || b.autopay) continue;
    const d = dayDiff(today, b.due);
    if (d > 3 || d === 2) continue;
    out.push({
      key: `bill:${b.id}:${b.due}:${d < 0 ? `late:${today}` : d}`, kind: 'bill', urgent: false, url: '/',
      title: `${b.icon} ${b.name} ${d > 1 ? `is due in ${d} days` : d === 1 ? 'is due tomorrow' : d === 0 ? 'is due today' : `is ${-d} day${d < -1 ? 's' : ''} overdue`}`,
      body: `${money(b.amountCents)} · tap Mark paid in Homebase once it’s done`,
      audience: adults, at: at(inp.morningAt), until: at('21:00'),
    });
  }

  return out.filter((n) => n.at <= now && now < n.until && n.audience.length > 0);
}
