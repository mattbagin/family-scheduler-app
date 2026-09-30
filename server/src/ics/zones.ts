import type { LocalDateTime } from '../../../shared/src/index.ts';

/** The family's time zone: the home server's. Every stored time is wall-clock in this zone. */
export const familyZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

// Outlook/Exchange feeds name zones the Windows way; these cover most families.
const WINDOWS_ZONES: Record<string, string> = {
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Atlantic Standard Time': 'America/Halifax',
  'Newfoundland Standard Time': 'America/St_Johns',
  'Canada Central Standard Time': 'America/Regina',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'E. Australia Standard Time': 'Australia/Brisbane',
  'Cen. Australia Standard Time': 'Australia/Adelaide',
  'W. Australia Standard Time': 'Australia/Perth',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Singapore Standard Time': 'Asia/Singapore',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'Coordinated Universal Time': 'UTC',
};

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatter(zone: string): Intl.DateTimeFormat | null {
  if (!formatters.has(zone)) {
    try {
      formatters.set(zone, new Intl.DateTimeFormat('en-US', {
        timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
      }));
    } catch {
      formatters.set(zone, null);
    }
  }
  return formatters.get(zone)!;
}

/**
 * An IANA zone for a TZID, or null when we can't tell (the caller then treats times as the
 * family's own). Handles plain IANA names, prefixed ones like "/mozilla.org/…/America/New_York",
 * and Windows names.
 */
export function resolveZone(tzid: string | undefined): string | null {
  if (!tzid) return null;
  const t = tzid.replace(/^"|"$/g, '').trim();
  if (formatter(t)) return t;
  const tail = /([A-Za-z]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?)$/.exec(t)?.[1];
  if (tail && formatter(tail)) return tail;
  return WINDOWS_ZONES[t] ?? null;
}

/** Wall-clock parts of instant `ms` in `zone`: [year, month, day, hour, minute, second]. */
function wallParts(ms: number, zone: string): number[] {
  const parts = formatter(zone)!.formatToParts(ms);
  const pick = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return [pick('year'), pick('month'), pick('day'), pick('hour'), pick('minute'), pick('second')];
}

const pad = (n: number) => String(n).padStart(2, '0');

export function utcToLocal(ms: number, zone: string): LocalDateTime {
  const [y, mo, d, h, mi] = wallParts(ms, zone);
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}`;
}

/** The instant when a wall clock in `zone` shows the given time. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, zone: string): number {
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  const offsetAt = (ms: number) => {
    const [py, pmo, pd, ph, pmi, ps] = wallParts(ms, zone);
    return Date.UTC(py, pmo - 1, pd, ph, pmi, ps) - ms;
  };
  // Two passes settle the offset, including around a DST change.
  const first = asUtc - offsetAt(asUtc);
  return asUtc - offsetAt(first);
}
