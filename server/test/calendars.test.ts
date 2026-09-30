import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDays, ymd, type Calendar, type CalendarPreview, type EventRecord, type Occurrence, type SyncResult } from '../../shared/src/index.ts';
import { buildApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';
import { sessionFrom, setupFamily, type App } from './helpers.ts';

/** A stand-in calendar server: serves whatever feed the test sets, with ETag support. */
const feed = { body: '', etag: '"v1"', status: 200, lastHeaders: {} as IncomingHttpHeaders, hits: 0 };
let server: Server;
let feedUrl: string;
let app: App;

const today = ymd(new Date());
const day = (n: number) => addDays(today, n);
const compact = (n: number) => day(n).replaceAll('-', '');
const ics = (...events: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Riverside Soccer Club', ...events.flatMap((e) => ['BEGIN:VEVENT', e.trim(), 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');

const soccer = (title: string, time: string, extra = '') => `
UID:soccer@club
SUMMARY:${title}
DTSTART:${compact(1)}T${time}00
DURATION:PT1H
RRULE:FREQ=WEEKLY
LOCATION:Riverside Park
${extra}`;
const pictureDay = `UID:picture@club\nSUMMARY:Team picture day\nDTSTART;VALUE=DATE:${compact(3)}`;
const fieldTrip = `UID:trip@club\nSUMMARY:Tournament trip\nDTSTART;VALUE=DATE:${compact(5)}`;
const longAgo = `UID:old@club\nSUMMARY:Last season's party\nDTSTART;VALUE=DATE:${compact(-200)}`;

beforeEach(async () => {
  feed.body = ics(soccer('Soccer practice', '1700'), pictureDay, fieldTrip, longAgo);
  feed.etag = '"v1"';
  feed.status = 200;
  feed.hits = 0;
  server = createServer((req, res) => {
    feed.hits++;
    feed.lastHeaders = req.headers;
    if (feed.status !== 200) return res.writeHead(feed.status).end();
    if (req.headers['if-none-match'] === feed.etag) return res.writeHead(304).end();
    res.writeHead(200, { 'content-type': 'text/calendar', etag: feed.etag }).end(feed.body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  feedUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/club.ics`;
  app = await buildApp({ db: openDb(':memory:') });
});

afterEach(async () => {
  await app.close();
  await new Promise((r) => server.close(r));
});

describe('calendar subscriptions', () => {
  it('previews a feed before subscribing', async () => {
    const { adult } = await setupFamily(app);
    const res = await app.inject({ method: 'POST', url: '/api/calendars/preview', cookies: adult, payload: { url: feedUrl } });
    expect(res.statusCode).toBe(200);
    const p = res.json<CalendarPreview>();
    expect(p).toMatchObject({ name: 'Riverside Soccer Club', eventCount: 4, warnings: [] });
    expect(p.upcoming.slice(0, 3).map((o) => o.title)).toEqual(['Soccer practice', 'Team picture day', 'Tournament trip']);

    feed.body = '<html>Please sign in</html>';
    const bad = await app.inject({ method: 'POST', url: '/api/calendars/preview', cookies: adult, payload: { url: feedUrl } });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().message).toMatch(/calendar file/);
  });

  it('subscribes, keeps family changes through re-syncs, and follows upstream edits', async () => {
    const { adult, members } = await setupFamily(app);
    const [alex, robin, kit] = members;
    const created = await app.inject({
      method: 'POST', url: '/api/calendars', cookies: adult,
      payload: { url: feedUrl, name: 'Soccer club', color: '#1F9C62', memberIds: [kit.id] },
    });
    expect(created.statusCode).toBe(201);
    const cal = created.json<Calendar>();
    // Last season's party is too old to keep.
    expect(cal).toMatchObject({ kind: 'ics', eventCount: 3, lastError: null, memberIds: [kit.id] });
    expect(cal.lastSynced).toBeTruthy();

    const occs = async () => (await app.inject({ url: `/api/occurrences?from=${today}&to=${day(20)}`, cookies: adult })).json<Occurrence[]>();
    const practice = (await occs()).find((o) => o.title === 'Soccer practice')!;
    expect(practice).toMatchObject({ calendarId: cal.id, memberIds: [kit.id], icon: '⚽', category: 'sports', start: `${day(1)}T17:00` });
    const trip = (await occs()).find((o) => o.title === 'Tournament trip')!;

    // The family's own details on a subscribed event.
    const patch = (id: number, payload: object) => app.inject({ method: 'PATCH', url: `/api/events/${id}`, cookies: adult, payload });
    expect((await patch(practice.id, { driverId: alex.id, bring: 'Cleats', travelMin: 15 })).statusCode).toBe(200);
    expect((await patch(trip.id, { memberIds: [alex.id] })).statusCode).toBe(200);
    // …but what the feed says stays the feed's.
    const title = await patch(practice.id, { title: 'Renamed' });
    expect(title.statusCode).toBe(409);
    expect(title.json().message).toMatch(/Soccer club/);
    expect((await app.inject({ method: 'DELETE', url: `/api/events/${practice.id}`, cookies: adult })).statusCode).toBe(409);
    const occUrl = `/api/events/${practice.id}/occurrences/${day(15)}`;
    expect((await app.inject({ method: 'PUT', url: occUrl, cookies: adult, payload: { start: `${day(15)}T09:00` } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'PUT', url: occUrl, cookies: adult, payload: { driverId: robin.id } })).statusCode).toBe(200);

    // Upstream: practice moves to 5:30 and gets a new name, one week is cancelled, picture day is gone.
    feed.body = ics(soccer('Soccer practice (field 2)', '1730', `EXDATE:${compact(8)}T173000`), fieldTrip);
    feed.etag = '"v2"';
    const sync = (await app.inject({ method: 'POST', url: `/api/calendars/${cal.id}/sync`, cookies: adult })).json<SyncResult>();
    expect(sync).toMatchObject({ status: 'updated', added: 0, updated: 1, removed: 1 });
    expect(feed.lastHeaders['if-none-match']).toBe('"v1"');

    const after = (await occs()).filter((o) => o.calendarId === cal.id);
    expect(after.map((o) => [o.title, o.start, o.driverId])).toEqual([
      ['Soccer practice (field 2)', `${day(1)}T17:30`, alex.id],
      ['Tournament trip', `${day(5)}T00:00`, null],
      ['Soccer practice (field 2)', `${day(15)}T17:30`, robin.id],
    ]);
    expect(after[0]).toMatchObject({ bring: 'Cleats', travelMin: 15, memberIds: [kit.id], location: 'Riverside Park' });
    expect(after[1].memberIds).toEqual([alex.id]);

    // Nothing new upstream: the server answers 304 and nothing changes.
    const again = (await app.inject({ method: 'POST', url: `/api/calendars/${cal.id}/sync`, cookies: adult })).json<SyncResult>();
    expect(again.status).toBe('unchanged');

    // A broken link is reported, and the events already here stay.
    feed.status = 404;
    const broken = (await app.inject({ method: 'POST', url: `/api/calendars/${cal.id}/sync`, cookies: adult })).json<SyncResult>();
    expect(broken).toMatchObject({ status: 'error' });
    expect(broken.error).toMatch(/404/);
    const list = (await app.inject({ url: '/api/calendars', cookies: adult })).json<Calendar[]>();
    expect(list[0]).toMatchObject({ lastError: broken.error, eventCount: 2 });

    // Changing who the calendar is for moves events that still had the old default, not hand-picked ones.
    await app.inject({ method: 'PATCH', url: `/api/calendars/${cal.id}`, cookies: adult, payload: { memberIds: [kit.id, robin.id] } });
    const ev = (id: number) => app.inject({ url: `/api/events/${id}`, cookies: adult }).then((r) => r.json<EventRecord>());
    expect((await ev(practice.id)).memberIds).toEqual([robin.id, kit.id].sort((a, b) => a - b));
    expect((await ev(trip.id)).memberIds).toEqual([alex.id]);

    // Unsubscribing removes its events.
    expect((await app.inject({ method: 'DELETE', url: `/api/calendars/${cal.id}`, cookies: adult })).statusCode).toBe(204);
    expect((await occs()).some((o) => o.calendarId === cal.id)).toBe(false);
  });

  it('keeps secret links from kids and refuses duplicates', async () => {
    const { adult, members } = await setupFamily(app);
    const body = { url: feedUrl, name: 'Soccer club', color: '#1F9C62' };
    expect((await app.inject({ method: 'POST', url: '/api/calendars', cookies: adult, payload: body })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/api/calendars', cookies: adult, payload: body })).statusCode).toBe(409);

    const kid = sessionFrom(await app.inject({ method: 'POST', url: '/api/login', payload: { memberId: members[2].id } }));
    const seen = (await app.inject({ url: '/api/calendars', cookies: kid })).json<Calendar[]>();
    expect(seen[0]).toMatchObject({ name: 'Soccer club', url: null });
    expect((await app.inject({ method: 'POST', url: '/api/calendars', cookies: kid, payload: body })).statusCode).toBe(403);
  });
});
