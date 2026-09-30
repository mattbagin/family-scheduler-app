import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDays, ymd, type PrepItem, type Todo } from '../../shared/src/index.ts';
import { buildApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';
import { sessionFrom, setupFamily, type App } from './helpers.ts';

let app: App;
const today = ymd(new Date());
const tomorrow = addDays(today, 1);

beforeEach(async () => {
  app = await buildApp({ db: openDb(':memory:') });
});
afterEach(async () => {
  await app.close();
});

describe('to-dos', () => {
  it('creates, ticks off, snoozes and removes to-dos', async () => {
    const { adult, members } = await setupFamily(app);
    const [alex] = members;
    const create = (payload: object) => app.inject({ method: 'POST', url: '/api/todos', cookies: adult, payload });

    const call = await create({ text: 'Call the plumber', assigneeId: alex.id, due: tomorrow });
    expect(call.statusCode).toBe(201);
    expect(call.json<Todo>()).toMatchObject({ kind: 'todo', icon: '📞', assigneeId: alex.id, due: tomorrow, doneAt: null });
    const someday = (await create({ text: 'Fix the fence' })).json<Todo>();
    expect(someday).toMatchObject({ due: null, assigneeId: null, icon: '✅' });

    const list = (await app.inject({ url: '/api/todos', cookies: adult })).json<Todo[]>();
    expect(list.map((t) => t.text)).toEqual(['Call the plumber', 'Fix the fence']);

    const id = call.json<Todo>().id;
    const patch = (payload: object) => app.inject({ method: 'PATCH', url: `/api/todos/${id}`, cookies: adult, payload });
    expect((await patch({ due: addDays(today, 2) })).json<Todo>().due).toBe(addDays(today, 2)); // snooze
    expect((await patch({ done: true })).json<Todo>().doneAt).toBeTruthy();
    // Just finished: still listed, so the tick shows.
    expect((await app.inject({ url: '/api/todos', cookies: adult })).json<Todo[]>().find((t) => t.id === id)?.doneAt).toBeTruthy();

    expect((await app.inject({ method: 'DELETE', url: `/api/todos/${id}`, cookies: adult })).statusCode).toBe(204);
    expect((await create({ text: '' })).statusCode).toBe(400);
  });

  it('lets a kid tick off only their own, and not change or add anything', async () => {
    const { adult, members } = await setupFamily(app);
    const [alex, , kit] = members;
    const mine = (await app.inject({ method: 'POST', url: '/api/todos', cookies: adult, payload: { text: 'Tidy room', assigneeId: kit.id, due: today } })).json<Todo>();
    const theirs = (await app.inject({ method: 'POST', url: '/api/todos', cookies: adult, payload: { text: 'Taxes', assigneeId: alex.id } })).json<Todo>();
    const kid = sessionFrom(await app.inject({ method: 'POST', url: '/api/login', payload: { memberId: kit.id } }));
    const patch = (t: Todo, payload: object) => app.inject({ method: 'PATCH', url: `/api/todos/${t.id}`, cookies: kid, payload });

    expect((await patch(mine, { done: true })).statusCode).toBe(200);
    expect((await patch(theirs, { done: true })).statusCode).toBe(403);
    expect((await patch(mine, { text: 'Skip it' })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/todos', cookies: kid, payload: { text: 'Candy' } })).statusCode).toBe(403);
  });
});

describe('prep', () => {
  it('lists bring notes and prep items for each day, and ticks them off', async () => {
    const { adult, members } = await setupFamily(app);
    const [, robin, kit] = members;
    const ev = (await app.inject({
      method: 'POST', url: '/api/events', cookies: adult,
      payload: { title: 'Swim lesson', start: `${today}T17:00`, end: `${today}T18:00`, rrule: 'FREQ=DAILY', memberIds: [kit.id], bring: 'Swimsuit and goggles' },
    })).json<{ id: number }>();
    const shoes = await app.inject({ method: 'POST', url: '/api/todos', cookies: adult, payload: { kind: 'prep', text: 'Gym shoes', assigneeId: kit.id, due: tomorrow } });
    expect(shoes.json<Todo>()).toMatchObject({ kind: 'prep', icon: '👟' });
    expect((await app.inject({ method: 'POST', url: '/api/todos', cookies: adult, payload: { kind: 'prep', text: 'Snack' } })).statusCode).toBe(400);

    const prep = async () => (await app.inject({ url: `/api/prep?from=${tomorrow}&to=${addDays(tomorrow, 1)}`, cookies: adult })).json<PrepItem[]>();
    expect((await prep()).map((p) => [p.key, p.text, p.memberIds, p.done])).toEqual([
      [`event:${ev.id}:${tomorrow}`, 'Swimsuit and goggles', [kit.id], false],
      [`todo:${shoes.json<Todo>().id}`, 'Gym shoes', [kit.id], false],
    ]);

    // The kid going can tick the bring note as packed, for that day only.
    const kid = sessionFrom(await app.inject({ method: 'POST', url: '/api/login', payload: { memberId: kit.id } }));
    const pack = (cookies: Record<string, string>, date: string) =>
      app.inject({ method: 'PUT', url: `/api/events/${ev.id}/packed/${date}`, cookies, payload: { packed: true } });
    expect((await pack(kid, tomorrow)).statusCode).toBe(200);
    expect((await prep())[0].done).toBe(true);
    const today1 = (await app.inject({ url: `/api/prep?from=${today}&to=${tomorrow}`, cookies: adult })).json<PrepItem[]>();
    expect(today1[0].done).toBe(false);

    // Someone not going can't, on their own device; and there's no swim lesson yesterday.
    await app.inject({ method: 'PATCH', url: `/api/members/${robin.id}`, cookies: adult, payload: { role: 'kid', pin: null } });
    const robinKid = sessionFrom(await app.inject({ method: 'POST', url: '/api/login', payload: { memberId: robin.id } }));
    expect((await pack(robinKid, tomorrow)).statusCode).toBe(403);
    expect((await pack(adult, addDays(today, -1))).statusCode).toBe(400);
  });
});
