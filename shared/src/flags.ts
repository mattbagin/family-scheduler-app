import { absMin, datePart, fmtDur, fmtTime } from './time.ts';
import type { Member, Occurrence } from './types.ts';

export interface Flag {
  kind: 'bad' | 'warn';
  text: string;
}

/**
 * Scheduling problems worth a badge: a kid booked in two places at once, a driver
 * booked for two overlapping rides, a ride nobody has claimed yet, or a tight turnaround
 * (someone gets home from one outing after it's time to leave for the next).
 */
export function computeFlags(occs: Occurrence[], members: Member[]): Map<string, Flag[]> {
  const byId = new Map(members.map((m) => [m.id, m]));
  const flags = new Map<string, Flag[]>();
  const put = (key: string, f: Flag) => {
    const list = flags.get(key) ?? [];
    if (!list.some((x) => x.text === f.text)) list.push(f);
    flags.set(key, list);
  };
  const timed = occs.filter((o) => !o.allDay && o.category !== 'work');
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i];
      const b = timed[j];
      if (!(a.start < b.end && b.start < a.end)) continue;
      const kidInBoth = a.memberIds.some((id) => b.memberIds.includes(id) && byId.get(id)?.role === 'kid');
      if (kidInBoth) {
        put(a.key, { kind: 'bad', text: `Overlaps ${b.title}` });
        put(b.key, { kind: 'bad', text: `Overlaps ${a.title}` });
      }
      if (a.driverId !== null && a.driverId === b.driverId) {
        const text = `${byId.get(a.driverId)?.name ?? 'Driver'} double-booked`;
        put(a.key, { kind: 'bad', text });
        put(b.key, { kind: 'bad', text });
      }
    }
  }
  for (const o of occs) if (o.needsDriver && o.driverId === null) put(o.key, { kind: 'warn', text: 'Needs a ride' });
  tightTurnarounds(timed, put);
  return flags;
}

/** Who has to be there: the people going, plus whoever drives. */
function peopleOf(o: Occurrence): number[] {
  return o.driverId === null ? o.memberIds : [...o.memberIds, o.driverId];
}

/**
 * Travel time is from home, so an outing ends with the same trip back. When someone in it is also
 * in the next outing, they need to be home by that one's leave-by time (which already holds the
 * minutes to get out the door). Eating into those minutes is a warning; missing the real
 * departure is a problem. Events with no travel time are taken to be at home and never checked.
 */
function tightTurnarounds(timed: Occurrence[], put: (key: string, f: Flag) => void) {
  const away = timed.filter((o) => o.travelMin > 0).sort((a, b) => (a.start < b.start ? -1 : 1));
  for (const a of away) {
    const people = peopleOf(a);
    // Only the next outing that shares someone: by the one after, they've had to be home anyway.
    const b = away.find((x) => x.start >= a.end && peopleOf(x).some((id) => people.includes(id)));
    if (!b) continue;
    const day = datePart(a.start);
    const home = absMin(day, a.end) + a.travelMin;
    const leave = leaveByMin(absMin(day, b.start), b.travelMin);
    if (home <= leave) continue;
    const late = home > absMin(day, b.start) - b.travelMin;
    const kind = late ? 'bad' : 'warn';
    put(a.key, { kind, text: `Home ${fmtTime(home)}, ${late ? 'late' : 'tight'} for ${b.title}` });
    put(b.key, { kind, text: `${late ? 'Late' : 'Tight'} after ${a.title}` });
  }
}

/** Minutes between "time to leave" and the real departure, to get everyone out the door. */
export const DOOR_MIN = 10;

/** When the nudge says to head out: start minus travel minus the minutes to get out the door. */
export function leaveByMin(startMin: number, travelMin: number): number {
  return startMin - travelMin - DOOR_MIN;
}

/**
 * Where a ride stands against its leave-by time (minsUntil = leave-by minus now, seconds allowed):
 * "early" before it, "now" during the minutes to get out the door, "late" once the real departure
 * (start minus travel) has passed, with lateness counted from that departure, not the padded time.
 */
function leaveStage(minsUntil: number): { stage: 'early' | 'now' | 'late'; m: number; late: number } {
  const m = Math.round(minsUntil);
  if (m > 0) return { stage: 'early', m, late: 0 };
  if (m >= -DOOR_MIN) return { stage: 'now', m, late: 0 };
  return { stage: 'late', m, late: -m - DOOR_MIN };
}

/** The heads-up line for a ride: "Leave in 25 min for Swim", "Leave now for Swim", "Leave now for Swim: 3 min late". */
export function leaveByTitle(minsUntil: number, title: string): string {
  const { stage, m, late } = leaveStage(minsUntil);
  if (stage === 'early') return `Leave in ${fmtDur(m)} for ${title}`;
  return stage === 'now' ? `Leave now for ${title}` : `Leave now for ${title}: ${fmtDur(late)} late`;
}

/** A heads-up chip's label: the count goes on only when the title doesn't already say it. */
export function chipLabel(title: string, count: number): string {
  return count > 1 && !/\d/.test(title) ? `${title} · ${count}` : title;
}

/**
 * A ride's state on the timeline: green "leave 4:05 PM" until then, amber "leave now" while there's
 * still time to make it, red "3 min late" past the real departure. Calm again once it has started.
 */
export function rideStatus(leaveMin: number, nowMin: number, startMin: number): { cls: 'good' | 'warn' | 'bad'; text: string } {
  const { stage, late } = leaveStage(leaveMin - nowMin);
  if (stage === 'early' || nowMin >= startMin) return { cls: 'good', text: `leave ${fmtTime(leaveMin)}` };
  return stage === 'now' ? { cls: 'warn', text: 'leave now' } : { cls: 'bad', text: `${fmtDur(late)} late` };
}

/** A same-day reminder kept current: "Dentist in 13 min", then "Dentist is starting". */
export function startsInTitle(minsUntil: number, title: string): string {
  const m = Math.round(minsUntil);
  return m > 0 ? `${title} in ${fmtDur(m)}` : `${title} is starting`;
}

/**
 * A ride's heads-up line, in the timeline pill's words and colours: "Mom leaves 3:10 PM for
 * Playdate" while there's time, then leaveByTitle's "Leave now…" (amber) and "… min late" (urgent).
 */
export function rideHeadsUp(leaveMin: number, nowMin: number, driver: string, title: string): { cls: '' | 'warn' | 'bad'; text: string } {
  const { stage } = leaveStage(leaveMin - nowMin);
  if (stage === 'early') return { cls: '', text: `${driver} leaves ${fmtTime(leaveMin)} for ${title}` };
  return { cls: stage === 'now' ? 'warn' : 'bad', text: leaveByTitle(leaveMin - nowMin, title) };
}

/** A reminder titled for later today ("… in 15 min", "… is starting"), which the hub keeps current. */
export function isSameDayReminder(title: string): boolean {
  return /\s(in \d+( min|h( \d+m)?)|is starting)$/.test(title);
}
