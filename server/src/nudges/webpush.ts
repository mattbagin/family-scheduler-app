import { createCipheriv, createECDH, createHmac, createPrivateKey, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

/*
 * Web Push without a library: payload encryption (RFC 8291, aes128gcm) and VAPID sign-in
 * (RFC 8292). The encryption is checked against the RFC's worked example in the tests.
 */

const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const unb64u = (s: string) => Buffer.from(s, 'base64url');
const hmac = (key: Uint8Array, data: Uint8Array) => createHmac('sha256', key).update(data).digest();

/** What a browser hands over when it subscribes (PushSubscription.toJSON()). */
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface Vapid {
  /** Uncompressed P-256 public key, base64url: the browser's applicationServerKey. */
  publicKey: string;
  privateKey: KeyObject;
  /** Contact for the push service, a mailto: or https: URL. */
  subject: string;
}

const RECORD_SIZE = 4096;
/** Room left in one record after the 16-byte tag and the padding delimiter. */
export const MAX_PAYLOAD = RECORD_SIZE - 17;

/**
 * Encrypts one push message for a subscription. `salt` and `asPrivate` exist only so the tests
 * can reproduce the RFC example; normally both are fresh and random.
 */
export function encryptPayload(
  plaintext: Uint8Array,
  uaPublic: Uint8Array,
  authSecret: Uint8Array,
  opts: { salt?: Uint8Array; asPrivate?: Uint8Array } = {},
): Buffer {
  if (plaintext.length > MAX_PAYLOAD) throw new Error('Push message is too long');
  const ecdh = createECDH('prime256v1');
  if (opts.asPrivate) ecdh.setPrivateKey(opts.asPrivate);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const ecdhSecret = ecdh.computeSecret(uaPublic);

  const prkKey = hmac(authSecret, ecdhSecret);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = hmac(prkKey, Buffer.concat([keyInfo, Buffer.from([1])]));
  const salt = opts.salt ?? randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);

  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  Buffer.from(salt).copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, body]);
}

export function generateVapidKeys(): { publicKey: string; privateJwk: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), unb64u(jwk.x!), unb64u(jwk.y!)]);
  return { publicKey: b64u(raw), privateJwk: JSON.stringify(privateKey.export({ format: 'jwk' })) };
}

export function loadVapid(publicKey: string, privateJwk: string, subject: string): Vapid {
  return { publicKey, privateKey: createPrivateKey({ key: JSON.parse(privateJwk), format: 'jwk' }), subject };
}

/** The Authorization header that proves to the push service that this server sent the message. */
export function vapidAuthorization(endpoint: string, vapid: Vapid, now = Date.now()): string {
  const enc = (o: object) => b64u(Buffer.from(JSON.stringify(o)));
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({
    aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: vapid.subject,
  })}`;
  const sig = sign('sha256', Buffer.from(unsigned), { key: vapid.privateKey, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${b64u(sig)}, k=${vapid.publicKey}`;
}

export interface PushOptions {
  /** Seconds the push service may hold the message for an offline device. */
  ttl: number;
  urgency: 'very-low' | 'low' | 'normal' | 'high';
  /** Replaces an earlier undelivered message with the same topic. */
  topic?: string;
}

/** Sends one message. `gone` means the subscription no longer exists and should be forgotten. */
export async function sendPush(target: PushTarget, payload: object, vapid: Vapid, opts: PushOptions): Promise<{ ok: boolean; gone: boolean; status: number }> {
  const body = encryptPayload(Buffer.from(JSON.stringify(payload)), unb64u(target.p256dh), unb64u(target.auth));
  const headers: Record<string, string> = {
    TTL: String(opts.ttl),
    Urgency: opts.urgency,
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    Authorization: vapidAuthorization(target.endpoint, vapid),
  };
  // Topics are limited to 32 URL-safe characters.
  if (opts.topic) headers.Topic = opts.topic.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  try {
    const res = await fetch(target.endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(15_000) });
    await res.body?.cancel();
    return { ok: res.ok, gone: res.status === 404 || res.status === 410, status: res.status };
  } catch {
    return { ok: false, gone: false, status: 0 };
  }
}
