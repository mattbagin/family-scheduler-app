import type { FastifyInstance } from 'fastify';
import { addDays, ymd, type CalendarPreview } from '../../../shared/src/index.ts';
import { canEdit, requireAuth, requireEditor } from '../auth.ts';
import type { Ctx } from '../context.ts';
import { all, get, run, tx, type Db } from '../db.ts';
import { badRequest, HttpError, idParam, parseBody, parsePatch, v } from '../http.ts';
import { FeedError, parseIcs } from '../ics/parse.ts';
import { fetchFeed, normalizeFeedUrl, syncCalendar, syncTopics, upcomingOf } from '../ics/sync.ts';
import { familyZone } from '../ics/zones.ts';
import { getCalendar, listCalendars } from '../repo.ts';

const calendarSchema = {
  url: normalizeFeedUrl as (x: unknown, f: string) => string,
  name: v.text(60),
  color: v.color,
  memberIds: v.ids,
  refreshMin: v.int(5, 24 * 60),
};

function checkMembers(db: Db, ids: number[]) {
  for (const id of ids) {
    if (!get(db, 'SELECT 1 FROM members WHERE id = ?', id)) throw badRequest(`memberIds: no family member with id ${id}`);
  }
}

function assertNewUrl(db: Db, url: string, exceptId = 0) {
  const dup = get<{ name: string }>(db, 'SELECT name FROM calendars WHERE url = ? AND id != ?', url, exceptId);
  if (dup) throw new HttpError(409, 'exists', `You’re already subscribed to that link as “${dup.name}”`);
}

function writeMembers(db: Db, calendarId: number, memberIds: number[]) {
  run(db, 'DELETE FROM calendar_members WHERE calendar_id = ?', calendarId);
  for (const m of memberIds) run(db, 'INSERT INTO calendar_members (calendar_id, member_id) VALUES (?, ?)', calendarId, m);
}

/**
 * Changing who a calendar is for re-assigns its events that still have the old default people.
 * Events the family has assigned by hand are left alone.
 */
function reassignEvents(db: Db, calendarId: number, from: number[], to: number[]) {
  const key = (ids: number[]) => [...ids].sort((a, b) => a - b).join(',');
  const old = key(from);
  const rows = all<{ id: number; ids: string | null }>(
    db,
    `SELECT e.id, (SELECT group_concat(member_id) FROM event_members em WHERE em.event_id = e.id) AS ids
     FROM events e WHERE e.calendar_id = ?`,
    calendarId,
  );
  for (const r of rows) {
    if (key(r.ids ? r.ids.split(',').map(Number) : []) !== old) continue;
    run(db, 'DELETE FROM event_members WHERE event_id = ?', r.id);
    for (const m of to) run(db, 'INSERT INTO event_members (event_id, member_id) VALUES (?, ?)', r.id, m);
  }
}

export function calendarRoutes(app: FastifyInstance, { db, changed }: Ctx) {
  app.get('/api/calendars', async (req) => {
    const a = requireAuth(req);
    return listCalendars(db, canEdit(a));
  });

  // Look inside a link before subscribing: its name, how many events, and what's coming up.
  app.post('/api/calendars/preview', async (req): Promise<CalendarPreview> => {
    requireEditor(req);
    const url = normalizeFeedUrl((req.body as { url?: unknown } | null)?.url);
    try {
      const res = await fetchFeed(url);
      if (res.notModified) throw new FeedError('The calendar server sent nothing back.');
      const feed = parseIcs(res.text, familyZone());
      const today = ymd(new Date());
      return { url, name: feed.name, eventCount: feed.events.length, upcoming: upcomingOf(feed.events, today, addDays(today, 90), 8), warnings: feed.warnings };
    } catch (e) {
      if (e instanceof FeedError) throw new HttpError(422, 'feed', e.message);
      throw e;
    }
  });

  app.post('/api/calendars', async (req, reply) => {
    requireEditor(req);
    const c = parseBody(calendarSchema, req.body, ['memberIds', 'refreshMin']);
    const memberIds = c.memberIds ?? [];
    checkMembers(db, memberIds);
    assertNewUrl(db, c.url);
    const id = tx(db, () => {
      const { id } = run(
        db, "INSERT INTO calendars (name, kind, url, color, refresh_min) VALUES (?, 'ics', ?, ?, ?)",
        c.name, c.url, c.color, c.refreshMin ?? 30,
      );
      writeMembers(db, id, memberIds);
      return id;
    });
    const result = await syncCalendar(db, id);
    changed(...syncTopics(result));
    return reply.status(201).send(getCalendar(db, id));
  });

  app.patch('/api/calendars/:id', async (req) => {
    requireEditor(req);
    const cal = getCalendar(db, idParam(req.params));
    if (cal.kind !== 'ics') throw badRequest('Only subscribed calendars can be changed here');
    const p = parsePatch(calendarSchema, req.body);
    if (p.memberIds) checkMembers(db, p.memberIds);
    const newUrl = p.url !== undefined && p.url !== cal.url;
    if (newUrl) assertNewUrl(db, p.url!, cal.id);
    tx(db, () => {
      run(
        db, 'UPDATE calendars SET name = ?, color = ?, refresh_min = ? WHERE id = ?',
        p.name ?? cal.name, p.color ?? cal.color, p.refreshMin ?? cal.refreshMin, cal.id,
      );
      if (newUrl) run(db, 'UPDATE calendars SET url = ?, etag = NULL, last_modified = NULL WHERE id = ?', p.url!, cal.id);
      if (p.memberIds) {
        writeMembers(db, cal.id, p.memberIds);
        reassignEvents(db, cal.id, cal.memberIds, p.memberIds);
      }
    });
    changed('calendars', 'events');
    if (newUrl) changed(...syncTopics(await syncCalendar(db, cal.id)));
    return getCalendar(db, cal.id);
  });

  app.delete('/api/calendars/:id', async (req, reply) => {
    requireEditor(req);
    const cal = getCalendar(db, idParam(req.params));
    run(db, 'DELETE FROM calendars WHERE id = ?', cal.id);
    changed('calendars', 'events', 'plans');
    return reply.status(204).send();
  });

  // Refresh now instead of waiting for the next scheduled check.
  app.post('/api/calendars/:id/sync', async (req) => {
    requireEditor(req);
    const cal = getCalendar(db, idParam(req.params));
    if (cal.kind !== 'ics') throw badRequest('Only subscribed calendars can be refreshed');
    const result = await syncCalendar(db, cal.id);
    changed(...syncTopics(result));
    return result;
  });
}
