import { fmtDur, fmtTime } from './time.ts';
import type { Member, Occurrence } from './types.ts';

export interface Flag {
  kind: 'bad' | 'warn';
  text: string;
}

/**
 * Scheduling problems worth a badge: a kid booked in two places at once, a driver
 * booked for two overlapping rides, or a ride nobody has claimed yet.
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
        put(a.key, { kind: 'bad', text: 'Overlap' });
        put(b.key, { kind: 'bad', text: 'Overlap' });
      }
      if (a.driverId !== null && a.driverId === b.driverId) {
        const text = `${byId.get(a.driverId)?.name ?? 'Driver'} double-booked`;
        put(a.key, { kind: 'bad', text });
        put(b.key, { kind: 'bad', text });
      }
    }
  }
  for (const o of occs) if (o.needsDriver && o.driverId === null) put(o.key, { kind: 'warn', text: 'Needs a ride' });
  return flags;
}

/** When the driver should head out: start minus travel minus a 10-minute buffer. */
export function leaveByMin(startMin: number, travelMin: number): number {
  return startMin - travelMin - 10;
}

/**
 * The heads-up line for a ride: "Leave in 25 min for Swim", "Leave now for Swim", "Leave now for
 * Swim: 3 min late". `minsUntil` may carry seconds; it's rounded to whole minutes first.
 */
export function leaveByTitle(minsUntil: number, title: string): string {
  const m = Math.round(minsUntil);
  if (m < 0) return `Leave now for ${title}: ${fmtDur(-m)} late`;
  return m === 0 ? `Leave now for ${title}` : `Leave in ${fmtDur(m)} for ${title}`;
}

/** A heads-up chip's label: the count goes on only when the title doesn't already say it. */
export function chipLabel(title: string, count: number): string {
  return count > 1 && !/\d/.test(title) ? `${title} · ${count}` : title;
}

/**
 * A ride's state on the timeline: calm until it's time to go, amber for the first five minutes
 * ("leave now", "2 min late"), then red. Once the event has started it's calm again (they're there, or it no longer helps).
 */
export function rideStatus(leaveMin: number, nowMin: number, startMin: number): { cls: 'good' | 'warn' | 'bad'; text: string } {
  const m = Math.round(leaveMin - nowMin);
  if (m > 0 || nowMin >= startMin) return { cls: 'good', text: `leave ${fmtTime(leaveMin)}` };
  if (m > -5) return { cls: 'warn', text: m === 0 ? 'leave now' : `${fmtDur(-m)} late` };
  return { cls: 'bad', text: `${fmtDur(-m)} late` };
}
