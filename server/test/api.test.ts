import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDays, ymd, type ChoreForDay, type Occurrence, type Plan } from '../../shared/src/index.ts';
import { buildApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';
import { sessionFrom, setupFamily as setup, type App } from './helpers.ts';

let app: App;
const setupFamily = () => setup(app);
const today = ymd(new Date());

beforeEach(async () => {
  app = await buildApp({ db: openDb(':memory:') });
});
afterEach(async () => {
  await app.close();
});

describe('setup and sign-in', () => {
  it('needs setup once, then refuses a second setup', async () => {
    expect((await app.inject({ url: '/api/bootstrap' })).json()).toMatchObject({ needsSetup: true, session: null });
    const { adult } = await setupFamily();
    const boot = (await app.inject({ url: '/api/bootstrap', cookies: adult })).json();
    expect(boot).toMatchObject({ needsSetup: false, familyName: 'The Testers', session: { kind: 'member', canEdit: true } });
    expect((await app.inject({ method: 'POST', url: '/api/setup', payload: { sample: true } })).statusCode).toBe(409);
  });

  it('requires a parent PIN, but lets kids tap in', async () => {
    const { members } = await setupFamily();
    const [alex, , kit] = members;
    expect((await app.inject({ method: 'POST', url: '/api/login', payload: { memberId: alex.id, pin: '0000' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/login', payload: { memberId: alex.id, pin: '2468' } })).statusCode).toBe(200);
    const kid = await app.inject({ method: 'POST', url: '/api/login', payload: { memberId: kit.id } });
    expect(kid.json()).toMatchObject({ kind: 'member', memberId: kit.id, canEdit: false });
  });

  it('locks a member out after five wrong PINs', async () => {
    const { members } = await setupFamily();
    for (let i = 0; i < 5; i++) await app.inject({ method: 'POST', url: '/api/login', payload: { memberId: members[0].id, pin: '9999' } });
    const res = await app.inject({ method: 'POST', url: '/api/login', payload: { memberId: members[0].id, pin: '2468' } });
    expect(res.statusCode).toBe(429);
  });

  it('keeps the hub read-only until a parent unlocks it', async () => {
    const { members } = await setupFamily();
    const hub = sessionFrom(await app.inject({ method: 'POST', url: '/api/login', payload: { memberId: members[0].id, pin: '2468', asHub: true } }));
    const create = () => app.inject({
      method: 'POST', url: '/api/events', cookies: hub,
      payload: { title: 'Dentist', start: `${today}T10:00`, end: `${today}T11:00` },
    });
    const locked = await create();
    expect(locked.statusCode).toBe(403);
    expect(locked.json().error).toBe('locked');
    await app.inject({ method: 'POST', url: '/api/unlock', cookies: hub, payload: { memberId: members[1].id, pin: '1357' } });
    expect((await create()).statusCode).toBe(201);
  });
});

describe('events', () => {
  it('creates a repeating event, patches one occurrence, and validates input', async () => {
    const { adult, members } = await setupFamily();
    const kit = members[2];
    const created = await app.inject({
      method: 'POST', url: '/api/events', cookies: adult,
      payload: {
        title: 'Soccer practice', start: `${today}T16:30`, end: `${today}T17:30`, rrule: 'FREQ=DAILY',
        memberIds: [kit.id], needsDriver: true, travelMin: 15,
      },
    });
    expect(created.statusCode).toBe(201);
    const ev = created.json();
    expect(ev).toMatchObject({ icon: '⚽', category: 'sports', memberIds: [kit.id] });

    const tomorrow = addDays(today, 1);
    const put = await app.inject({
      method: 'PUT', url: `/api/events/${ev.id}/occurrences/${tomorrow}`, cookies: adult, payload: { driverId: members[0].id, start: `${tomorrow}T18:00` },
    });
    expect(put.statusCode).toBe(200);

    const occ = (await app.inject({ url: `/api/occurrences?from=${today}&to=${addDays(today, 3)}`, cookies: adult })).json<Occurrence[]>();
    expect(occ.map((o) => [o.start, o.driverId])).toEqual([
      [`${today}T16:30`, null],
      [`${tomorrow}T18:00`, members[0].id],
      [`${addDays(today, 2)}T16:30`, null],
    ]);
    expect(occ[1].end).toBe(`${tomorrow}T19:00`);

    const bad = await app.inject({ method: 'POST', url: '/api/events', cookies: adult, payload: { title: '', start: 'soon', end: `${today}T10:00` } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().message).toMatch(/^title:/);

    const kidDriver = await app.inject({ method: 'PATCH', url: `/api/events/${ev.id}`, cookies: adult, payload: { driverId: kit.id } });
    expect(kidDriver.statusCode).toBe(400);
  });
});

describe('plans and chores', () => {
  it('builds a plan with assigned tasks that a kid can tick off', async () => {
    const { adult, members } = await setupFamily();
    const [alex, robin, kit] = members;
    const plan = (await app.inject({
      method: 'POST', url: '/api/plans', cookies: adult, payload: { title: 'Hosting Thanksgiving', start: `${addDays(today, 10)}T17:00` },
    })).json<Plan>();
    expect(plan).toMatchObject({ icon: '🦃', tasks: [] });

    const add = (text: string, assigneeId: number) =>
      app.inject({ method: 'POST', url: `/api/plans/${plan.id}/tasks`, cookies: adult, payload: { text, assigneeId, due: addDays(today, 9) } });
    await add('Cook the turkey', alex.id);
    await add('Get drinks', robin.id);
    const vacuum = (await add('Vacuum floor', kit.id)).json();
    expect(vacuum.icon).toBe('🧹');

    const kid = sessionFrom(await app.inject({ method: 'POST', url: '/api/login', payload: { memberId: kit.id } }));
    const [plans] = [(await app.inject({ url: '/api/plans', cookies: kid })).json<Plan[]>()];
    const turkey = plans[0].tasks.find((t) => t.text === 'Cook the turkey')!;
    expect((await app.inject({ method: 'PATCH', url: `/api/tasks/${turkey.id}`, cookies: kid, payload: { done: true } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: `/api/tasks/${vacuum.id}`, cookies: kid, payload: { done: true } })).json().doneAt).toBeTruthy();
    expect((await app.inject({ method: 'PATCH', url: `/api/tasks/${vacuum.id}`, cookies: kid, payload: { assigneeId: alex.id } })).statusCode).toBe(403);

    // The plan's event shows up on the calendar with a link back to the plan.
    const occ = (await app.inject({ url: `/api/occurrences?from=${addDays(today, 10)}&to=${addDays(today, 11)}`, cookies: adult })).json<Occurrence[]>();
    expect(occ[0]).toMatchObject({ title: 'Hosting Thanksgiving', planId: plan.id, fun: true, memberIds: [alex.id, robin.id, kit.id] });
  });

  it('tracks chores per day', async () => {
    const { adult, members } = await setupFamily();
    const chore = (await app.inject({ method: 'POST', url: '/api/chores', cookies: adult, payload: { text: 'Feed the dog', assigneeId: members[2].id } })).json();
    await app.inject({ method: 'PUT', url: `/api/chores/${chore.id}/done/${today}`, cookies: adult, payload: { done: true } });
    const list = (await app.inject({ url: `/api/chores?date=${today}`, cookies: adult })).json<ChoreForDay[]>();
    expect(list[0]).toMatchObject({ text: 'Feed the dog', icon: '🐕', done: true, scheduled: true });
    const next = (await app.inject({ url: `/api/chores?date=${addDays(today, 1)}`, cookies: adult })).json<ChoreForDay[]>();
    expect(next[0].done).toBe(false);
  });

  it('rolls a monthly bill forward when paid', async () => {
    const { adult } = await setupFamily();
    const bill = (await app.inject({ method: 'POST', url: '/api/bills', cookies: adult, payload: { name: 'Hydro', amountCents: 14260, due: '2026-10-31', monthly: true } })).json();
    const paid = (await app.inject({ method: 'POST', url: `/api/bills/${bill.id}/pay`, cookies: adult })).json();
    expect(paid).toMatchObject({ due: '2026-11-30', paidAt: null });
  });
});

describe('sample family', () => {
  it('seeds a lived-in week', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/setup', payload: { sample: true } });
    const adult = sessionFrom(res);
    const occ = (await app.inject({ url: `/api/occurrences?from=${today}&to=${addDays(today, 14)}`, cookies: adult })).json<Occurrence[]>();
    expect(occ.some((o) => o.title === 'Taco night')).toBe(true);
    const plans = (await app.inject({ url: '/api/plans', cookies: adult })).json<Plan[]>();
    expect(plans[0].tasks).toHaveLength(9);
  });
});
