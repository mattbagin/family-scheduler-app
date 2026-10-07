import type { FastifyInstance } from 'fastify';
import { addDays, dayDiff, expandDates, guessTaskIcon, isYmd, ymd, type Todo } from '../../../shared/src/index.ts';
import { requireAuth, requireCanComplete, requireEditor } from '../auth.ts';
import type { Ctx } from '../context.ts';
import { get, run, tx, type Db } from '../db.ts';
import { badRequest, idParam, parseBody, parsePatch, v } from '../http.ts';
import { getEvent, getTodo, listTodos, prepBetween } from '../repo.ts';

const optYmd = (x: unknown, f: string): string | null => (x === null ? null : v.ymd(x, f));

const todoSchema = {
  kind: v.oneOf('todo', 'prep'),
  text: v.text(120),
  icon: v.text(16),
  assigneeId: v.optId,
  due: optYmd,
  rrule: v.optRRule,
  done: v.bool,
};

/** The next day a repeating to-do is due, after both its own day and today; null once the rule has run out. */
export function nextDue(due: string, rrule: string, today: string): string | null {
  const after = addDays(due > today ? due : today, 1);
  return expandDates(due, rrule, after, addDays(after, 800))[0] ?? null;
}

/** Ticking a repeating to-do adds the next one; unticking takes it back if nobody has touched it. */
function rollOver(db: Db, todo: Todo, done: boolean) {
  const nextId = get<{ next_id: number | null }>(db, 'SELECT next_id FROM todos WHERE id = ?', todo.id)?.next_id;
  if (done && todo.rrule && todo.due && !nextId) {
    const due = nextDue(todo.due, todo.rrule, ymd(new Date()));
    if (!due) return;
    const { id } = run(
      db, 'INSERT INTO todos (kind, text, icon, assignee_id, due, rrule, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      todo.kind, todo.text, todo.icon, todo.assigneeId, due, todo.rrule, new Date().toISOString(),
    );
    run(db, 'UPDATE todos SET next_id = ? WHERE id = ?', id, todo.id);
  } else if (!done && nextId) {
    run(db, 'DELETE FROM todos WHERE id = ? AND done_at IS NULL', nextId);
    run(db, 'UPDATE todos SET next_id = NULL WHERE id = ?', todo.id);
  }
}

/** Prep items get a backpack unless the words suggest something better. */
const iconFor = (kind: string, text: string) => {
  const guess = guessTaskIcon(text);
  return guess === '✅' && kind === 'prep' ? '🎒' : guess;
};

export function todoRoutes(app: FastifyInstance, { db, changed }: Ctx) {
  const checkAssignee = (id: number | null | undefined) => {
    if (id && !get(db, 'SELECT 1 FROM members WHERE id = ?', id)) throw badRequest(`assigneeId: no family member with id ${id}`);
  };

  app.get('/api/todos', async (req) => {
    requireAuth(req);
    // Keep a day of finished items so a tick doesn't vanish the moment it's made.
    return listTodos(db, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  });

  app.post('/api/todos', async (req, reply) => {
    requireEditor(req);
    const { done: _done, ...schema } = todoSchema;
    const t = parseBody(schema, req.body, ['kind', 'icon', 'assigneeId', 'due', 'rrule']);
    const kind = t.kind ?? 'todo';
    if (kind === 'prep' && !t.due) throw badRequest('due: say which day to get this ready for');
    checkAssignee(t.assigneeId);
    // A repeating to-do needs a day to count from; with none, it starts today.
    const due = t.due ?? (t.rrule ? ymd(new Date()) : null);
    const { id } = run(
      db, 'INSERT INTO todos (kind, text, icon, assignee_id, due, rrule, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      kind, t.text, t.icon ?? iconFor(kind, t.text), t.assigneeId ?? null, due, t.rrule ?? null, new Date().toISOString(),
    );
    changed('todos');
    return reply.status(201).send(getTodo(db, id));
  });

  // Ticking off is open to whoever it's for; changing anything else needs a parent.
  app.patch('/api/todos/:id', async (req) => {
    const todo = getTodo(db, idParam(req.params));
    const p = parsePatch(todoSchema, req.body);
    if (Object.keys(p).every((k) => k === 'done')) requireCanComplete(req, todo.assigneeId);
    else requireEditor(req);
    checkAssignee(p.assigneeId);
    const kind = p.kind ?? todo.kind;
    const due = p.due === undefined ? todo.due : p.due;
    const rrule = p.rrule === undefined ? todo.rrule : p.rrule;
    if (kind === 'prep' && !due) throw badRequest('due: say which day to get this ready for');
    if (rrule && !due) throw badRequest('due: say which day this repeats from');
    const doneAt = p.done === undefined ? todo.doneAt : p.done ? (todo.doneAt ?? new Date().toISOString()) : null;
    tx(db, () => {
      run(
        db, 'UPDATE todos SET kind = ?, text = ?, icon = ?, assignee_id = ?, due = ?, rrule = ?, done_at = ? WHERE id = ?',
        kind, p.text ?? todo.text, p.icon ?? (p.text ? iconFor(kind, p.text) : todo.icon),
        p.assigneeId === undefined ? todo.assigneeId : p.assigneeId, due, rrule, doneAt, todo.id,
      );
      if (p.done !== undefined) rollOver(db, getTodo(db, todo.id), p.done);
    });
    changed('todos');
    return getTodo(db, todo.id);
  });

  app.delete('/api/todos/:id', async (req, reply) => {
    requireEditor(req);
    run(db, 'DELETE FROM todos WHERE id = ?', getTodo(db, idParam(req.params)).id);
    changed('todos');
    return reply.status(204).send();
  });

  /* ---------- prep: what to pack or do before each day ---------- */

  app.get('/api/prep', async (req) => {
    requireAuth(req);
    const { from, to } = req.query as { from?: string; to?: string };
    if (!isYmd(from) || !isYmd(to)) throw badRequest('from and to must be dates like 2026-10-05');
    const span = dayDiff(from, to);
    if (span <= 0 || span > 31) throw badRequest('to must be 1 to 31 days after from');
    return prepBetween(db, from, to);
  });

  // Tick an event's "bring" note as packed for one date (anyone going can).
  app.put('/api/events/:id/packed/:date', async (req) => {
    const ev = getEvent(db, idParam(req.params));
    requireCanComplete(req, ev.memberIds);
    const date = (req.params as { date: string }).date;
    if (!isYmd(date)) throw badRequest('date: must be a date like 2026-10-05');
    if (!ev.bring) throw badRequest('This event has nothing to bring');
    if (!prepBetween(db, date, addDays(date, 1)).some((p) => p.eventId === ev.id)) throw badRequest(`${ev.title} doesn’t happen on ${date}`);
    const { packed } = parseBody({ packed: v.bool }, req.body);
    if (packed) run(db, 'INSERT OR IGNORE INTO packed (event_id, date, packed_at) VALUES (?, ?, ?)', ev.id, date, new Date().toISOString());
    else run(db, 'DELETE FROM packed WHERE event_id = ? AND date = ?', ev.id, date);
    changed('todos');
    return { ok: true };
  });
}
