import { createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encryptPayload, generateVapidKeys, loadVapid, vapidAuthorization } from '../src/nudges/webpush.ts';

const b = (s: string) => Buffer.from(s.replace(/\s+/g, ''), 'base64url');

describe('Web Push encryption (RFC 8291)', () => {
  it('reproduces the worked example in RFC 8291, Appendix A', () => {
    const out = encryptPayload(
      b('V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24'),
      b('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV- JvLexhqUzORcx aOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'),
      b('BTBZMqHH6r4Tts7J_aSIgg'),
      { salt: b('DGv6ra1nlYgDCS1FRnbzlw'), asPrivate: b('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw') },
    );
    const header = b(`DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z 9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
      mlMoZIIgDll6e3vCYLocInmYWAmS6Tlz AC8wEqKK6PBru3jl7A8`);
    const ciphertext = b('8pfeW0KbunFT06SuDKoJH9Ql87S1QUrd irN6GcG7sFz1y1sqLgVi1VhjVkHsUoEs bI_0LpXMuGvnzQ');
    expect(header.length).toBe(86);
    expect(out.toString('base64url')).toBe(Buffer.concat([header, ciphertext]).toString('base64url'));
  });
});

describe('VAPID (RFC 8292)', () => {
  it('signs a token for the push service that its public key verifies', () => {
    const keys = generateVapidKeys();
    const vapid = loadVapid(keys.publicKey, keys.privateJwk, 'mailto:parents@example.com');
    const now = Date.UTC(2026, 9, 1);
    const auth = vapidAuthorization('https://push.example.net/send/abc123', vapid, now);
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(auth)!;
    expect(m).toBeTruthy();
    expect(m[4]).toBe(keys.publicKey);
    expect(JSON.parse(Buffer.from(m[2], 'base64url').toString())).toEqual({
      aud: 'https://push.example.net', exp: now / 1000 + 12 * 3600, sub: 'mailto:parents@example.com',
    });

    const raw = b(keys.publicKey);
    expect(raw.length).toBe(65);
    const pub = createPublicKey({
      key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') },
      format: 'jwk',
    });
    const ok = verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key: pub, dsaEncoding: 'ieee-p1363' }, b(m[3]));
    expect(ok).toBe(true);
  });
});
