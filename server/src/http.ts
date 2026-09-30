import { isLocalDateTime, isYmd } from '../../shared/src/index.ts';

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message: string) => new HttpError(400, 'invalid', message);
export const notFound = (what: string) => new HttpError(404, 'not_found', `${what} not found`);

/*
 * Tiny validators. Each takes (value, field) and returns the cleaned value or throws a 400
 * naming the field, so API errors read like "title: must be text".
 */
type Check<T> = (v: unknown, field: string) => T;

export const v = {
  text:
    (max = 200): Check<string> =>
    (x, f) => {
      if (typeof x !== 'string' || !x.trim()) throw badRequest(`${f}: must be non-empty text`);
      if (x.length > max) throw badRequest(`${f}: must be at most ${max} characters`);
      return x.trim();
    },
  optText:
    (max = 2000): Check<string | null> =>
    (x, f) => {
      if (x === null || x === undefined || x === '') return null;
      if (typeof x !== 'string') throw badRequest(`${f}: must be text`);
      if (x.length > max) throw badRequest(`${f}: must be at most ${max} characters`);
      return x.trim() || null;
    },
  int:
    (min = 0, max = Number.MAX_SAFE_INTEGER): Check<number> =>
    (x, f) => {
      if (typeof x !== 'number' || !Number.isInteger(x) || x < min || x > max) throw badRequest(`${f}: must be a whole number from ${min} to ${max}`);
      return x;
    },
  optId: ((x, f) => {
    if (x === null || x === undefined) return null;
    if (typeof x !== 'number' || !Number.isInteger(x) || x < 1) throw badRequest(`${f}: must be an id or null`);
    return x;
  }) as Check<number | null>,
  bool: ((x, f) => {
    if (typeof x !== 'boolean') throw badRequest(`${f}: must be true or false`);
    return x;
  }) as Check<boolean>,
  ymd: ((x, f) => {
    if (!isYmd(x)) throw badRequest(`${f}: must be a date like 2026-10-05`);
    return x;
  }) as Check<string>,
  dateTime: ((x, f) => {
    if (!isLocalDateTime(x)) throw badRequest(`${f}: must be a date and time like 2026-10-05T16:30`);
    return x;
  }) as Check<string>,
  ids: ((x, f) => {
    if (!Array.isArray(x) || !x.every((i) => Number.isInteger(i) && i > 0)) throw badRequest(`${f}: must be a list of ids`);
    return [...new Set(x as number[])];
  }) as Check<number[]>,
  weekdays: ((x, f) => {
    if (!Array.isArray(x) || !x.length || !x.every((i) => Number.isInteger(i) && i >= 0 && i <= 6)) throw badRequest(`${f}: must list weekdays 0 (Mon) to 6 (Sun)`);
    return [...new Set(x as number[])].sort();
  }) as Check<number[]>,
  oneOf:
    <T extends string>(...opts: T[]): Check<T> =>
    (x, f) => {
      if (!opts.includes(x as T)) throw badRequest(`${f}: must be one of ${opts.join(', ')}`);
      return x as T;
    },
  color: ((x, f) => {
    if (typeof x !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(x)) throw badRequest(`${f}: must be a hex color like #2F7DE1`);
    return x.toUpperCase();
  }) as Check<string>,
  pin: ((x, f) => {
    if (typeof x !== 'string' || !/^\d{4,8}$/.test(x)) throw badRequest(`${f}: must be 4 to 8 digits`);
    return x;
  }) as Check<string>,
};

type Schema = Record<string, Check<unknown>>;
type Out<S extends Schema> = { [K in keyof S]: ReturnType<S[K]> };

/** Validates every field (a create). */
export function parseBody<S extends Schema>(schema: S, body: unknown, optional: (keyof S)[] = []): Out<S> {
  const b = asObject(body);
  const out: Record<string, unknown> = {};
  for (const [k, check] of Object.entries(schema)) {
    if (b[k] === undefined && optional.includes(k)) continue;
    out[k] = check(b[k], k);
  }
  return out as Out<S>;
}

/** Validates only the fields present (an update). */
export function parsePatch<S extends Schema>(schema: S, body: unknown): Partial<Out<S>> {
  const b = asObject(body);
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(b)) {
    if (!(k in schema)) throw badRequest(`${k}: unknown field`);
    out[k] = schema[k](val, k);
  }
  return out as Partial<Out<S>>;
}

function asObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Request body must be a JSON object');
  return body as Record<string, unknown>;
}

export function idParam(params: unknown, name = 'id'): number {
  const raw = (params as Record<string, string>)[name];
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) throw badRequest(`${name}: must be an id`);
  return id;
}
