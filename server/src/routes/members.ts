import type { FastifyInstance, FastifyReply } from 'fastify';
import { ymd, type Bootstrap } from '../../../shared/src/index.ts';
import {
  createSession, hashPin, loadAuth, requireAuth, requireEditor, SESSION_COOKIE, sessionInfo, UNLOCK_MS, verifyPin,
} from '../auth.ts';
import type { Ctx } from '../context.ts';
import { get, getSetting, run, setSetting, tx } from '../db.ts';
import { badRequest, HttpError, idParam, parseBody, parsePatch, v } from '../http.ts';
import { getMemberRow, listMembers, toMember } from '../repo.ts';
import { seedSample } from '../seed.ts';

export const memberSchema = {
  name: v.text(40),
  role: v.oneOf('adult', 'kid'),
  color: v.color,
  avatar: v.text(16),
  pin: v.pin,
};

const setCookie = (reply: FastifyReply, token: string) =>
  reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 400 });

export function memberRoutes(app: FastifyInstance, { db, changed }: Ctx) {
  const memberCount = () => get<{ n: number }>(db, 'SELECT count(*) AS n FROM members')!.n;
  const adultsWithPin = (exceptId = 0) =>
    get<{ n: number }>(db, "SELECT count(*) AS n FROM members WHERE role = 'adult' AND pin_hash IS NOT NULL AND id != ?", exceptId)!.n;

  app.get('/api/bootstrap', async (req): Promise<Bootstrap> => ({
    needsSetup: memberCount() === 0,
    familyName: getSetting(db, 'familyName', 'Our family'),
    session: req.auth ? sessionInfo(req.auth) : null,
    members: req.auth || memberCount() ? listMembers(db) : [],
  }));

  // First run: create the family (or load the sample family) and sign in as the first parent.
  app.post('/api/setup', async (req, reply) => {
    if (memberCount() > 0) throw new HttpError(409, 'already_set_up', 'This home is already set up');
    const b = (req.body ?? {}) as { familyName?: unknown; members?: unknown; sample?: unknown };
    let firstAdult = 0;
    if (b.sample === true) {
      firstAdult = seedSample(db, ymd(new Date())).adultIds[0];
    } else {
      const familyName = v.text(60)(b.familyName, 'familyName');
      if (!Array.isArray(b.members) || !b.members.length) throw badRequest('members: add at least one family member');
      const members = b.members.map((m) => parseBody(memberSchema, m, ['pin']));
      if (!members.some((m) => m.role === 'adult' && m.pin)) throw badRequest('members: at least one parent needs a PIN');
      tx(db, () => {
        setSetting(db, 'familyName', familyName);
        members.forEach((m, i) => {
          const { id } = run(
            db, 'INSERT INTO members (name, role, color, avatar, pin_hash, sort) VALUES (?, ?, ?, ?, ?, ?)',
            m.name, m.role, m.color, m.avatar, m.pin ? hashPin(m.pin) : null, i,
          );
          if (!firstAdult && m.role === 'adult' && m.pin) firstAdult = id;
        });
      });
    }
    setCookie(reply, createSession(db, 'member', firstAdult));
    changed('members', 'settings');
    return { ok: true };
  });

  app.post('/api/login', async (req, reply) => {
    const b = (req.body ?? {}) as { memberId?: unknown; pin?: unknown; asHub?: unknown };
    const row = getMemberRow(db, v.int(1)(b.memberId, 'memberId'));
    const asHub = b.asHub === true;
    if (asHub && row.role !== 'adult') throw badRequest('Only a parent can set up the family hub');
    if (row.role === 'adult' || row.pin_hash) verifyPin(db, row, b.pin);
    const token = createSession(db, asHub ? 'hub' : 'member', asHub ? null : row.id);
    setCookie(reply, token);
    return sessionInfo(loadAuth(db, token)!);
  });

  app.post('/api/logout', async (req, reply) => {
    if (req.auth) run(db, 'DELETE FROM sessions WHERE token = ?', req.auth.token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.status(204).send();
  });

  // A parent's PIN unlocks editing on the hub (or a kid's device) for a few minutes.
  app.post('/api/unlock', async (req) => {
    const a = requireAuth(req);
    const b = (req.body ?? {}) as { memberId?: unknown; pin?: unknown };
    const row = getMemberRow(db, v.int(1)(b.memberId, 'memberId'));
    if (row.role !== 'adult') throw badRequest('Only a parent can unlock editing');
    verifyPin(db, row, b.pin);
    run(db, 'UPDATE sessions SET elevated_until = ? WHERE token = ?', Date.now() + UNLOCK_MS, a.token);
    return sessionInfo(loadAuth(db, a.token)!);
  });

  app.post('/api/lock', async (req) => {
    const a = requireAuth(req);
    run(db, 'UPDATE sessions SET elevated_until = NULL WHERE token = ?', a.token);
    return sessionInfo(loadAuth(db, a.token)!);
  });

  app.get('/api/members', async (req) => {
    requireAuth(req);
    return listMembers(db);
  });

  app.post('/api/members', async (req, reply) => {
    requireEditor(req);
    const m = parseBody(memberSchema, req.body, ['pin']);
    if (m.role === 'adult' && !m.pin) throw badRequest('pin: parents need a PIN');
    const sort = get<{ n: number }>(db, 'SELECT coalesce(max(sort), -1) + 1 AS n FROM members')!.n;
    const { id } = run(
      db, 'INSERT INTO members (name, role, color, avatar, pin_hash, sort) VALUES (?, ?, ?, ?, ?, ?)',
      m.name, m.role, m.color, m.avatar, m.pin ? hashPin(m.pin) : null, sort,
    );
    changed('members');
    return reply.status(201).send(toMember(getMemberRow(db, id)));
  });

  app.patch('/api/members/:id', async (req) => {
    requireEditor(req);
    const row = getMemberRow(db, idParam(req.params));
    const p = parsePatch({ ...memberSchema, pin: (x: unknown, f: string) => (x === null ? null : v.pin(x, f)), sort: v.int(0, 1000) }, req.body);
    const role = p.role ?? row.role;
    const pinHash = p.pin === undefined ? row.pin_hash : p.pin === null ? null : hashPin(p.pin);
    if (role === 'adult' && !pinHash) throw badRequest('pin: parents need a PIN');
    if (row.role === 'adult' && (role !== 'adult' || !pinHash) && adultsWithPin(row.id) === 0) {
      throw badRequest('At least one parent with a PIN is needed');
    }
    run(
      db, 'UPDATE members SET name = ?, role = ?, color = ?, avatar = ?, pin_hash = ?, sort = ? WHERE id = ?',
      p.name ?? row.name, role, p.color ?? row.color, p.avatar ?? row.avatar, pinHash, p.sort ?? row.sort, row.id,
    );
    changed('members');
    return toMember(getMemberRow(db, row.id));
  });

  app.delete('/api/members/:id', async (req, reply) => {
    requireEditor(req);
    const row = getMemberRow(db, idParam(req.params));
    if (row.role === 'adult' && adultsWithPin(row.id) === 0) throw badRequest('At least one parent with a PIN is needed');
    run(db, 'DELETE FROM members WHERE id = ?', row.id);
    changed('members', 'events', 'plans', 'chores', 'todos');
    return reply.status(204).send();
  });

  app.get('/api/settings', async (req) => {
    requireAuth(req);
    return { familyName: getSetting(db, 'familyName', 'Our family') };
  });

  app.patch('/api/settings', async (req) => {
    requireEditor(req);
    const p = parsePatch({ familyName: v.text(60) }, req.body);
    if (p.familyName) setSetting(db, 'familyName', p.familyName);
    changed('settings');
    return { familyName: getSetting(db, 'familyName', 'Our family') };
  });
}
