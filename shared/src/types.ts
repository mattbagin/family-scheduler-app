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
export type LiveTopic = 'events' | 'plans' | 'chores' | 'bills' | 'members' | 'settings' | 'calendars';
