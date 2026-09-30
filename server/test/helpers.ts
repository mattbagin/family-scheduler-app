import { expect } from 'vitest';
import type { Member } from '../../shared/src/index.ts';
import type { buildApp } from '../src/app.ts';

export type App = Awaited<ReturnType<typeof buildApp>>;

export function sessionFrom(res: { cookies: { name: string; value: string }[] }) {
  const c = res.cookies.find((x) => x.name === 'hb_session');
  if (!c) throw new Error('no session cookie');
  return { hb_session: c.value };
}

/** Two parents (Alex 2468, Robin 1357) and a kid (Kit); returns a parent's session. */
export async function setupFamily(app: App) {
  const res = await app.inject({
    method: 'POST', url: '/api/setup',
    payload: {
      familyName: 'The Testers',
      members: [
        { name: 'Alex', role: 'adult', color: '#2F7DE1', avatar: '👨', pin: '2468' },
        { name: 'Robin', role: 'adult', color: '#D9487A', avatar: '👩', pin: '1357' },
        { name: 'Kit', role: 'kid', color: '#1F9C62', avatar: '👦' },
      ],
    },
  });
  expect(res.statusCode).toBe(200);
  const adult = sessionFrom(res);
  const members = (await app.inject({ url: '/api/members', cookies: adult })).json<Member[]>();
  return { adult, members };
}
