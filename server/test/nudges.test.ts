import { createDecipheriv, createECDH, createHmac, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDays, parseLocal, ymd, type Nudge } from '../../shared/src/index.ts';
import { buildApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';
import { sessionFrom, setupFamily, type App } from './helpers.ts';

/*
 * A stand-in push service. Each "phone" has its own key pair; the service decrypts what the
 * server sends exactly as the phone would, so these tests check real Web Push messages.
 */
interface Phone { path: string; ecdh: ReturnType<typeof createECDH>; auth: Buffer; inbox: { title: string; body: string; id?: number }[] }
let server: Server;
let base: string;
const phones = new Map<string, Phone>();
const gonePaths = new Set<string>();

const hmac = (k: Buffer, d: Buffer) => createHmac('sha256', k).update(d).digest();
function decrypt(phone: Phone, msg: Buffer) {
  const salt = msg.subarray(0, 16);
  const idlen = msg[20];
  const asPublic = msg.subarray(21, 21 + idlen);
  const uaPublic = phone.ecdh.getPublicKey();
  const ikm = hmac(hmac(phone.auth, phone.ecdh.computeSecret(asPublic)), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const body = msg.subarray(21 + idlen);
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(body.subarray(body.length - 16));
  const plain = Buffer.concat([d.update(body.subarray(0, body.length - 16)), d.final()]);
  expect(plain.at(-1)).toBe(2);
  return JSON.parse(plain.subarray(0, -1).toString());
}

function newPhone(name: string): Phone {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const phone = { path: `/push/${name}`, ecdh, auth: randomBytes(16), inbox: [] };
  phones.set(phone.path, phone);
  return phone;
}

let app: App;
// A week ahead: /api/nudges/active compares expiry with the real clock, so a fixed date goes stale.
const DAY = addDays(ymd(new Date()), 7);
const at = (hhmm: string, day = DAY) => parseLocal(`${day}T${hhmm}`);

beforeEach(async () => {
  phones.clear();
  gonePaths.clear();
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const phone = phones.get(req.url ?? '');
      if (!phone || gonePaths.has(phone.path)) return res.writeHead(410).end();
      expect(req.headers['content-encoding']).toBe('aes128gcm');
      expect(req.headers.authorization).toMatch(/^vapid t=.+, k=.+$/);
      phone.inbox.push(decrypt(phone, Buffer.concat(chunks)));
      res.writeHead(201).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  app = await buildApp({ db: openDb(':memory:') });
});

afterEach(async () => {
  await app.close();
  await new Promise((r) => server.close(r));
});

async function family() {
  const { adult, members } = await setupFamily(app);
  const [alex, robin, kit] = members;
  const robinSession = { hb_session: (await app.inject({ method: 'POST', url: '/api/login', payload: { memberId: robin.id, pin: '1357' } })).cookies[0].value };
  const subscribe = async (cookies: Record<string, string>, phone: Phone) => {
    const res = await app.inject({
      method: 'POST', url: '/api/push/subscribe', cookies,
      payload: { endpoint: base + phone.path, keys: { p256dh: phone.ecdh.getPublicKey().toString('base64url'), auth: phone.auth.toString('base64url') }, label: 'Phone' },
    });
    expect(res.statusCode).toBe(201);
  };
  const alexPhone = newPhone('alex');
  const robinPhone = newPhone('robin');
  await subscribe(adult, alexPhone);
  await subscribe(robinSession, robinPhone);
  return { adult, alex, robin, kit, alexPhone, robinPhone };
}

describe('nudges', () => {
  it('pushes a leave-by nudge to the driver, repeats it, then tells the other parent', async () => {
    const { adult, alex, kit, alexPhone, robinPhone } = await family();
    await app.inject({
      method: 'POST', url: '/api/events', cookies: adult,
      payload: { title: 'Soccer practice', start: `${DAY}T16:30`, end: `${DAY}T17:30`, memberIds: [kit.id], driverId: alex.id, travelMin: 15 },
    });

    expect(await app.nudger.tick(at('16:04'))).toEqual([]);
    const [n] = await app.nudger.tick(at('16:05'));
    expect(n).toMatchObject({ kind: 'leave_by', title: '🚗 Time to leave for Soccer practice', audience: [alex.id] });
    expect(alexPhone.inbox).toEqual([expect.objectContaining({ id: n.id, title: n.title, body: 'Alex is driving Kit · starts 4:30 PM' })]);
    expect(robinPhone.inbox).toEqual([]);

    // Once only, however often it checks.
    await app.nudger.tick(at('16:06'));
    expect(alexPhone.inbox).toHaveLength(1);

    // No answer after 10 minutes: again to Alex; after 10 more, to Robin too.
    await app.nudger.tick(at('16:15'));
    expect(alexPhone.inbox.map((m) => m.title)).toEqual([n.title, `Reminder: ${n.title}`]);
    await app.nudger.tick(at('16:25'));
    expect(robinPhone.inbox.map((m) => m.title)).toEqual([`${n.title} (no answer yet)`]);

    const active = (await app.inject({ url: '/api/nudges/active', cookies: adult })).json<Nudge[]>();
    expect(active.map((x) => x.id)).toEqual([n.id]);
  });

  it('stops repeating once someone taps “Got it”', async () => {
    const { adult, alex, kit, alexPhone } = await family();
    await app.inject({
      method: 'POST', url: '/api/events', cookies: adult,
      payload: { title: 'Swim', start: `${DAY}T17:00`, end: `${DAY}T18:00`, memberIds: [kit.id], driverId: alex.id, travelMin: 20 },
    });
    const [n] = await app.nudger.tick(at('16:30'));
    const ack = await app.inject({ method: 'POST', url: `/api/nudges/${n.id}/ack`, cookies: adult });
    expect(ack.json<Nudge>()).toMatchObject({ ackedBy: alex.id });
    await app.nudger.tick(at('16:45'));
    expect(alexPhone.inbox).toHaveLength(1);
    expect((await app.inject({ url: '/api/nudges/active', cookies: adult })).json()).toEqual([]);
  });

  it('needs a parent’s PIN to answer a nudge on the hub, and remembers which parent', async () => {
    const { adult, alex, robin, kit } = await family();
    await app.inject({
      method: 'POST', url: '/api/events', cookies: adult,
      payload: { title: 'Swim', start: `${DAY}T17:00`, end: `${DAY}T18:00`, memberIds: [kit.id], driverId: alex.id, travelMin: 20 },
    });
    const [n] = await app.nudger.tick(at('16:30'));
    const hub = sessionFrom(await app.inject({ method: 'POST', url: '/api/login', payload: { memberId: alex.id, pin: '2468', asHub: true } }));

    const locked = await app.inject({ method: 'POST', url: `/api/nudges/${n.id}/ack`, cookies: hub });
    expect(locked.statusCode).toBe(403);
    expect(locked.json()).toMatchObject({ error: 'locked' });
    expect((await app.inject({ url: '/api/nudges/active', cookies: hub })).json()).toHaveLength(1);

    await app.inject({ method: 'POST', url: '/api/unlock', cookies: hub, payload: { memberId: robin.id, pin: '1357' } });
    const ack = await app.inject({ method: 'POST', url: `/api/nudges/${n.id}/ack`, cookies: hub });
    expect(ack.json<Nudge>()).toMatchObject({ ackedBy: robin.id });
  });

  it('holds nudges during quiet hours and sends them once quiet hours end', async () => {
    const { adult, alex, alexPhone, robinPhone, robin } = await family();
    // A reminder the day before, due at 6:00 AM: inside the default 9:30 PM – 6:30 AM quiet hours.
    await app.inject({
      method: 'POST', url: '/api/events', cookies: adult,
      payload: { title: 'Flu shots', start: `${addDays(DAY, 1)}T06:00`, end: `${addDays(DAY, 1)}T06:30`, memberIds: [alex.id], reminders: [1440] },
    });
    await app.inject({ method: 'PATCH', url: '/api/nudge-settings', cookies: adult, payload: { members: { [robin.id]: { reminders: false } } } });

    const created = await app.nudger.tick(at('06:00'));
    expect(created).toHaveLength(1);
    expect(alexPhone.inbox).toEqual([]);
    await app.nudger.tick(at('06:30'));
    expect(alexPhone.inbox.map((m) => m.title)).toEqual(['📅 Flu shots tomorrow at 6:00 AM']);
    expect(robinPhone.inbox).toEqual([]); // not in the audience, and turned reminders off anyway
  });

  it('forgets a phone the push service says is gone, and validates settings', async () => {
    const { adult, kit, alexPhone } = await family();
    gonePaths.add(alexPhone.path);
    await app.inject({
      method: 'POST', url: '/api/events', cookies: adult,
      payload: { title: 'Piano', start: `${DAY}T16:00`, end: `${DAY}T17:00`, memberIds: [kit.id], travelMin: 10 },
    });
    await app.nudger.tick(at('15:45'));
    const settings = (await app.inject({ url: '/api/nudge-settings', cookies: adult })).json<{ devices: Record<string, number> }>();
    expect(Object.values(settings.devices)).toEqual([1]); // only Robin's phone is left

    const bad = await app.inject({ method: 'PATCH', url: '/api/nudge-settings', cookies: adult, payload: { eveningAt: '7:30pm' } });
    expect(bad.statusCode).toBe(400);
    const kidPrefs = await app.inject({ method: 'PATCH', url: '/api/nudge-settings', cookies: adult, payload: { members: { [kit.id]: { bills: false } } } });
    expect(kidPrefs.statusCode).toBe(400);
    const ok = await app.inject({ method: 'PATCH', url: '/api/nudge-settings', cookies: adult, payload: { eveningAt: '20:00', escalateMin: 0 } });
    expect(ok.json()).toMatchObject({ eveningAt: '20:00', escalateMin: 0 });
  });

  it('sends a test notification to the signed-in parent’s phones', async () => {
    const { adult, alexPhone } = await family();
    const res = (await app.inject({ method: 'POST', url: '/api/push/test', cookies: adult })).json();
    expect(res).toEqual({ devices: 1, delivered: 1 });
    expect(alexPhone.inbox[0].title).toBe('👋 Notifications are on');
  });
});
