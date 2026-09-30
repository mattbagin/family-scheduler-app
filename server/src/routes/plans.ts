import type { FastifyInstance } from 'fastify';
import { addMinutes, guessPlanIcon, guessTaskIcon } from '../../../shared/src/index.ts';
import { requireAuth, requireCanComplete, requireEditor } from '../auth.ts';
import type { Ctx } from '../context.ts';
import { all, get, run, tx, type Db } from '../db.ts';
import { badRequest, HttpError, idParam, parseBody, parsePatch, v } from '../http.ts';
import { getEvent, getPlan, getTask, listPlans } from '../repo.ts';
import { eventDefaults, insertEvent } from './events.ts';

export function createPlan(db: Db, eventId: number, title: string, icon: string, notes: string | null = null): number {
  if (get(db, 'SELECT 1 FROM plans WHERE event_id = ?', eventId)) throw new HttpError(409, 'exists', 'This event already has a plan');
  return run(db, 'INSERT INTO plans (event_id, title, icon, notes) VALUES (?, ?, ?, ?)', eventId, title, icon, notes).id;
}

export function addTask(db: Db, planId: number, t: { text: string; icon?: string; assigneeId: number | null; due: string }): number {
  return run(
    db, 'INSERT INTO plan_tasks (plan_id, text, icon, assignee_id, due) VALUES (?, ?, ?, ?, ?)',
    planId, t.text, t.icon ?? guessTaskIcon(t.text), t.assigneeId, t.due,
  ).id;
}

const checkAssignee = (db: Db, id: number | null | undefined) => {
  if (id && !get(db, 'SELECT 1 FROM members WHERE id = ?', id)) throw badRequest(`assigneeId: no family member with id ${id}`);
};

export function planRoutes(app: FastifyInstance, { db, changed }: Ctx) {
  app.get('/api/plans', async (req) => {
    requireAuth(req);
    return listPlans(db);
  });

  // Either turn an existing event into a plan ({ eventId }) or create the event and plan together.
  app.post('/api/plans', async (req, reply) => {
    requireEditor(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    let planId: number;
    if (b.eventId !== undefined) {
      const ev = getEvent(db, v.int(1)(b.eventId, 'eventId'));
      planId = createPlan(db, ev.id, ev.title, guessPlanIcon(ev.title) === '📋' ? ev.icon : guessPlanIcon(ev.title));
    } else {
      const p = parseBody(
        { title: v.text(120), start: v.dateTime, end: v.dateTime, memberIds: v.ids, icon: v.text(16), notes: v.optText(500) },
        b, ['end', 'memberIds', 'icon', 'notes'],
      );
      const icon = p.icon ?? guessPlanIcon(p.title);
      const memberIds = p.memberIds ?? all<{ id: number }>(db, 'SELECT id FROM members').map((m) => m.id);
      planId = tx(db, () => {
        const eventId = insertEvent(db, eventDefaults({
          title: p.title, icon, category: 'family', start: p.start, end: p.end ?? addMinutes(p.start, 180), memberIds, fun: true,
        }));
        return createPlan(db, eventId, p.title, icon, p.notes ?? null);
      });
    }
    changed('plans', 'events');
    return reply.status(201).send(getPlan(db, planId));
  });

  app.patch('/api/plans/:id', async (req) => {
    requireEditor(req);
    const plan = getPlan(db, idParam(req.params));
    const p = parsePatch({ title: v.text(120), icon: v.text(16), notes: v.optText(500) }, req.body);
    tx(db, () => {
      run(db, 'UPDATE plans SET title = ?, icon = ?, notes = ? WHERE id = ?', p.title ?? plan.title, p.icon ?? plan.icon,
        p.notes === undefined ? plan.notes : p.notes, plan.id);
      if (p.title) run(db, 'UPDATE events SET title = ? WHERE id = ?', p.title, plan.eventId);
    });
    changed('plans', 'events');
    return getPlan(db, plan.id);
  });

  // Removes the task list; the calendar event stays.
  app.delete('/api/plans/:id', async (req, reply) => {
    requireEditor(req);
    const plan = getPlan(db, idParam(req.params));
    run(db, 'DELETE FROM plans WHERE id = ?', plan.id);
    changed('plans', 'events');
    return reply.status(204).send();
  });

  app.post('/api/plans/:id/tasks', async (req, reply) => {
    requireEditor(req);
    const plan = getPlan(db, idParam(req.params));
    const t = parseBody({ text: v.text(120), icon: v.text(16), assigneeId: v.optId, due: v.ymd }, req.body, ['icon', 'assigneeId']);
    checkAssignee(db, t.assigneeId);
    const id = addTask(db, plan.id, { ...t, assigneeId: t.assigneeId ?? null });
    changed('plans');
    return reply.status(201).send(getTask(db, id));
  });

  app.patch('/api/tasks/:id', async (req) => {
    const task = getTask(db, idParam(req.params));
    const p = parsePatch({ text: v.text(120), icon: v.text(16), assigneeId: v.optId, due: v.ymd, done: v.bool }, req.body);
    const onlyDone = Object.keys(p).every((k) => k === 'done');
    if (onlyDone) requireCanComplete(req, task.assigneeId);
    else requireEditor(req);
    checkAssignee(db, p.assigneeId);
    const doneAt = p.done === undefined ? task.doneAt : p.done ? (task.doneAt ?? new Date().toISOString()) : null;
    run(
      db, 'UPDATE plan_tasks SET text = ?, icon = ?, assignee_id = ?, due = ?, done_at = ? WHERE id = ?',
      p.text ?? task.text, p.icon ?? (p.text ? guessTaskIcon(p.text) : task.icon),
      p.assigneeId === undefined ? task.assigneeId : p.assigneeId, p.due ?? task.due, doneAt, task.id,
    );
    changed('plans');
    return getTask(db, task.id);
  });

  app.delete('/api/tasks/:id', async (req, reply) => {
    requireEditor(req);
    const task = getTask(db, idParam(req.params));
    run(db, 'DELETE FROM plan_tasks WHERE id = ?', task.id);
    changed('plans');
    return reply.status(204).send();
  });
}
