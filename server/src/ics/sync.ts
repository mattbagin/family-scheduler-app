import {
  addDays, expandEvent, ymd, type EventRecord, type LiveTopic, type OccurrencePatch, type SyncResult, type Ymd,
} from '../../../shared/src/index.ts';
import { all, get, run, tx, type Db } from '../db.ts';
import { badRequest } from '../http.ts';
import { eventDefaults, insertEvent } from '../routes/events.ts';
import { FeedError, parseIcs, type IcsCalendar, type IcsEvent } from './parse.ts';
import { familyZone } from './zones.ts';

const MAX_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
/** One-off events that ended longer ago than this aren't kept (school feeds go back years). */
const KEEP_PAST_DAYS = 60;

/** Accepts https://, http:// and webcal:// links (webcal is just https for calendars). */
export function normalizeFeedUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw badRequest('url: paste the calendar’s link');
  let u: URL;
  try {
    u = new URL(raw.trim().replace(/^webcals?:\/\//i, 'https://'));
  } catch {
    throw badRequest('url: that doesn’t look like a link. It should start with https:// or webcal://');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw badRequest('url: the link should start with https:// or webcal://');
  return u.toString();
}

type Fetched = { notModified: true } | { notModified: false; text: string; etag: string | null; lastModified: string | null };

export async function fetchFeed(url: string, cache: { etag?: string | null; lastModified?: string | null } = {}): Promise<Fetched> {
  const host = new URL(url).host;
  const headers: Record<string, string> = { 'user-agent': 'Homebase family calendar', accept: 'text/calendar, */*;q=0.5' };
  if (cache.etag) headers['if-none-match'] = cache.etag;
  if (cache.lastModified) headers['if-modified-since'] = cache.lastModified;
  let res: Response;
  try {
    res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError') throw new FeedError(`${host} took too long to answer.`);
    throw new FeedError(`Couldn’t reach ${host}. Check the link and the home internet connection.`);
  }
  if (res.status === 304) return { notModified: true };
  if (!res.ok) {
    await res.body?.cancel();
    const hint = res.status === 401 || res.status === 403 || res.status === 404
      ? ' The link may be wrong, private, or reset. Copy it again from the calendar’s settings.'
      : '';
    throw new FeedError(`${host} answered “${res.status} ${res.statusText}”.${hint}`);
  }
  if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) throw new FeedError('That calendar is too big (over 10 MB).');
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body!.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new FeedError('That calendar is too big (over 10 MB).');
    }
    chunks.push(value);
  }
  return {
    notModified: false,
    text: new TextDecoder().decode(Buffer.concat(chunks)),
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
  };
}

/** The next few occurrences in a parsed feed, for the "is this the right calendar?" preview. */
export function upcomingOf(events: IcsEvent[], from: Ymd, to: Ymd, limit: number) {
  return events
    .flatMap((e) => {
      const rec: EventRecord = {
        id: 0, calendarId: null, title: e.title, kidTitle: null, icon: '', category: 'other', start: e.start, end: e.end,
        allDay: e.allDay, rrule: e.rrule, location: e.location, notes: null, bring: null, travelMin: 0, driverId: null,
        needsDriver: false, fun: false, memberIds: [], planId: null,
      };
      const skips = new Map<Ymd, OccurrencePatch>(e.exdates.map((d) => [d, { cancelled: true }]));
      return expandEvent(rec, skips, from, to).map((o) => ({ title: o.title, start: o.start, allDay: o.allDay, repeats: !!o.rrule }));
    })
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
    .slice(0, limit);
}

interface ExtRow {
  id: number;
  ext_uid: string;
  title: string;
  start: string;
  end: string;
  all_day: number;
  rrule: string | null;
  exdates: string | null;
  location: string | null;
  notes: string | null;
}

/**
 * Makes the calendar's events match the feed. Only the upstream fields (title, time, repeat,
 * place, description) are written; who's going, the driver, what to bring and the picture are
 * family choices kept on the same row, so they survive every re-sync.
 */
export function applyFeed(db: Db, calendarId: number, feed: IcsCalendar, today: Ymd) {
  const existing = new Map(
    all<ExtRow>(
      db,
      'SELECT id, ext_uid, title, start, end, all_day, rrule, exdates, location, notes FROM events WHERE calendar_id = ? AND ext_uid IS NOT NULL',
      calendarId,
    ).map((r) => [r.ext_uid, r]),
  );
  const memberIds = all<{ member_id: number }>(db, 'SELECT member_id FROM calendar_members WHERE calendar_id = ?', calendarId).map((r) => r.member_id);
  const keepFrom = `${addDays(today, -KEEP_PAST_DAYS)}T00:00`;
  const seen = new Set<string>();
  const counts = { added: 0, updated: 0, removed: 0 };

  tx(db, () => {
    for (const e of feed.events) {
      if (!e.rrule && e.end < keepFrom) continue;
      seen.add(e.uid);
      const exdates = e.exdates.length ? e.exdates.join(',') : null;
      const row = existing.get(e.uid);
      if (!row) {
        const id = insertEvent(db, eventDefaults({
          title: e.title, start: e.start, end: e.end, allDay: e.allDay, rrule: e.rrule, location: e.location, notes: e.notes, memberIds,
        }), calendarId);
        run(db, 'UPDATE events SET ext_uid = ?, exdates = ? WHERE id = ?', e.uid, exdates, id);
        counts.added++;
        continue;
      }
      const same = row.title === e.title && row.start === e.start && row.end === e.end && !!row.all_day === e.allDay
        && row.rrule === e.rrule && row.exdates === exdates && row.location === e.location && row.notes === e.notes;
      if (same) continue;
      run(
        db, 'UPDATE events SET title = ?, start = ?, end = ?, all_day = ?, rrule = ?, exdates = ?, location = ?, notes = ? WHERE id = ?',
        e.title, e.start, e.end, e.allDay ? 1 : 0, e.rrule, exdates, e.location, e.notes, row.id,
      );
      if (row.title !== e.title) run(db, 'UPDATE plans SET title = ? WHERE event_id = ?', e.title, row.id);
      counts.updated++;
    }
    for (const [uid, row] of existing) {
      if (seen.has(uid)) continue;
      run(db, 'DELETE FROM events WHERE id = ?', row.id);
      counts.removed++;
    }
  });
  return counts;
}

const inflight = new WeakMap<Db, Map<number, Promise<SyncResult>>>();

/** Fetches one subscribed calendar and applies it. Never throws: failures land in last_error. */
export function syncCalendar(db: Db, id: number, now = new Date()): Promise<SyncResult> {
  const running = inflight.get(db) ?? new Map<number, Promise<SyncResult>>();
  inflight.set(db, running);
  const existing = running.get(id);
  if (existing) return existing;
  const p = doSync(db, id, now).finally(() => running.delete(id));
  running.set(id, p);
  return p;
}

async function doSync(db: Db, id: number, now: Date): Promise<SyncResult> {
  const cal = get<{ url: string; etag: string | null; last_modified: string | null }>(
    db, "SELECT url, etag, last_modified FROM calendars WHERE id = ? AND kind = 'ics'", id,
  );
  if (!cal) return { status: 'error', added: 0, updated: 0, removed: 0, error: 'Calendar not found' };
  const stamp = now.toISOString();
  run(db, 'UPDATE calendars SET last_attempt = ? WHERE id = ?', stamp, id);
  try {
    const res = await fetchFeed(cal.url, { etag: cal.etag, lastModified: cal.last_modified });
    // It may have been removed while we were waiting on the network.
    if (!get(db, 'SELECT 1 FROM calendars WHERE id = ?', id)) return { status: 'error', added: 0, updated: 0, removed: 0, error: 'Calendar not found' };
    if (res.notModified) {
      run(db, 'UPDATE calendars SET last_synced = ?, last_error = NULL WHERE id = ?', stamp, id);
      return { status: 'unchanged', added: 0, updated: 0, removed: 0, error: null };
    }
    const counts = applyFeed(db, id, parseIcs(res.text, familyZone()), ymd(now));
    run(
      db, 'UPDATE calendars SET etag = ?, last_modified = ?, last_synced = ?, last_error = NULL WHERE id = ?',
      res.etag, res.lastModified, stamp, id,
    );
    return { status: 'updated', ...counts, error: null };
  } catch (e) {
    const error = e instanceof FeedError ? e.message : 'Something went wrong reading this calendar.';
    if (!(e instanceof FeedError)) console.error(`Calendar ${id} sync failed`, e);
    run(db, 'UPDATE calendars SET last_error = ? WHERE id = ?', error, id);
    return { status: 'error', added: 0, updated: 0, removed: 0, error };
  }
}

/** Topics to broadcast after a sync: the calendar list always (sync time), events if any changed. */
export const syncTopics = (r: SyncResult): LiveTopic[] =>
  r.added + r.updated + r.removed > 0 ? ['calendars', 'events', 'plans'] : ['calendars'];

/** Checks every minute for calendars due a refresh (each has its own interval, 30 min by default). */
export function startPoller(db: Db, changed: (...topics: LiveTopic[]) => void, everyMs = 60_000): () => void {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const due = all<{ id: number; refresh_min: number; last_attempt: string | null }>(
        db, "SELECT id, refresh_min, last_attempt FROM calendars WHERE kind = 'ics'",
      ).filter((c) => !c.last_attempt || Date.parse(c.last_attempt) + c.refresh_min * 60_000 <= Date.now());
      for (const c of due) changed(...syncTopics(await syncCalendar(db, c.id)));
    } finally {
      busy = false;
    }
  };
  const first = setTimeout(tick, 5_000);
  const timer = setInterval(tick, everyMs);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
