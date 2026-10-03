import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { HubSettings, Place } from '../../../shared/src/index.ts';
import { requireAuth, requireEditor } from '../auth.ts';
import { backupNow, listBackups, type BackupOptions } from '../backup.ts';
import type { Ctx } from '../context.ts';
import { badRequest, HttpError, parsePatch, v } from '../http.ts';
import { createWeather, hubSettings, isFolder, listPhotos, photoFile, saveHubSettings, searchPlaces, type WeatherApi } from '../hub.ts';
import { isHhmm } from '../nudges/nudger.ts';

const hhmm = (x: unknown, f: string) => {
  if (!isHhmm(x)) throw badRequest(`${f}: must be a time like 21:00`);
  return x;
};

const photoDir = (x: unknown, f: string): string | null => {
  const dir = v.optText(500)(x, f);
  if (dir !== null && !isFolder(dir)) {
    const example = process.platform === 'win32' ? 'C:\\Users\\you\\Pictures\\Family' : '/Users/you/Homebase Photos';
    throw badRequest(`${f}: can’t find that folder on the home computer. Paste its full path, like ${example}`);
  }
  return dir;
};

const place = (x: unknown, f: string): Place | null => {
  if (x === null) return null;
  const p = (x ?? {}) as Record<string, unknown>;
  const coord = (n: unknown, max: number, name: string) => {
    if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > max) throw badRequest(`${f}.${name}: must be a number from -${max} to ${max}`);
    return n;
  };
  return {
    name: v.text(80)(p.name, `${f}.name`),
    detail: v.optText(120)(p.detail, `${f}.detail`) ?? '',
    lat: coord(p.lat, 90, 'lat'),
    lon: coord(p.lon, 180, 'lon'),
  };
};

export function hubRoutes(app: FastifyInstance, { db, changed }: Ctx, opts: { weatherApi: WeatherApi; backup?: BackupOptions }) {
  const weather = createWeather(opts.weatherApi);
  const withCount = (s: HubSettings) => ({ ...s, photoCount: s.photoDir && isFolder(s.photoDir) ? listPhotos(s.photoDir).length : null });

  app.get('/api/hub-settings', async (req) => {
    requireAuth(req);
    return withCount(hubSettings(db));
  });

  app.patch('/api/hub-settings', async (req) => {
    requireEditor(req);
    const p = parsePatch({
      photoDir, night: v.bool, nightStart: hhmm, nightEnd: hhmm, place, tempUnit: v.oneOf('c', 'f'),
    }, req.body);
    const next = { ...hubSettings(db), ...p };
    saveHubSettings(db, next);
    changed('hub');
    return withCount(next);
  });

  /* ---------- photos for the ambient screen ---------- */

  app.get('/api/photos', async (req) => {
    requireAuth(req);
    const { photoDir: dir } = hubSettings(db);
    return dir && isFolder(dir) ? listPhotos(dir) : [];
  });

  app.get('/api/photos/file', async (req, reply) => {
    requireAuth(req);
    const { photoDir: dir } = hubSettings(db);
    const rel = (req.query as { p?: unknown }).p;
    const file = dir && typeof rel === 'string' ? photoFile(dir, rel) : null;
    if (!file) throw new HttpError(404, 'not_found', 'That photo isn’t in the photo folder');
    return reply.type(file.type).header('cache-control', 'private, max-age=86400').send(createReadStream(file.path));
  });

  /* ---------- weather ---------- */

  app.get('/api/places', async (req) => {
    requireEditor(req);
    const q = v.text(80)((req.query as { q?: unknown }).q, 'q');
    try {
      return await searchPlaces(opts.weatherApi, q);
    } catch {
      throw new HttpError(502, 'weather_unavailable', 'Couldn’t reach the weather service. Check the home computer’s internet connection and try again.');
    }
  });

  app.get('/api/weather', async (req) => {
    requireAuth(req);
    try {
      return { weather: await weather(hubSettings(db)) };
    } catch (err) {
      req.log.warn(err, 'weather fetch failed');
      throw new HttpError(502, 'weather_unavailable', 'The weather service can’t be reached right now');
    }
  });

  /* ---------- backups ---------- */

  app.get('/api/backups', async (req) => {
    requireEditor(req);
    return opts.backup ? listBackups(opts.backup) : null;
  });

  app.post('/api/backups', async (req) => {
    requireEditor(req);
    if (!opts.backup) throw new HttpError(409, 'no_backups', 'Backups aren’t set up on this server');
    backupNow(db, opts.backup);
    return listBackups(opts.backup);
  });
}
