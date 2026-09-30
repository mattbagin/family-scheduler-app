import {
  addDays, datePart, expandEvent, minutesOf,
  type Bill, type Calendar, type Category, type Chore, type EventRecord, type Member, type Occurrence, type OccurrencePatch, type Plan,
  type PlanTask, type PrepItem, type Todo, type TodoKind, type Ymd,
} from '../../shared/src/index.ts';
import { all, get, type Db } from './db.ts';
import { notFound } from './http.ts';

/* ---------- members ---------- */

export interface MemberRow {
  id: number;
  name: string;
  role: 'adult' | 'kid';
  color: string;
  avatar: string;
  pin_hash: string | null;
  sort: number;
}

export const toMember = (r: MemberRow): Member => ({
  id: r.id, name: r.name, role: r.role, color: r.color, avatar: r.avatar, hasPin: !!r.pin_hash, sort: r.sort,
});

export function listMembers(db: Db): Member[] {
  return all<MemberRow>(db, 'SELECT * FROM members ORDER BY sort, id').map(toMember);
}

export function getMemberRow(db: Db, id: number): MemberRow {
  const row = get<MemberRow>(db, 'SELECT * FROM members WHERE id = ?', id);
  if (!row) throw notFound('Family member');
  return row;
}

/* ---------- events ---------- */

interface EventRow {
  id: number;
  calendar_id: number | null;
  title: string;
  kid_title: string | null;
  icon: string;
  category: Category;
  start: string;
  end: string;
  all_day: number;
  rrule: string | null;
  location: string | null;
  notes: string | null;
  bring: string | null;
  travel_min: number;
  driver_id: number | null;
  needs_driver: number;
  fun: number;
  exdates: string | null;
  member_ids: string | null;
  plan_id: number | null;
}

const EVENT_SELECT = `
  SELECT e.*, p.id AS plan_id,
    (SELECT group_concat(member_id) FROM event_members em WHERE em.event_id = e.id) AS member_ids
  FROM events e LEFT JOIN plans p ON p.event_id = e.id`;

const toEvent = (r: EventRow): EventRecord => ({
  id: r.id,
  calendarId: r.calendar_id,
  title: r.title,
  kidTitle: r.kid_title,
  icon: r.icon,
  category: r.category,
  start: r.start,
  end: r.end,
  allDay: !!r.all_day,
  rrule: r.rrule,
  location: r.location,
  notes: r.notes,
  bring: r.bring,
  travelMin: r.travel_min,
  driverId: r.driver_id,
  needsDriver: !!r.needs_driver,
  fun: !!r.fun,
  memberIds: r.member_ids ? r.member_ids.split(',').map(Number).sort((a, b) => a - b) : [],
  planId: r.plan_id,
});

export function getEvent(db: Db, id: number): EventRecord {
  const row = get<EventRow>(db, `${EVENT_SELECT} WHERE e.id = ?`, id);
  if (!row) throw notFound('Event');
  return toEvent(row);
}

/** Every occurrence overlapping [from, to), repeating events expanded, sorted by start. */
export function occurrencesBetween(db: Db, from: Ymd, to: Ymd): Occurrence[] {
  const rows = all<EventRow>(
    db,
    `${EVENT_SELECT} WHERE (e.rrule IS NOT NULL AND e.start < ?) OR (e.rrule IS NULL AND e.start < ? AND e.end >= ?)`,
    `${addDays(to, 14)}T00:00`, `${to}T00:00`, `${from}T00:00`,
  );
  const patches = new Map<number, Map<Ymd, OccurrencePatch>>();
  const exRows = all<{ event_id: number; original_date: string; patch: string }>(
    db,
    'SELECT event_id, original_date, patch FROM event_exceptions WHERE original_date >= ? AND original_date < ?',
    addDays(from, -14), addDays(to, 14),
  );
  for (const x of exRows) {
    const m = patches.get(x.event_id) ?? new Map<Ymd, OccurrencePatch>();
    m.set(x.original_date, JSON.parse(x.patch) as OccurrencePatch);
    patches.set(x.event_id, m);
  }
  const empty = new Map<Ymd, OccurrencePatch>();
  // Dates cancelled upstream in a subscribed feed win over any local change to that date.
  const patchesFor = (r: EventRow) => {
    const local = patches.get(r.id) ?? empty;
    if (!r.exdates) return local;
    const m = new Map(local);
    for (const d of r.exdates.split(',')) m.set(d, { cancelled: true });
    return m;
  };
  return rows
    .flatMap((r) => expandEvent(toEvent(r), patchesFor(r), from, to))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.id - b.id));
}

/* ---------- plans ---------- */

interface TaskRow {
  id: number;
  plan_id: number;
  text: string;
  icon: string;
  assignee_id: number | null;
  due: string;
  done_at: string | null;
}

export const toTask = (r: TaskRow): PlanTask => ({
  id: r.id, planId: r.plan_id, text: r.text, icon: r.icon, assigneeId: r.assignee_id, due: r.due, doneAt: r.done_at,
});

export function getTask(db: Db, id: number): PlanTask {
  const row = get<TaskRow>(db, 'SELECT * FROM plan_tasks WHERE id = ?', id);
  if (!row) throw notFound('Task');
  return toTask(row);
}

export function listPlans(db: Db, id?: number): Plan[] {
  const plans = all<{ id: number; event_id: number; title: string; icon: string; notes: string | null; start: string }>(
    db,
    `SELECT p.*, e.start FROM plans p JOIN events e ON e.id = p.event_id ${id ? 'WHERE p.id = ?' : ''} ORDER BY e.start`,
    ...(id ? [id] : []),
  );
  const tasks = all<TaskRow>(db, `SELECT * FROM plan_tasks ${id ? 'WHERE plan_id = ?' : ''} ORDER BY due, id`, ...(id ? [id] : []));
  return plans.map((p) => ({
    id: p.id, eventId: p.event_id, title: p.title, icon: p.icon, notes: p.notes, start: p.start,
    tasks: tasks.filter((t) => t.plan_id === p.id).map(toTask),
  }));
}

export function getPlan(db: Db, id: number): Plan {
  const [plan] = listPlans(db, id);
  if (!plan) throw notFound('Plan');
  return plan;
}

/* ---------- chores & bills ---------- */

export interface ChoreRow {
  id: number;
  text: string;
  icon: string;
  assignee_id: number;
  days: string;
  sort: number;
}

export const toChore = (r: ChoreRow): Chore => ({
  id: r.id, text: r.text, icon: r.icon, assigneeId: r.assignee_id, days: r.days.split(',').filter(Boolean).map(Number), sort: r.sort,
});

export function getChore(db: Db, id: number): Chore {
  const row = get<ChoreRow>(db, 'SELECT * FROM chores WHERE id = ?', id);
  if (!row) throw notFound('Chore');
  return toChore(row);
}

interface BillRow {
  id: number;
  name: string;
  icon: string;
  amount_cents: number;
  due: string;
  monthly: number;
  autopay: number;
  paid_at: string | null;
}

export const toBill = (r: BillRow): Bill => ({
  id: r.id, name: r.name, icon: r.icon, amountCents: r.amount_cents, due: r.due, monthly: !!r.monthly, autopay: !!r.autopay, paidAt: r.paid_at,
});

export function getBill(db: Db, id: number): Bill {
  const row = get<BillRow>(db, 'SELECT * FROM bills WHERE id = ?', id);
  if (!row) throw notFound('Bill');
  return toBill(row);
}

export function listBills(db: Db): Bill[] {
  return all<BillRow>(db, 'SELECT * FROM bills ORDER BY paid_at IS NOT NULL, due, id').map(toBill);
}

/* ---------- calendars ---------- */

interface CalendarRow {
  id: number;
  name: string;
  kind: 'local' | 'ics';
  url: string | null;
  color: string | null;
  refresh_min: number;
  last_synced: string | null;
  last_error: string | null;
  member_ids: string | null;
  event_count: number;
}

const CALENDAR_SELECT = `
  SELECT c.*,
    (SELECT group_concat(member_id) FROM calendar_members cm WHERE cm.calendar_id = c.id) AS member_ids,
    (SELECT count(*) FROM events e WHERE e.calendar_id = c.id) AS event_count
  FROM calendars c`;

const toCalendar = (r: CalendarRow, showUrl: boolean): Calendar => ({
  id: r.id, name: r.name, kind: r.kind, url: showUrl ? r.url : null, color: r.color ?? '#8A8F98',
  memberIds: r.member_ids ? r.member_ids.split(',').map(Number).sort((a, b) => a - b) : [],
  refreshMin: r.refresh_min, lastSynced: r.last_synced, lastError: r.last_error, eventCount: r.event_count,
});

export function listCalendars(db: Db, showUrl: boolean): Calendar[] {
  return all<CalendarRow>(db, `${CALENDAR_SELECT} ORDER BY c.name COLLATE NOCASE, c.id`).map((r) => toCalendar(r, showUrl));
}

export function getCalendar(db: Db, id: number, showUrl = true): Calendar {
  const row = get<CalendarRow>(db, `${CALENDAR_SELECT} WHERE c.id = ?`, id);
  if (!row) throw notFound('Calendar');
  return toCalendar(row, showUrl);
}

/** The subscribed calendar an event comes from, or null for a family-made event. */
export function feedOf(db: Db, ev: EventRecord): { id: number; name: string } | null {
  if (ev.calendarId === null) return null;
  return get<{ id: number; name: string }>(db, "SELECT id, name FROM calendars WHERE id = ? AND kind = 'ics'", ev.calendarId) ?? null;
}

/* ---------- to-dos and prep ---------- */

interface TodoRow {
  id: number;
  kind: TodoKind;
  text: string;
  icon: string;
  assignee_id: number | null;
  due: string | null;
  done_at: string | null;
}

const toTodo = (r: TodoRow): Todo => ({
  id: r.id, kind: r.kind, text: r.text, icon: r.icon, assigneeId: r.assignee_id, due: r.due, doneAt: r.done_at,
});

export function getTodo(db: Db, id: number): Todo {
  const row = get<TodoRow>(db, 'SELECT * FROM todos WHERE id = ?', id);
  if (!row) throw notFound('To-do');
  return toTodo(row);
}

/** Everything still open, plus what was finished since `doneSince` so it can show ticked. */
export function listTodos(db: Db, doneSince: string): Todo[] {
  return all<TodoRow>(
    db,
    'SELECT * FROM todos WHERE done_at IS NULL OR done_at >= ? ORDER BY due IS NULL, due, id',
    doneSince,
  ).map(toTodo);
}

/** What to get ready on each day in [from, to): events' bring notes and prep items. */
export function prepBetween(db: Db, from: Ymd, to: Ymd): PrepItem[] {
  const packed = new Set(
    all<{ event_id: number; date: string }>(db, 'SELECT event_id, date FROM packed WHERE date >= ? AND date < ?', from, to)
      .map((r) => `${r.event_id}:${r.date}`),
  );
  // An event runs on its first day; a bring note belongs to that day even if the event is longer.
  const fromEvents = occurrencesBetween(db, from, to)
    .filter((o) => o.bring && datePart(o.start) >= from)
    .map((o): PrepItem => {
      const date = datePart(o.start);
      return {
        key: `event:${o.id}:${date}`, date, text: o.bring!, icon: o.icon, memberIds: o.memberIds,
        done: packed.has(`${o.id}:${date}`), eventId: o.id, eventTitle: o.title, startMin: o.allDay ? null : minutesOf(o.start), todoId: null,
      };
    });
  const fromTodos = all<TodoRow>(db, "SELECT * FROM todos WHERE kind = 'prep' AND due >= ? AND due < ? ORDER BY id", from, to)
    .map((r): PrepItem => ({
      key: `todo:${r.id}`, date: r.due!, text: r.text, icon: r.icon, memberIds: r.assignee_id ? [r.assignee_id] : [],
      done: !!r.done_at, eventId: null, eventTitle: null, startMin: null, todoId: r.id,
    }));
  return [...fromEvents, ...fromTodos].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
