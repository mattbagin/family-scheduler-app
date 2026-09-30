import type { FastifyInstance } from 'fastify';
import { addMonths, guessTaskIcon, isYmd, weekdayMon, ymd, type ChoreForDay } from '../../../shared/src/index.ts';
import { requireAuth, requireCanComplete, requireEditor } from '../auth.ts';
import type { Ctx } from '../context.ts';
import { all, get, run, tx } from '../db.ts';
import { badRequest, idParam, parseBody, parsePatch, v } from '../http.ts';
import { getBill, getChore, listBills, toChore, type ChoreRow } from '../repo.ts';

export function choreRoutes(app: FastifyInstance, { db, changed }: Ctx) {
  const checkAssignee = (id: number) => {
    if (!get(db, 'SELECT 1 FROM members WHERE id = ?', id)) throw badRequest(`assigneeId: no family member with id ${id}`);
  };

  app.get('/api/chores', async (req): Promise<ChoreForDay[]> => {
    requireAuth(req);
    const date = (req.query as { date?: string }).date ?? ymd(new Date());
    if (!isYmd(date)) throw badRequest('date: must be a date like 2026-10-05');
    const done = new Set(all<{ chore_id: number }>(db, 'SELECT chore_id FROM chore_completions WHERE date = ?', date).map((r) => r.chore_id));
    const wd = weekdayMon(date);
    return all<ChoreRow>(db, 'SELECT * FROM chores ORDER BY assignee_id, sort, id').map((r) => {
      const c = toChore(r);
      return { ...c, date, scheduled: c.days.includes(wd), done: done.has(c.id) };
    });
  });

  const choreSchema = { text: v.text(60), icon: v.text(16), assigneeId: v.int(1), days: v.weekdays, sort: v.int(0, 1000) };

  app.post('/api/chores', async (req, reply) => {
    requireEditor(req);
    const c = parseBody(choreSchema, req.body, ['icon', 'days', 'sort']);
    checkAssignee(c.assigneeId);
    const { id } = run(
      db, 'INSERT INTO chores (text, icon, assignee_id, days, sort) VALUES (?, ?, ?, ?, ?)',
      c.text, c.icon ?? guessTaskIcon(c.text), c.assigneeId, (c.days ?? [0, 1, 2, 3, 4, 5, 6]).join(','), c.sort ?? 0,
    );
    changed('chores');
    return reply.status(201).send(getChore(db, id));
  });

  app.patch('/api/chores/:id', async (req) => {
    requireEditor(req);
    const c = getChore(db, idParam(req.params));
    const p = parsePatch(choreSchema, req.body);
    if (p.assigneeId) checkAssignee(p.assigneeId);
    run(
      db, 'UPDATE chores SET text = ?, icon = ?, assignee_id = ?, days = ?, sort = ? WHERE id = ?',
      p.text ?? c.text, p.icon ?? c.icon, p.assigneeId ?? c.assigneeId, (p.days ?? c.days).join(','), p.sort ?? c.sort, c.id,
    );
    changed('chores');
    return getChore(db, c.id);
  });

  app.delete('/api/chores/:id', async (req, reply) => {
    requireEditor(req);
    run(db, 'DELETE FROM chores WHERE id = ?', getChore(db, idParam(req.params)).id);
    changed('chores');
    return reply.status(204).send();
  });

  app.put('/api/chores/:id/done/:date', async (req) => {
    const c = getChore(db, idParam(req.params));
    requireCanComplete(req, c.assigneeId);
    const date = (req.params as { date: string }).date;
    if (!isYmd(date)) throw badRequest('date: must be a date like 2026-10-05');
    const { done } = parseBody({ done: v.bool }, req.body);
    if (done) {
      run(db, 'INSERT OR IGNORE INTO chore_completions (chore_id, date, completed_at) VALUES (?, ?, ?)', c.id, date, new Date().toISOString());
    } else {
      run(db, 'DELETE FROM chore_completions WHERE chore_id = ? AND date = ?', c.id, date);
    }
    changed('chores');
    return { ok: true };
  });

  /* ---------- bills ---------- */

  const billSchema = { name: v.text(60), icon: v.text(16), amountCents: v.int(0, 100_000_000), due: v.ymd, monthly: v.bool, autopay: v.bool };

  app.get('/api/bills', async (req) => {
    requireAuth(req);
    return listBills(db);
  });

  app.post('/api/bills', async (req, reply) => {
    requireEditor(req);
    const b = parseBody(billSchema, req.body, ['icon', 'monthly', 'autopay']);
    const { id } = run(
      db, 'INSERT INTO bills (name, icon, amount_cents, due, monthly, autopay) VALUES (?, ?, ?, ?, ?, ?)',
      b.name, b.icon ?? '💵', b.amountCents, b.due, b.monthly ? 1 : 0, b.autopay ? 1 : 0,
    );
    changed('bills');
    return reply.status(201).send(getBill(db, id));
  });

  app.patch('/api/bills/:id', async (req) => {
    requireEditor(req);
    const bill = getBill(db, idParam(req.params));
    const p = parsePatch(billSchema, req.body);
    run(
      db, 'UPDATE bills SET name = ?, icon = ?, amount_cents = ?, due = ?, monthly = ?, autopay = ? WHERE id = ?',
      p.name ?? bill.name, p.icon ?? bill.icon, p.amountCents ?? bill.amountCents, p.due ?? bill.due,
      (p.monthly ?? bill.monthly) ? 1 : 0, (p.autopay ?? bill.autopay) ? 1 : 0, bill.id,
    );
    changed('bills');
    return getBill(db, bill.id);
  });

  app.delete('/api/bills/:id', async (req, reply) => {
    requireEditor(req);
    run(db, 'DELETE FROM bills WHERE id = ?', getBill(db, idParam(req.params)).id);
    changed('bills');
    return reply.status(204).send();
  });

  // Paying a monthly bill records the payment and rolls it to next month's due date.
  app.post('/api/bills/:id/pay', async (req) => {
    requireEditor(req);
    const bill = getBill(db, idParam(req.params));
    const now = new Date().toISOString();
    tx(db, () => {
      run(db, 'INSERT INTO bill_payments (bill_id, due, paid_at) VALUES (?, ?, ?)', bill.id, bill.due, now);
      if (bill.monthly) run(db, 'UPDATE bills SET due = ?, paid_at = NULL WHERE id = ?', addMonths(bill.due, 1), bill.id);
      else run(db, 'UPDATE bills SET paid_at = ? WHERE id = ?', now, bill.id);
    });
    changed('bills');
    return getBill(db, bill.id);
  });
}
