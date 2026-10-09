import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { weatherLook, type BackupInfo, type HubSettings, type Place, type Weather } from '../../shared/src/index.ts';
import { buildApp } from '../src/app.ts';
import { backupDue, backupNow, listBackups } from '../src/backup.ts';
import { openDb } from '../src/db.ts';
import { setupFamily, type App } from './helpers.ts';

/** A stand-in for Open-Meteo's forecast and place search. */
const meteo = { hits: 0, fail: false, lastQuery: '' };
let server: Server;
let base: string;
let app: App;
let dir: string;

beforeEach(async () => {
  meteo.hits = 0;
  meteo.fail = false;
  server = createServer((req, res) => {
    meteo.hits++;
    meteo.lastQuery = req.url ?? '';
    if (meteo.fail) {
      res.writeHead(500).end();
      return;
    }
    res.setHeader('content-type', 'application/json');
    if (req.url?.startsWith('/geo')) {
      res.end(JSON.stringify({ results: [{ name: 'Guelph', latitude: 43.54594, longitude: -80.25599, admin1: 'Ontario', country: 'Canada' }] }));
      return;
    }
    res.end(JSON.stringify({
      current: { temperature_2m: 17.6, weather_code: 61, is_day: 1 },
      daily: {
        time: ['2026-09-30', '2026-10-01', '2026-10-02'], weather_code: [61, 0, 3],
        temperature_2m_max: [19.4, 21.2, 15], temperature_2m_min: [8.6, 9.1, 7], precipitation_probability_max: [80, 5, null],
      },
    }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  dir = mkdtempSync(join(tmpdir(), 'homebase-hub-'));
  app = await buildApp({
    db: openDb(':memory:'),
    weatherApi: { forecast: `${base}/forecast`, geocode: `${base}/geo` },
    backup: { dir: join(dir, 'backups'), keep: 2 },
  });
});

afterEach(async () => {
  await app.close();
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

const guelph: Place = { name: 'Guelph', detail: 'Ontario, Canada', lat: 43.5459, lon: -80.256 };

describe('hub settings', () => {
  it('has sensible defaults and only parents can change them', async () => {
    const { adult } = await setupFamily(app);
    const s = (await app.inject({ url: '/api/hub-settings', cookies: adult })).json<HubSettings & { photoCount: number | null }>();
    expect(s).toMatchObject({ photoDir: null, night: true, nightStart: '21:00', nightEnd: '06:30', eveningStart: '19:30', place: null, tempUnit: 'c', photoCount: null });

    const hub = await app.inject({ method: 'POST', url: '/api/login', payload: { memberId: 1, pin: '2468', asHub: true } });
    const hubCookie = { hb_session: hub.cookies.find((c) => c.name === 'hb_session')!.value };
    const locked = await app.inject({ method: 'PATCH', url: '/api/hub-settings', cookies: hubCookie, payload: { night: false } });
    expect(locked.statusCode).toBe(403);

    const res = await app.inject({ method: 'PATCH', url: '/api/hub-settings', cookies: adult, payload: { nightStart: '22:15', tempUnit: 'f' } });
    expect(res.json()).toMatchObject({ nightStart: '22:15', nightEnd: '06:30', tempUnit: 'f' });
    const bad = await app.inject({ method: 'PATCH', url: '/api/hub-settings', cookies: adult, payload: { nightEnd: '25:00' } });
    expect(bad.json().message).toBe('nightEnd: must be a time like 21:00');

    // The evening Tomorrow board can move or be switched off.
    expect((await app.inject({ method: 'PATCH', url: '/api/hub-settings', cookies: adult, payload: { eveningStart: '20:00' } })).json()).toMatchObject({ eveningStart: '20:00' });
    expect((await app.inject({ method: 'PATCH', url: '/api/hub-settings', cookies: adult, payload: { eveningStart: null } })).json()).toMatchObject({ eveningStart: null });
    const badEvening = await app.inject({ method: 'PATCH', url: '/api/hub-settings', cookies: adult, payload: { eveningStart: 'soon' } });
    expect(badEvening.json().message).toBe('eveningStart: must be a time like 21:00');
  });
});

describe('photos', () => {
  it('lists pictures in the folder and its subfolders and serves only those', async () => {
    const { adult } = await setupFamily(app);
    const photos = join(dir, 'photos');
    mkdirSync(join(photos, '2025 Summer'), { recursive: true });
    writeFileSync(join(photos, 'beach.JPG'), 'jpeg bytes');
    writeFileSync(join(photos, '2025 Summer', 'camp.png'), 'png bytes');
    writeFileSync(join(photos, 'notes.txt'), 'not a picture');
    writeFileSync(join(dir, 'secret.jpg'), 'outside the folder');

    const missing = await app.inject({ method: 'PATCH', url: '/api/hub-settings', cookies: adult, payload: { photoDir: join(dir, 'nope') } });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().message).toMatch(/^photoDir: can’t find that folder/);

    const saved = await app.inject({ method: 'PATCH', url: '/api/hub-settings', cookies: adult, payload: { photoDir: photos } });
    expect(saved.json().photoCount).toBe(2);
    const list = (await app.inject({ url: '/api/photos', cookies: adult })).json<string[]>();
    expect(list).toEqual(['2025 Summer/camp.png', 'beach.JPG']);

    const img = await app.inject({ url: `/api/photos/file?p=${encodeURIComponent('2025 Summer/camp.png')}`, cookies: adult });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.body).toBe('png bytes');

    for (const p of ['../secret.jpg', 'notes.txt', join(dir, 'secret.jpg')]) {
      const r = await app.inject({ url: `/api/photos/file?p=${encodeURIComponent(p)}`, cookies: adult });
      expect(r.statusCode, p).toBe(404);
    }
    expect((await app.inject({ url: '/api/photos' })).statusCode).toBe(401);
  });
});

describe('weather', () => {
  it('finds a place, then shares one cached forecast', async () => {
    const { adult } = await setupFamily(app);
    expect((await app.inject({ url: '/api/weather', cookies: adult })).json()).toEqual({ weather: null });

    const places = (await app.inject({ url: '/api/places?q=Guelph', cookies: adult })).json<Place[]>();
    expect(places).toEqual([guelph]);
    await app.inject({ method: 'PATCH', url: '/api/hub-settings', cookies: adult, payload: { place: places[0] } });

    meteo.hits = 0;
    const w = (await app.inject({ url: '/api/weather', cookies: adult })).json<{ weather: Weather }>().weather;
    expect(w.now).toEqual({ temp: 18, code: 61, isDay: true });
    expect(w.days[0]).toEqual({ date: '2026-09-30', hi: 19, lo: 9, code: 61, rainChance: 80 });
    expect(w.days[2].rainChance).toBe(0);
    expect(meteo.lastQuery).toContain('latitude=43.5459');
    expect(meteo.lastQuery).not.toContain('fahrenheit');
    await app.inject({ url: '/api/weather', cookies: adult });
    expect(meteo.hits).toBe(1);

    // A new unit is a new forecast; when the service is down the last one is kept.
    await app.inject({ method: 'PATCH', url: '/api/hub-settings', cookies: adult, payload: { tempUnit: 'f' } });
    await app.inject({ url: '/api/weather', cookies: adult });
    expect(meteo.lastQuery).toContain('temperature_unit=fahrenheit');
    meteo.fail = true;
    await app.inject({ method: 'PATCH', url: '/api/hub-settings', cookies: adult, payload: { tempUnit: 'c' } });
    const down = await app.inject({ url: '/api/weather', cookies: adult });
    expect(down.statusCode).toBe(502);
    expect((await app.inject({ url: '/api/places?q=x', cookies: adult })).json().error).toBe('weather_unavailable');
  });

  it('turns weather codes into pictures', () => {
    expect(weatherLook(0)).toEqual({ icon: '☀️', text: 'Clear' });
    expect(weatherLook(0, false).icon).toBe('🌙');
    expect(weatherLook(95).text).toBe('Thunderstorms');
    expect(weatherLook(1234).icon).toBe('🌡️');
  });
});

describe('backups', () => {
  it('copies the database and keeps only the newest few', async () => {
    const { adult } = await setupFamily(app);
    const info = (await app.inject({ method: 'POST', url: '/api/backups', cookies: adult })).json<BackupInfo>();
    expect(info.files).toHaveLength(1);
    const copy = new DatabaseSync(join(info.dir, info.files[0].name));
    expect(copy.prepare('SELECT name FROM members ORDER BY id').all().map((r) => r.name)).toEqual(['Alex', 'Robin', 'Kit']);
    copy.close();

    const db = openDb(':memory:');
    const opts = { dir: join(dir, 'nightly'), keep: 2 };
    expect(backupDue(opts, new Date(2026, 8, 30, 1, 0))).toBe(true); // none yet: back up right away
    backupNow(db, opts, new Date(2026, 8, 28, 3, 0));
    backupNow(db, opts, new Date(2026, 8, 29, 3, 0));
    expect(backupDue(opts, new Date(2026, 8, 30, 1, 0))).toBe(false); // wait for 3 AM
    expect(backupDue(opts, new Date(2026, 8, 30, 3, 5))).toBe(true);
    backupNow(db, opts, new Date(2026, 8, 30, 3, 5));
    expect(backupDue(opts, new Date(2026, 8, 30, 14, 0))).toBe(false);
    const names = listBackups(opts).files.map((f) => f.name);
    expect(names).toEqual(['homebase-2026-09-30-0305.db', 'homebase-2026-09-29-0300.db']);
    db.close();
  });
});
