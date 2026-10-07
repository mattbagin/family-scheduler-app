import type { FastifyInstance } from 'fastify';
import {
  addMinutes, dayDiff, durationMin, guessEventStyle, isYmd,
  type Category, type EventRecord, type OccurrencePatch,
} from '../../../shared/src/index.ts';
import { requireAuth, requireEditor } from '../auth.ts';
import type { Ctx } from '../context.ts';
import { get, run, tx, type Db } from '../db.ts';
import { badRequest, HttpError, idParam, parseBody, parsePatch, v } from '../http.ts';
import { feedOf, getEvent, occurrencesBetween } from '../repo.ts';

const CATEGORIES: Category[] = ['school', 'sports', 'medical', 'playdate', 'family', 'work', 'bills', 'other'];

const eventSchema = {
  title: v.text(120),
  kidTitle: v.optText(40),
  icon: v.text(16),
  category: v.oneOf(...CATEGORIES),
  start: v.dateTime,
  end: v.dateTime,
  allDay: v.bool,
  rrule: v.optRRule,
  location: v.optText(200),
  notes: v.optText(2000),
  bring: v.optText(300),
  travelMin: v.int(0, 600),
  driverId: v.optId,
  needsDriver: v.bool,
  fun: v.bool,
  memberIds: v.ids,
  reminders: ((x, f) => {
    if (!Array.isArray(x) || x.length > 4 || !x.every((n) => Number.isInteger(n) && n >= 0 && n <= 7 * 1440)) {
      throw badRequest(`${f}: must list up to 4 reminders, in minutes before the start (0 to 10080)`);
    }
    return [...new Set(x as number[])].sort((a, b) => a - b);
  }) as (x: unknown, f: string) => number[],
};

export type EventInput = Omit<EventRecord, 'id' | 'calendarId' | 'planId'>;

export function eventDefaults(p: Partial<EventInput> & Pick<EventInput, 'title' | 'start' | 'end'>): EventInput {
  const guess = guessEventStyle(p.title);
  return {
    kidTitle: null, icon: guess.icon, category: guess.category, allDay: false, rrule: null, location: null, notes: null,
    bring: null, travelMin: 0, driverId: null, needsDriver: false, fun: false, memberIds: [], reminders: [], ...p,
  };
}

function checkEvent(db: Db, e: EventInput) {
  if (e.end < e.start) throw badRequest('end: must be after the start');
  if (e.driverId !== null) {
    const d = get<{ role: string }>(db, 'SELECT role FROM members WHERE id = ?', e.driverId);
    if (d?.role !== 'adult') throw badRequest('driverId: the driver must be a parent');
  }
  for (const id of e.memberIds) {
    if (!get(db, 'SELECT 1 FROM members WHERE id = ?', id)) throw badRequest(`memberIds: no family member with id ${id}`);
  }
}

function writeMembers(db: Db, eventId: number, memberIds: number[], reminders: number[]) {
  run(db, 'DELETE FROM event_members WHERE event_id = ?', eventId);
  for (const m of memberIds) run(db, 'INSERT INTO event_members (event_id, member_id) VALUES (?, ?)', eventId, m);
  run(db, 'DELETE FROM event_reminders WHERE event_id = ?', eventId);
  for (const r of reminders) run(db, 'INSERT INTO event_reminders (event_id, offset_min) VALUES (?, ?)', eventId, r);
}

export function insertEvent(db: Db, e: EventInput, calendarId: number | null = null): number {
  checkEvent(db, e);
  return tx(db, () => {
    const { id } = run(
      db,
      `INSERT INTO events (calendar_id, title, kid_title, icon, category, start, end, all_day, rrule, location, notes, bring,
         travel_min, driver_id, needs_driver, fun) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      calendarId, e.title, e.kidTitle, e.icon, e.category, e.start, e.end, e.allDay ? 1 : 0, e.rrule, e.location, e.notes,
      e.bring, e.travelMin, e.driverId, e.needsDriver ? 1 : 0, e.fun ? 1 : 0,
    );
    writeMembers(db, id, e.memberIds, e.reminders);
    return id;
  });
}

function updateEvent(db: Db, id: number, e: EventInput) {
  checkEvent(db, e);
  tx(db, () => {
    run(
      db,
      `UPDATE events SET title = ?, kid_title = ?, icon = ?, category = ?, start = ?, end = ?, all_day = ?, rrule = ?, location = ?,
         notes = ?, bring = ?, travel_min = ?, driver_id = ?, needs_driver = ?, fun = ? WHERE id = ?`,
      e.title, e.kidTitle, e.icon, e.category, e.start, e.end, e.allDay ? 1 : 0, e.rrule, e.location, e.notes, e.bring,
      e.travelMin, e.driverId, e.needsDriver ? 1 : 0, e.fun ? 1 : 0, id,
    );
    writeMembers(db, id, e.memberIds, e.reminders);
    run(db, 'UPDATE plans SET title = ? WHERE event_id = ?', e.title, id);
  });
}

/** On a subscribed event these are the family's to set; everything else comes from the feed. */
const FAMILY_FIELDS = new Set(['kidTitle', 'icon', 'category', 'travelMin', 'driverId', 'needsDriver', 'fun', 'memberIds', 'bring', 'reminders']);

const fromFeed = (field: string, calendar: string) =>
  new HttpError(409, 'read_only', `${field}: this comes from the “${calendar}” calendar, so change it there`);

export function eventRoutes(app: FastifyInstance, { db, changed }: Ctx) {
  app.get('/api/occurrences', async (req) => {
    requireAuth(req);
    const { from, to } = req.query as { from?: string; to?: string };
    if (!isYmd(from) || !isYmd(to)) throw badRequest('from and to must be dates like 2026-10-05');
    const span = dayDiff(from, to);
    if (span <= 0 || span > 120) throw badRequest('to must be 1 to 120 days after from');
    return occurrencesBetween(db, from, to);
  });

  app.get('/api/events/:id', async (req) => {
    requireAuth(req);
    return getEvent(db, idParam(req.params));
  });

  app.post('/api/events', async (req, reply) => {
    requireEditor(req);
    const optional = Object.keys(eventSchema).filter((k) => !['title', 'start', 'end'].includes(k)) as (keyof typeof eventSchema)[];
    const body = parseBody(eventSchema, req.body, optional);
    const id = insertEvent(db, eventDefaults(body));
    changed('events');
    return reply.status(201).send(getEvent(db, id));
  });

  app.patch('/api/events/:id', async (req) => {
    requireEditor(req);
    const id = idParam(req.params);
    const current = getEvent(db, id);
    const patch = parsePatch(eventSchema, req.body);
    const feed = feedOf(db, current);
    const upstream = feed && Object.keys(patch).find((k) => !FAMILY_FIELDS.has(k));
    if (upstream) throw fromFeed(upstream, feed.name);
    const { id: _id, calendarId: _c, planId: _p, ...rest } = current;
    updateEvent(db, id, { ...rest, ...patch });
    changed('events', 'plans');
    return getEvent(db, id);
  });

  app.delete('/api/events/:id', async (req, reply) => {
    requireEditor(req);
    const ev = getEvent(db, idParam(req.params));
    const feed = feedOf(db, ev);
    if (feed) {
      throw new HttpError(409, 'read_only', `This comes from the “${feed.name}” calendar. Skip it here, or remove the calendar in Settings.`);
    }
    run(db, 'DELETE FROM events WHERE id = ?', ev.id);
    changed('events', 'plans');
    return reply.status(204).send();
  });

  // One occurrence of a repeating event: move it, cancel it, or give it a different driver.
  // Subscribed events can be skipped or given a driver, but not moved.
  app.put('/api/events/:id/occurrences/:date', async (req) => {
    requireEditor(req);
    const ev = getEvent(db, idParam(req.params));
    const date = (req.params as { date: string }).date;
    if (!isYmd(date)) throw badRequest('date: must be a date like 2026-10-05');
    if (!ev.rrule) throw badRequest('Only repeating events have single occurrences; edit the event instead');
    const patch = parsePatch({ start: v.dateTime, end: v.dateTime, driverId: v.optId, cancelled: v.bool }, req.body) as OccurrencePatch;
    const feed = feedOf(db, ev);
    if (feed && (patch.start || patch.end)) throw fromFeed('start', feed.name);
    const row = get<{ patch: string }>(db, 'SELECT patch FROM event_exceptions WHERE event_id = ? AND original_date = ?', ev.id, date);
    const merged: OccurrencePatch = { ...(row ? (JSON.parse(row.patch) as OccurrencePatch) : {}), ...patch };
    if (patch.start && !patch.end) merged.end = addMinutes(patch.start, durationMin(ev.start, ev.end));
    if (merged.start && merged.end && merged.end < merged.start) throw badRequest('end: must be after the start');
    if (merged.driverId) {
      const d = get<{ role: string }>(db, 'SELECT role FROM members WHERE id = ?', merged.driverId);
      if (d?.role !== 'adult') throw badRequest('driverId: the driver must be a parent');
    }
    run(
      db,
      `INSERT INTO event_exceptions (event_id, original_date, patch) VALUES (?, ?, ?)
       ON CONFLICT(event_id, original_date) DO UPDATE SET patch = excluded.patch`,
      ev.id, date, JSON.stringify(merged),
    );
    changed('events');
    return { ok: true };
  });

  app.delete('/api/events/:id/occurrences/:date', async (req, reply) => {
    requireEditor(req);
    const id = idParam(req.params);
    run(db, 'DELETE FROM event_exceptions WHERE event_id = ? AND original_date = ?', id, (req.params as { date: string }).date);
    changed('events');
    return reply.status(204).send();
  });
}
