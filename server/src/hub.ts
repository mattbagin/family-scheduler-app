import { readdirSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { HubSettings, Place, Weather } from '../../shared/src/index.ts';
import { getSetting, setSetting, type Db } from './db.ts';

export const DEFAULT_HUB: HubSettings = {
  photoDir: null, night: true, nightStart: '21:00', nightEnd: '06:30', place: null, tempUnit: 'c',
};

export function hubSettings(db: Db): HubSettings {
  let stored: Partial<HubSettings> = {};
  try {
    stored = JSON.parse(getSetting(db, 'hub', '{}')) as Partial<HubSettings>;
  } catch {
    /* a damaged value falls back to the defaults */
  }
  return { ...DEFAULT_HUB, ...stored };
}

export function saveHubSettings(db: Db, next: HubSettings) {
  setSetting(db, 'hub', JSON.stringify(next));
}

/* ---------- photos ---------- */

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
};
const MAX_PHOTOS = 5000;
const MAX_DEPTH = 4;

export const isFolder = (dir: string) => {
  try {
    return isAbsolute(dir) && statSync(dir).isDirectory();
  } catch {
    return false;
  }
};

const listCache = new Map<string, { at: number; photos: string[] }>();

/** Pictures in the folder and its subfolders (a few levels deep), as paths relative to it with `/`. */
export function listPhotos(dir: string, now = Date.now()): string[] {
  const hit = listCache.get(dir);
  if (hit && now - hit.at < 60_000) return hit.photos;
  const photos: string[] = [];
  const walk = (at: string, depth: number) => {
    let entries;
    try {
      entries = readdirSync(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (photos.length >= MAX_PHOTOS) return;
      if (e.name.startsWith('.') || e.name.startsWith('$')) continue;
      const full = join(at, e.name);
      if (e.isDirectory() && depth < MAX_DEPTH) walk(full, depth + 1);
      else if (e.isFile() && MIME[extname(e.name).toLowerCase()]) photos.push(relative(dir, full).split(sep).join('/'));
    }
  };
  walk(dir, 0);
  photos.sort();
  listCache.set(dir, { at: now, photos });
  return photos;
}

/** The file for a listed photo, or null if the path leaves the folder or isn't a picture. */
export function photoFile(dir: string, rel: string): { path: string; type: string } | null {
  const type = MIME[extname(rel).toLowerCase()];
  if (!type || rel.includes('\0')) return null;
  const root = resolve(dir);
  const path = resolve(root, rel);
  if (!path.startsWith(root + sep)) return null;
  try {
    return statSync(path).isFile() ? { path, type } : null;
  } catch {
    return null;
  }
}

/* ---------- weather (Open-Meteo, no API key) ---------- */

export interface WeatherApi {
  forecast: string;
  geocode: string;
}

export const OPEN_METEO: WeatherApi = {
  forecast: 'https://api.open-meteo.com/v1/forecast',
  geocode: 'https://geocoding-api.open-meteo.com/v1/search',
};

const TIMEOUT_MS = 10_000;
const FRESH_MS = 20 * 60_000;
/** A forecast this old is still better than nothing when Open-Meteo can't be reached. */
const STALE_MS = 6 * 60 * 60_000;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`the weather service answered ${res.status}`);
  return (await res.json()) as T;
}

interface GeoResult {
  results?: { name: string; latitude: number; longitude: number; country?: string; admin1?: string }[];
}

export async function searchPlaces(api: WeatherApi, q: string): Promise<Place[]> {
  const data = await getJson<GeoResult>(`${api.geocode}?name=${encodeURIComponent(q)}&count=6&language=en&format=json`);
  return (data.results ?? []).map((r) => ({
    name: r.name,
    detail: [r.admin1, r.country].filter(Boolean).join(', '),
    lat: Math.round(r.latitude * 1e4) / 1e4,
    lon: Math.round(r.longitude * 1e4) / 1e4,
  }));
}

interface Forecast {
  current: { temperature_2m: number; weather_code: number; is_day: number };
  daily: {
    time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[];
    precipitation_probability_max: (number | null)[];
  };
}

/** Remembers the last forecast per place and unit, so every screen shares one fetch. */
export function createWeather(api: WeatherApi) {
  let cache: { key: string; at: number; data: Weather } | null = null;
  return async (s: HubSettings, now = Date.now()): Promise<Weather | null> => {
    if (!s.place) return null;
    const { place, tempUnit } = s;
    const key = `${place.lat},${place.lon},${tempUnit}`;
    if (cache?.key === key && now - cache.at < FRESH_MS) return cache.data;
    try {
      const url = `${api.forecast}?latitude=${place.lat}&longitude=${place.lon}`
        + '&current=temperature_2m,weather_code,is_day'
        + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'
        + `&timezone=auto&forecast_days=3${tempUnit === 'f' ? '&temperature_unit=fahrenheit' : ''}`;
      const f = await getJson<Forecast>(url);
      const data: Weather = {
        place: place.name,
        unit: tempUnit,
        now: { temp: Math.round(f.current.temperature_2m), code: f.current.weather_code, isDay: f.current.is_day === 1 },
        days: f.daily.time.map((date, i) => ({
          date,
          hi: Math.round(f.daily.temperature_2m_max[i]),
          lo: Math.round(f.daily.temperature_2m_min[i]),
          code: f.daily.weather_code[i],
          rainChance: f.daily.precipitation_probability_max[i] ?? 0,
        })),
        fetchedAt: new Date(now).toISOString(),
      };
      cache = { key, at: now, data };
      return data;
    } catch (err) {
      if (cache?.key === key && now - cache.at < STALE_MS) return cache.data;
      throw err;
    }
  };
}
