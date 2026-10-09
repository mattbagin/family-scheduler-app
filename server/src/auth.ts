import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Member, SessionInfo } from '../../shared/src/index.ts';
import { get, run, type Db } from './db.ts';
import { HttpError } from './http.ts';
import { toMember, type MemberRow } from './repo.ts';

export const SESSION_COOKIE = 'hb_session';
/** How long a parent's PIN unlock lasts on the hub or a kid's device. */
export const UNLOCK_MS = 10 * 60 * 1000;

export interface Auth {
  token: string;
  kind: 'member' | 'hub';
  member: Member | null;
  elevatedUntil: number | null;
  /** The parent whose PIN unlocked this session. */
  elevatedBy: number | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: Auth | null;
  }
}

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(pin, salt, 32).toString('hex')}`;
}

function pinMatches(pin: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(pin, Buffer.from(salt, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

// Slow down guessing: after 5 wrong PINs a member is locked out for a minute.
const attemptsByDb = new WeakMap<Db, Map<number, { fails: number; lockedUntil: number }>>();

export function verifyPin(db: Db, row: MemberRow, pin: unknown) {
  if (!row.pin_hash) throw new HttpError(400, 'no_pin', `${row.name} has no PIN yet`);
  const attempts = attemptsByDb.get(db) ?? new Map<number, { fails: number; lockedUntil: number }>();
  attemptsByDb.set(db, attempts);
  const a = attempts.get(row.id) ?? { fails: 0, lockedUntil: 0 };
  if (a.lockedUntil > Date.now()) throw new HttpError(429, 'too_many', 'Too many wrong PINs. Try again in a minute.');
  if (typeof pin !== 'string' || !pinMatches(pin, row.pin_hash)) {
    a.fails++;
    if (a.fails >= 5) {
      a.fails = 0;
      a.lockedUntil = Date.now() + 60_000;
    }
    attempts.set(row.id, a);
    throw new HttpError(401, 'wrong_pin', 'That PIN is not right');
  }
  attempts.delete(row.id);
}

export function createSession(db: Db, kind: 'member' | 'hub', memberId: number | null): string {
  const token = randomBytes(24).toString('base64url');
  run(db, 'INSERT INTO sessions (token, kind, member_id, created_at) VALUES (?, ?, ?, ?)', token, kind, memberId, new Date().toISOString());
  return token;
}

export function loadAuth(db: Db, token: string): Auth | null {
  const s = get<{ kind: 'member' | 'hub'; member_id: number | null; elevated_until: number | null; elevated_by: number | null }>(
    db, 'SELECT kind, member_id, elevated_until, elevated_by FROM sessions WHERE token = ?', token,
  );
  if (!s) return null;
  const row = s.member_id ? get<MemberRow>(db, 'SELECT * FROM members WHERE id = ?', s.member_id) : undefined;
  if (s.kind === 'member' && !row) return null;
  return { token, kind: s.kind, member: row ? toMember(row) : null, elevatedUntil: s.elevated_until, elevatedBy: s.elevated_by };
}

export function canEdit(a: Auth | null): boolean {
  if (!a) return false;
  if (a.kind === 'member' && a.member?.role === 'adult') return true;
  return (a.elevatedUntil ?? 0) > Date.now();
}

export function sessionInfo(a: Auth): SessionInfo {
  const elevated = (a.elevatedUntil ?? 0) > Date.now();
  return { kind: a.kind, memberId: a.member?.id ?? null, canEdit: canEdit(a), elevatedUntil: elevated ? a.elevatedUntil : null };
}

export function requireAuth(req: FastifyRequest): Auth {
  if (!req.auth) throw new HttpError(401, 'signed_out', 'Sign in first');
  return req.auth;
}

/** Changing the schedule needs an adult (or the hub/kid device unlocked with a parent's PIN). */
export function requireEditor(req: FastifyRequest): Auth {
  const a = requireAuth(req);
  if (!canEdit(a)) throw new HttpError(403, 'locked', 'A parent needs to unlock this with their PIN');
  return a;
}

/**
 * Anyone can tick off jobs on the hub; on their own device a kid can only tick off their own
 * (for something several people share, like packing for an event, any of them can).
 */
export function requireCanComplete(req: FastifyRequest, assignee: number | null | number[]) {
  const a = requireAuth(req);
  const mine = Array.isArray(assignee) ? assignee.includes(a.member?.id ?? 0) : a.member?.id === assignee;
  if (a.kind === 'member' && a.member?.role === 'kid' && !mine && !canEdit(a)) {
    throw new HttpError(403, 'not_yours', 'That job belongs to someone else');
  }
}
