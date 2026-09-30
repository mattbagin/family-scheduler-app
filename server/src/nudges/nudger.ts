import {
  addDays, datePart, DEFAULT_NOTIFY, inQuietHours, minutesOf, parseLocal, toLocalDateTime,
  type LiveTopic, type NotifyPrefs, type Nudge, type NudgeKind, type NudgeSettings,
} from '../../../shared/src/index.ts';
import { all, get, getSetting, run, setSetting, type Db } from '../db.ts';
import { listBills, listMembers, listTodos, occurrencesBetween, prepBetween } from '../repo.ts';
import { PREF_OF, planNudges, type NudgePlan } from './plan.ts';
import { generateVapidKeys, loadVapid, sendPush, type PushTarget, type Vapid } from './webpush.ts';

export interface NudgeRow {
  id: number;
  key: string;
  kind: NudgeKind;
  title: string;
  body: string;
  url: string;
  audience: string;
  created_at: string;
  expires_at: string;
  acked_at: string | null;
  acked_by: number | null;
  escalation: number;
  last_sent_at: string | null;
}

export const toNudge = (r: NudgeRow): Nudge => ({
  id: r.id, kind: r.kind, title: r.title, body: r.body, url: r.url, audience: r.audience ? r.audience.split(',').map(Number) : [],
  createdAt: r.created_at, expiresAt: r.expires_at, ackedAt: r.acked_at, ackedBy: r.acked_by,
});

/* ---------- settings ---------- */

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isHhmm = (s: unknown): s is string => typeof s === 'string' && HHMM.test(s);

export function memberPrefs(db: Db, memberId: number): NotifyPrefs {
  const raw = get<{ notify: string | null }>(db, 'SELECT notify FROM members WHERE id = ?', memberId)?.notify;
  return { ...DEFAULT_NOTIFY, ...(raw ? (JSON.parse(raw) as Partial<NotifyPrefs>) : {}) };
}

export function nudgeSettings(db: Db): NudgeSettings {
  const adults = all<{ id: number }>(db, "SELECT id FROM members WHERE role = 'adult' ORDER BY sort, id");
  return {
    morningAt: getSetting(db, 'nudgeMorningAt', '07:00'),
    eveningAt: getSetting(db, 'nudgeEveningAt', '19:30'),
    escalateMin: Number(getSetting(db, 'nudgeEscalateMin', '10')),
    members: Object.fromEntries(adults.map((a) => [a.id, memberPrefs(db, a.id)])),
  };
}

/** VAPID keys are made once, on first use, and kept in settings. */
export function vapidFor(db: Db): Vapid {
  let pub = getSetting(db, 'vapidPublicKey');
  let priv = getSetting(db, 'vapidPrivateJwk');
  if (!pub || !priv) {
    const keys = generateVapidKeys();
    [pub, priv] = [keys.publicKey, keys.privateJwk];
    setSetting(db, 'vapidPublicKey', pub);
    setSetting(db, 'vapidPrivateJwk', priv);
  }
  return loadVapid(pub, priv, process.env.HOMEBASE_VAPID_SUBJECT ?? 'mailto:homebase@example.com');
}

/* ---------- delivery ---------- */

export interface Announcer {
  changed: (...topics: LiveTopic[]) => void;
  /** Tell open screens a nudge just fired (the hub chimes and shows a banner). */
  announce: (nudges: Nudge[]) => void;
}

interface SubRow extends PushTarget {
  id: number;
  member_id: number;
}

/** Pushes to every device a member has registered; forgets devices the push service says are gone. */
export async function pushToMember(db: Db, vapid: Vapid, memberId: number, payload: object, opts: { ttl: number; urgent: boolean; topic?: string }) {
  let delivered = 0;
  for (const s of all<SubRow>(db, 'SELECT * FROM push_subscriptions WHERE member_id = ?', memberId)) {
    const r = await sendPush(s, payload, vapid, { ttl: opts.ttl, urgency: opts.urgent ? 'high' : 'normal', topic: opts.topic });
    if (r.gone) run(db, 'DELETE FROM push_subscriptions WHERE id = ?', s.id);
    else if (r.ok) {
      delivered++;
      run(db, 'UPDATE push_subscriptions SET last_ok_at = ? WHERE id = ?', new Date().toISOString(), s.id);
    }
  }
  return delivered;
}

export interface Nudger {
  vapid: Vapid;
  /** Works out what's due at `now`, records new nudges, and delivers them. */
  tick: (now?: Date) => Promise<Nudge[]>;
}

export function createNudger(db: Db, live: Announcer): Nudger {
  const vapid = vapidFor(db);
  let running: Promise<Nudge[]> | null = null;

  const deliver = async (row: NudgeRow, memberIds: number[], now: Date, kind: NudgeKind, urgent: boolean) => {
    const nowMin = minutesOf(toLocalDateTime(now));
    const ttl = Math.max(60, Math.round((Date.parse(row.expires_at) - now.getTime()) / 1000));
    const payload = { id: row.id, title: row.title, body: row.body, url: row.url, tag: row.key, urgent };
    let sent = false;
    for (const m of memberIds) {
      const prefs = memberPrefs(db, m);
      // Held back (not dropped): if quiet hours end while it's still due, it goes out then.
      if (!prefs[PREF_OF[kind]] || inQuietHours(prefs, nowMin)) continue;
      await pushToMember(db, vapid, m, payload, { ttl, urgent, topic: `n${row.id}` });
      run(db, 'INSERT OR IGNORE INTO nudge_sends (nudge_id, member_id, sent_at) VALUES (?, ?, ?)', row.id, m, now.toISOString());
      sent = true;
    }
    if (sent) run(db, 'UPDATE nudges SET last_sent_at = ? WHERE id = ?', now.toISOString(), row.id);
  };

  const process = async (plan: NudgePlan, now: Date, escalateMin: number, adults: number[]): Promise<Nudge | null> => {
    let row = get<NudgeRow>(db, 'SELECT * FROM nudges WHERE key = ?', plan.key);
    let created: Nudge | null = null;
    if (!row) {
      const { id } = run(
        db,
        'INSERT INTO nudges (key, kind, title, body, url, audience, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        plan.key, plan.kind, plan.title, plan.body, plan.url, plan.audience.join(','), now.toISOString(), parseLocal(plan.until).toISOString(),
      );
      row = get<NudgeRow>(db, 'SELECT * FROM nudges WHERE id = ?', id)!;
      created = toNudge(row);
    }
    if (row.acked_at) return created;

    const sentTo = new Set(all<{ member_id: number }>(db, 'SELECT member_id FROM nudge_sends WHERE nudge_id = ?', row.id).map((r) => r.member_id));
    const pending = plan.audience.filter((m) => !sentTo.has(m));
    if (pending.length) await deliver(row, pending, now, plan.kind, plan.urgent);

    // Nobody answered an urgent one: say it again, then bring in the other parent.
    const last = row.last_sent_at ?? get<{ t: string | null }>(db, 'SELECT last_sent_at AS t FROM nudges WHERE id = ?', row.id)?.t;
    if (plan.urgent && escalateMin > 0 && last && row.escalation < 2 && now.getTime() - Date.parse(last) >= escalateMin * 60_000) {
      const level = row.escalation + 1;
      const to = level === 1 ? plan.audience : adults.filter((a) => !plan.audience.includes(a));
      run(db, 'UPDATE nudges SET escalation = ? WHERE id = ?', level, row.id);
      if (to.length) {
        const again = { ...row, title: level === 1 ? `Reminder: ${row.title}` : `${row.title} (no answer yet)` };
        await deliver(again, to, now, plan.kind, true);
      }
    }
    return created;
  };

  const tick = async (now = new Date()): Promise<Nudge[]> => {
    const local = toLocalDateTime(now);
    const today = datePart(local);
    const settings = nudgeSettings(db);
    const members = listMembers(db);
    const plans = planNudges({
      now: local, members,
      occurrences: occurrencesBetween(db, addDays(today, -1), addDays(today, 3)),
      prep: prepBetween(db, today, addDays(today, 2)),
      bills: listBills(db),
      todos: listTodos(db, now.toISOString()),
      morningAt: settings.morningAt,
      eveningAt: settings.eveningAt,
    });
    const adults = members.filter((m) => m.role === 'adult').map((m) => m.id);
    const created: Nudge[] = [];
    for (const p of plans) {
      const n = await process(p, now, settings.escalateMin, adults);
      if (n) created.push(n);
    }
    // Keep a month of history.
    run(db, 'DELETE FROM nudges WHERE created_at < ?', new Date(now.getTime() - 30 * 86_400_000).toISOString());
    if (created.length) {
      live.changed('nudges');
      live.announce(created);
    }
    return created;
  };

  return {
    vapid,
    // Ticks never overlap: a slow push service can't cause a nudge to be sent twice.
    tick: (now) => {
      running ??= tick(now).finally(() => { running = null; });
      return running;
    },
  };
}

/** Records who dismissed a nudge, which also stops it repeating. */
export function ackNudge(db: Db, id: number, memberId: number | null) {
  run(db, 'UPDATE nudges SET acked_at = coalesce(acked_at, ?), acked_by = coalesce(acked_by, ?) WHERE id = ?', new Date().toISOString(), memberId, id);
}
