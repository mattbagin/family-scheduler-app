import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDays, weekdayMon, ymd, type Chore, type ChoreForDay } from '../../shared/src/index.ts';
import { buildApp } from '../src/app.ts';
import { all, openDb } from '../src/db.ts';
import { sessionFrom, setupFamily, type App } from './helpers.ts';

let app: App;
const today = ymd(new Date());

beforeEach(async () => {
  app = await buildApp({ db: openDb(':memory:') });
});
afterEach(async () => {
  await app.close();
});

const DAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

describe('chores', () => {
  it('repeats by rule, gives each person their own tile, and ticks per person and day', async () => {
    const { adult, members } = await setupFamily(app);
    const [alex, , kit] = members;
    const post = (payload: object) => app.inject({ method: 'POST', url: '/api/chores', cookies: adult, payload });
    const teeth = (await post({ text: 'Brush teeth', memberIds: [kit.id, alex.id] })).json<Chore>();
    expect(teeth).toMatchObject({ icon: '🪥', rrule: 'FREQ=DAILY', start: today, memberIds: [alex.id, kit.id] });
    const garbageDay = addDays(today, 2);
    const garbage = (await post({ text: 'Take out the garbage', rrule: `FREQ=WEEKLY;BYDAY=${DAY[weekdayMon(garbageDay)]}`, start: addDays(today, -7) })).json<Chore>();
    expect(garbage.memberIds).toEqual([]);
    await post({ text: 'Change the furnace filter', memberIds: [alex.id], rrule: 'FREQ=MONTHLY', start: addDays(today, 3) });

    const due = async (q: string) => (await app.inject({ url: `/api/chores/due?${q}`, cookies: adult })).json<ChoreForDay[]>();
    const twoWeeks = await due(`from=${today}&to=${addDays(today, 14)}`);
    expect(twoWeeks.filter((c) => c.id === teeth.id)).toHaveLength(28);
    expect(twoWeeks.filter((c) => c.id === garbage.id).map((c) => [c.date, c.memberId])).toEqual([[garbageDay, null], [addDays(garbageDay, 7), null]]);
    expect(twoWeeks.filter((c) => c.text.startsWith('Change')).map((c) => c.date)).toEqual([addDays(today, 3)]);

    const tick = (c: Chore, date: string, payload: object, cookies = adult) =>
      app.inject({ method: 'PUT', url: `/api/chores/${c.id}/done/${date}`, cookies, payload });
    const kid = sessionFrom(await app.inject({ method: 'POST', url: '/api/login', payload: { memberId: kit.id } }));
    expect((await tick(teeth, today, { done: true, memberId: kit.id }, kid)).statusCode).toBe(200);
    expect((await tick(teeth, today, { done: true, memberId: alex.id }, kid)).statusCode).toBe(403);
    expect((await tick(teeth, today, { done: true })).json().message).toMatch(/^memberId:/);
    // Anyone can do a family job, kids included, but only on its day, and not before it comes.
    const lastGarbage = addDays(garbageDay, -7);
    expect((await tick(garbage, lastGarbage, { done: true }, kid)).statusCode).toBe(200);
    expect((await tick(garbage, today, { done: true })).json().message).toMatch(/^date:/);
    expect((await tick(garbage, garbageDay, { done: true })).json().message).toMatch(/^date: this job isn’t due yet/);

    const day = await due(`date=${today}`);
    expect(day.filter((c) => c.id === teeth.id).map((c) => [c.memberId, c.done])).toEqual([[alex.id, false], [kit.id, true]]);
    expect((await due(`date=${lastGarbage}`)).find((c) => c.id === garbage.id)!.done).toBe(true);
    await tick(teeth, today, { done: false, memberId: kit.id }, kid);
    expect((await due(`date=${today}`)).every((c) => !c.done)).toBe(true);

    expect((await app.inject({ url: `/api/chores/due?from=${today}&to=${addDays(today, 90)}`, cookies: adult })).statusCode).toBe(400);
    expect((await post({ text: 'X', rrule: 'nonsense' })).statusCode).toBe(400);
  });

  it('edits people and repeats, and removes a person’s own chores with them', async () => {
    const { adult, members } = await setupFamily(app);
    const [alex, robin, kit] = members;
    const post = async (payload: object) => (await app.inject({ method: 'POST', url: '/api/chores', cookies: adult, payload })).json<Chore>();
    const patch = (c: Chore, payload: object) => app.inject({ method: 'PATCH', url: `/api/chores/${c.id}`, cookies: adult, payload });
    const bed = await post({ text: 'Make bed', memberIds: [kit.id] });
    const dishes = await post({ text: 'Dishes', memberIds: [kit.id, robin.id] });
    expect((await patch(bed, { memberIds: [kit.id, alex.id], rrule: 'FREQ=WEEKLY;BYDAY=SA' })).json<Chore>())
      .toMatchObject({ text: 'Make bed', memberIds: [alex.id, kit.id], rrule: 'FREQ=WEEKLY;BYDAY=SA' });
    await patch(bed, { memberIds: [kit.id] });
    expect((await patch(bed, { memberIds: [999] })).statusCode).toBe(400);

    await app.inject({ method: 'DELETE', url: `/api/members/${kit.id}`, cookies: adult });
    const left = (await app.inject({ url: '/api/chores', cookies: adult })).json<Chore[]>();
    expect(left).toMatchObject([{ id: dishes.id, memberIds: [robin.id] }]);
  });
});

describe('migration 007', () => {
  it('turns weekday chores and repeating to-dos into rule-based chores', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hb-'));
    const file = join(dir, 'old.db');
    let old: DatabaseSync | undefined;
    let db: DatabaseSync | undefined;
    try {
      // A database as it was before 007, with some old-style rows.
      old = new DatabaseSync(file);
      old.exec('PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
      const dirUrl = new URL('../src/migrations/', import.meta.url);
      for (const f of readdirSync(dirUrl).filter((f) => f < '007').sort()) {
        old.exec(readFileSync(new URL(f, dirUrl), 'utf8'));
        old.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(f, 'x');
      }
      old.exec(`
        INSERT INTO members (id, name, role, color, avatar) VALUES (1, 'Kit', 'kid', '#1F9C62', '👦');
        INSERT INTO chores (id, text, icon, assignee_id, days) VALUES (1, 'Make bed', '🛏️', 1, '0,1,2,3,4,5,6'), (2, 'Piano', '🎹', 1, '0,2,4');
        INSERT INTO chore_completions VALUES (1, '2026-10-01', 'x');
        INSERT INTO todos (id, kind, text, icon, assignee_id, due, rrule, created_at, done_at) VALUES
          (5, 'todo', 'Bins out', '🗑️', NULL, '2026-10-19', 'FREQ=WEEKLY;BYDAY=MO', 'x', NULL),
          (6, 'todo', 'Feed fish', '🐟', 1, '2026-10-18', 'FREQ=DAILY', 'x', 'done'),
          (7, 'prep', 'Gym shoes', '👟', 1, '2026-10-20', 'FREQ=WEEKLY;BYDAY=TU', 'x', NULL);
      `);
      old.close();
      old = undefined;

      db = openDb(file);
      expect(all(db, 'SELECT id, text, rrule, start FROM chores ORDER BY id')).toEqual([
        { id: 1, text: 'Make bed', rrule: 'FREQ=DAILY', start: '2026-10-01' },
        { id: 2, text: 'Piano', rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR', start: today },
        { id: 7, text: 'Bins out', rrule: 'FREQ=WEEKLY;BYDAY=MO', start: '2026-10-19' },
      ]);
      // Bins out had nobody on it, so it's a family job.
      expect(all(db, 'SELECT * FROM chore_members ORDER BY chore_id')).toEqual([{ chore_id: 1, member_id: 1 }, { chore_id: 2, member_id: 1 }]);
      expect(all(db, 'SELECT chore_id, member_id, date FROM chore_completions')).toEqual([{ chore_id: 1, member_id: 1, date: '2026-10-01' }]);
      expect(all(db, 'SELECT id, rrule FROM todos ORDER BY id')).toEqual([{ id: 6, rrule: null }, { id: 7, rrule: 'FREQ=WEEKLY;BYDAY=TU' }]);
      // The renamed tables still cascade.
      db.exec('DELETE FROM chores WHERE id = 1');
      expect(all(db, 'SELECT * FROM chore_completions')).toEqual([]);
    } finally {
      old?.close();
      db?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
