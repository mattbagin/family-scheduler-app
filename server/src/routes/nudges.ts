import type { FastifyInstance } from 'fastify';
import type { Nudge } from '../../../shared/src/index.ts';
import { requireAuth, requireEditor } from '../auth.ts';
import type { Ctx } from '../context.ts';
import { all, get, run, setSetting, tx } from '../db.ts';
import { badRequest, HttpError, idParam, parseBody, v } from '../http.ts';
import { ackNudge, isHhmm, memberPrefs, nudgeSettings, pushToMember, toNudge, type Nudger, type NudgeRow } from '../nudges/nudger.ts';

const b64 = (bytes: number) => (x: unknown, f: string): string => {
  if (typeof x !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(x) || Buffer.from(x, 'base64url').length !== bytes) {
    throw badRequest(`${f}: not a valid browser push key`);
  }
  return x;
};
const hhmm = (x: unknown, f: string) => {
  if (!isHhmm(x)) throw badRequest(`${f}: must be a time like 07:00`);
  return x;
};

export function nudgeRoutes(app: FastifyInstance, { db, changed }: Ctx, nudger: Nudger) {
  /* ---------- this device's notifications ---------- */

  app.get('/api/push/key', async (req) => {
    requireAuth(req);
    return { publicKey: nudger.vapid.publicKey };
  });

  // A signed-in person's browser agreed to show notifications.
  app.post('/api/push/subscribe', async (req, reply) => {
    const a = requireAuth(req);
    if (a.kind !== 'member' || !a.member) throw new HttpError(400, 'hub', 'Notifications go to people’s own phones; the hub shows banners instead');
    const b = (req.body ?? {}) as { endpoint?: unknown; keys?: Record<string, unknown>; label?: unknown };
    // Push services are always https; plain http is allowed only for one on this machine (tests).
    const endpoint = typeof b.endpoint === 'string' && b.endpoint.length < 2000
      && /^(https:\/\/\S+|http:\/\/(127\.0\.0\.1|localhost)[:/]\S*)$/.test(b.endpoint) ? b.endpoint : null;
    if (!endpoint) throw badRequest('endpoint: must be the https address the browser gave');
    const keys = parseBody({ p256dh: b64(65), auth: b64(16) }, b.keys ?? {});
    const label = v.optText(80)(b.label, 'label');
    run(
      db,
      `INSERT INTO push_subscriptions (member_id, endpoint, p256dh, auth, label, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET member_id = excluded.member_id, p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label`,
      a.member.id, endpoint, keys.p256dh, keys.auth, label, new Date().toISOString(),
    );
    changed('nudges');
    return reply.status(201).send({ ok: true });
  });

  app.post('/api/push/unsubscribe', async (req) => {
    requireAuth(req);
    const endpoint = (req.body as { endpoint?: unknown } | null)?.endpoint;
    if (typeof endpoint !== 'string') throw badRequest('endpoint: missing');
    run(db, 'DELETE FROM push_subscriptions WHERE endpoint = ?', endpoint);
    changed('nudges');
    return { ok: true };
  });

  app.post('/api/push/test', async (req) => {
    const a = requireAuth(req);
    if (!a.member) throw badRequest('Sign in as yourself to test notifications');
    const devices = get<{ n: number }>(db, 'SELECT count(*) AS n FROM push_subscriptions WHERE member_id = ?', a.member.id)!.n;
    const delivered = await pushToMember(db, nudger.vapid, a.member.id, {
      title: '👋 Notifications are on', body: `Homebase will nudge ${a.member.name} here: time to leave, packing, bills.`, url: '/settings', tag: 'test',
    }, { ttl: 300, urgent: false });
    return { devices, delivered };
  });

  /* ---------- nudges ---------- */

  // Unanswered nudges that are still current: the banners on the hub and parents' screens.
  app.get('/api/nudges/active', async (req): Promise<Nudge[]> => {
    requireAuth(req);
    const now = new Date().toISOString();
    return all<NudgeRow>(db, 'SELECT * FROM nudges WHERE acked_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 5', now).map(toNudge);
  });

  // The last week, for each parent's "recent nudges" list.
  app.get('/api/nudges', async (req): Promise<Nudge[]> => {
    requireAuth(req);
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    return all<NudgeRow>(db, 'SELECT * FROM nudges WHERE created_at >= ? ORDER BY created_at DESC LIMIT 50', since).map(toNudge);
  });

  // Answering a time-to-leave nudge stops it repeating and going to the other parent, so on the
  // shared hub that one takes a parent's PIN: a kid tapping the big button mustn't switch it off.
  // Briefings, packing, reminders and bills don't escalate, so anyone at the hub can clear them.
  app.post('/api/nudges/:id/ack', async (req) => {
    const id = idParam(req.params);
    const row = get<{ kind: string }>(db, 'SELECT kind FROM nudges WHERE id = ?', id);
    if (!row) throw new HttpError(404, 'not_found', 'Nudge not found');
    const a = row.kind === 'leave_by' ? requireEditor(req) : requireAuth(req);
    ackNudge(db, id, a.member?.id ?? a.elevatedBy);
    changed('nudges');
    return toNudge(get<NudgeRow>(db, 'SELECT * FROM nudges WHERE id = ?', id)!);
  });

  /* ---------- settings ---------- */

  app.get('/api/nudge-settings', async (req) => {
    requireAuth(req);
    const devices = Object.fromEntries(
      all<{ member_id: number; n: number }>(db, 'SELECT member_id, count(*) AS n FROM push_subscriptions GROUP BY member_id').map((r) => [r.member_id, r.n]),
    );
    return { ...nudgeSettings(db), devices };
  });

  app.patch('/api/nudge-settings', async (req) => {
    requireEditor(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    for (const k of Object.keys(b)) if (!['morningAt', 'eveningAt', 'escalateMin', 'members'].includes(k)) throw badRequest(`${k}: unknown field`);
    const morningAt = b.morningAt === undefined ? undefined : hhmm(b.morningAt, 'morningAt');
    const eveningAt = b.eveningAt === undefined ? undefined : hhmm(b.eveningAt, 'eveningAt');
    const escalateMin = b.escalateMin === undefined ? undefined : v.int(0, 120)(b.escalateMin, 'escalateMin');
    const members = (b.members ?? {}) as Record<string, Record<string, unknown>>;
    if (typeof members !== 'object' || Array.isArray(members)) throw badRequest('members: must map member ids to settings');
    const updates = Object.entries(members).map(([id, p]) => {
      const row = get<{ role: string }>(db, 'SELECT role FROM members WHERE id = ?', Number(id));
      if (row?.role !== 'adult') throw badRequest(`members: ${id} is not a parent`);
      const next = { ...memberPrefs(db, Number(id)) };
      for (const [k, val] of Object.entries(p ?? {})) {
        if (k === 'quietStart' || k === 'quietEnd') next[k] = hhmm(val, `members.${id}.${k}`);
        else if (k in next) (next as unknown as Record<string, boolean>)[k] = v.bool(val, `members.${id}.${k}`);
        else throw badRequest(`members.${id}.${k}: unknown setting`);
      }
      return [Number(id), next] as const;
    });
    tx(db, () => {
      if (morningAt) setSetting(db, 'nudgeMorningAt', morningAt);
      if (eveningAt) setSetting(db, 'nudgeEveningAt', eveningAt);
      if (escalateMin !== undefined) setSetting(db, 'nudgeEscalateMin', String(escalateMin));
      for (const [id, prefs] of updates) run(db, 'UPDATE members SET notify = ? WHERE id = ?', JSON.stringify(prefs), id);
    });
    changed('nudges');
    return nudgeSettings(db);
  });
}
