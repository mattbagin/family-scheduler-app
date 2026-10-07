/** Calendar date, `YYYY-MM-DD`, in the family's local time. */
export type Ymd = string;
/** Wall-clock date and time, `YYYY-MM-DDTHH:mm`, in the family's local time (no zone). */
export type LocalDateTime = string;

export type Role = 'adult' | 'kid';

export interface Member {
  id: number;
  name: string;
  role: Role;
  /** Hex color, the member's visual identity everywhere in the app. */
  color: string;
  /** An emoji (photo avatars come later). */
  avatar: string;
  hasPin: boolean;
  sort: number;
}

export type Category = 'school' | 'sports' | 'medical' | 'playdate' | 'family' | 'work' | 'bills' | 'other';

export interface EventRecord {
  id: number;
  calendarId: number | null;
  title: string;
  /** Short, picture-friendly title for kid mode ("Soccer" instead of "U8 practice, field 3"). */
  kidTitle: string | null;
  icon: string;
  category: Category;
  start: LocalDateTime;
  end: LocalDateTime;
  allDay: boolean;
  /** RFC 5545 RRULE body, e.g. `FREQ=WEEKLY;BYDAY=TU,TH`. */
  rrule: string | null;
  location: string | null;
  notes: string | null;
  /** What to pack ("Cleats and a water bottle"); feeds the "pack for tomorrow" reminder. */
  bring: string | null;
  travelMin: number;
  driverId: number | null;
  needsDriver: boolean;
  /** Something to look forward to: shows as a "sleeps until" countdown. */
  fun: boolean;
  memberIds: number[];
  planId: number | null;
  /** Nudge this many minutes before each start (0 = as it starts). */
  reminders: number[];
}

export interface OccurrencePatch {
  start?: LocalDateTime;
  end?: LocalDateTime;
  driverId?: number | null;
  cancelled?: boolean;
}

/** One concrete instance of an event (a recurring event yields many). */
export interface Occurrence extends EventRecord {
  /** Stable per-instance key: `${eventId}:${originalDate}`. */
  key: string;
  originalDate: Ymd;
  isException: boolean;
}

export interface PlanTask {
  id: number;
  planId: number;
  text: string;
  icon: string;
  assigneeId: number | null;
  due: Ymd;
  doneAt: string | null;
}

export interface Plan {
  id: number;
  eventId: number;
  title: string;
  icon: string;
  notes: string | null;
  /** Start of the linked event. */
  start: LocalDateTime;
  tasks: PlanTask[];
}

export interface Chore {
  id: number;
  text: string;
  icon: string;
  assigneeId: number;
  /** Weekdays the chore is due, 0 = Monday … 6 = Sunday. */
  days: number[];
  sort: number;
}

export interface ChoreForDay extends Chore {
  date: Ymd;
  scheduled: boolean;
  done: boolean;
}

export interface Bill {
  id: number;
  name: string;
  icon: string;
  amountCents: number;
  due: Ymd;
  monthly: boolean;
  autopay: boolean;
  paidAt: string | null;
}

export interface SessionInfo {
  kind: 'member' | 'hub';
  memberId: number | null;
  canEdit: boolean;
  elevatedUntil: number | null;
}

export interface Bootstrap {
  needsSetup: boolean;
  familyName: string;
  session: SessionInfo | null;
  members: Member[];
}

/** A to-do ("Call the plumber"), or prep: something to pack or do before a day ("Gym shoes"). */
export type TodoKind = 'todo' | 'prep';

export interface Todo {
  id: number;
  kind: TodoKind;
  text: string;
  icon: string;
  /** Null means anyone in the family. */
  assigneeId: number | null;
  /** Null means someday (to-dos only; prep always has a day). */
  due: Ymd | null;
  doneAt: string | null;
  /** Repeat rule (to-dos with a day only). Ticking one off adds the next. */
  rrule: string | null;
}

/** One thing to get ready for a day: an event's "bring" note or a prep item. */
export interface PrepItem {
  /** `event:<eventId>:<date>` or `todo:<id>`. */
  key: string;
  date: Ymd;
  text: string;
  icon: string;
  memberIds: number[];
  done: boolean;
  /** Set for an event's bring note. */
  eventId: number | null;
  eventTitle: string | null;
  /** When the event starts (minutes after midnight); null for all-day events and prep items. */
  startMin: number | null;
  /** Set for a prep item. */
  todoId: number | null;
}

export type NudgeKind = 'leave_by' | 'reminder' | 'morning' | 'evening' | 'bill';

/** One person's nudge choices. Times are `HH:mm`; quiet hours may wrap past midnight. */
export interface NotifyPrefs {
  quietStart: string;
  quietEnd: string;
  leaveBy: boolean;
  reminders: boolean;
  morning: boolean;
  evening: boolean;
  bills: boolean;
}

export interface NudgeSettings {
  /** Morning briefing and evening "pack for tomorrow" digest, `HH:mm`. */
  morningAt: string;
  eveningAt: string;
  /** Unanswered leave-by and reminder nudges repeat after this long, then go to the other parent; 0 = off. */
  escalateMin: number;
  /** Adults' choices by member id. */
  members: Record<number, NotifyPrefs>;
}

/** A nudge that fired: shown as a banner on the hub and pushed to parents' phones. */
export interface Nudge {
  id: number;
  kind: NudgeKind;
  title: string;
  body: string;
  url: string;
  audience: number[];
  createdAt: string;
  expiresAt: string;
  ackedAt: string | null;
  ackedBy: number | null;
}

/** A subscribed ICS feed (school, team, a Google/Outlook secret link). */
export interface Calendar {
  id: number;
  name: string;
  kind: 'local' | 'ics';
  /** The feed link; hidden (null) unless the viewer can edit, since secret links grant access. */
  url: string | null;
  color: string;
  /** Who new events from this feed are for (each event can still be changed). */
  memberIds: number[];
  refreshMin: number;
  /** ISO time of the last successful fetch. */
  lastSynced: string | null;
  /** Why the last attempt failed; null when it worked. */
  lastError: string | null;
  eventCount: number;
}

/** What a feed link holds, shown before subscribing. */
export interface CalendarPreview {
  url: string;
  name: string | null;
  eventCount: number;
  upcoming: { title: string; start: LocalDateTime; allDay: boolean; repeats: boolean }[];
  warnings: string[];
}

export interface SyncResult {
  status: 'updated' | 'unchanged' | 'error';
  added: number;
  updated: number;
  removed: number;
  error: string | null;
}

/** Topics pushed over the live socket so every screen refreshes what changed. */
export type LiveTopic = 'events' | 'plans' | 'chores' | 'bills' | 'members' | 'settings' | 'calendars' | 'todos' | 'nudges' | 'hub';

/** A place for the weather, picked from Open-Meteo's place search. */
export interface Place {
  name: string;
  /** Region and country, e.g. "Ontario, Canada". */
  detail: string;
  lat: number;
  lon: number;
}

/** How the shared hub behaves: photos, night mode and weather. */
export interface HubSettings {
  /** Folder on the home computer with photos for the ambient screen; null shows color scenes. */
  photoDir: string | null;
  /** Night mode dims the hub deeply and silences its chimes, `HH:mm`, may wrap past midnight. */
  night: boolean;
  nightStart: string;
  nightEnd: string;
  place: Place | null;
  tempUnit: 'c' | 'f';
}

/** Today's and the next few days' forecast (WMO weather codes, see shared/weather.ts). */
export interface Weather {
  place: string;
  unit: 'c' | 'f';
  now: { temp: number; code: number; isDay: boolean };
  days: { date: Ymd; hi: number; lo: number; code: number; rainChance: number }[];
  fetchedAt: string;
}

/** The home computer's last backups of the database. */
export interface BackupInfo {
  dir: string;
  keep: number;
  files: { name: string; size: number; at: string }[];
}
