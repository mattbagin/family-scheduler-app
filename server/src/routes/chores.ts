import type { FastifyInstance } from 'fastify';
import { addDays, addMonths, dayDiff, expandDates, guessTaskIcon, isYmd, ymd, type Chore, type ChoreForDay } from '../../../shared/src/index.ts';
import { requireAuth, requireCanComplete, requireEditor } from '../auth.ts';
import type { Ctx } from '../context.ts';
import { get, run, tx } from '../db.ts';
import { badRequest, idParam, parseBody, parsePatch, v } from '../http.ts';
import { choresBetween, getBill, getChore, listBills, listChores } from '../repo.ts';

export function choreRoutes(app: FastifyInstance, { db, changed }: Ctx) {
  const checkMembers = (ids: number[]) => {
    for (const id of ids) if (!get(db, 'SELECT 1 FROM members WHERE id = ?', id)) throw badRequest(`memberIds: no family member with id ${id}`);
  };
  const setMembers = (choreId: number, ids: number[]) => {
    run(db, 'DELETE FROM chore_members WHERE chore_id = ?', choreId);
    for (const id of ids) run(db, 'INSERT INTO chore_members (chore_id, member_id) VALUES (?, ?)', choreId, id);
  };

  app.get('/api/chores', async (req): Promise<Chore[]> => {
    requireAuth(req);
    return listChores(db);
  });

  /** ?date= for one day, or ?from=&to= for a range (to is exclusive). */
  app.get('/api/chores/due', async (req): Promise<ChoreForDay[]> => {
    requireAuth(req);
    const q = req.query as { date?: string; from?: string; to?: string };
    const from = q.date ?? q.from;
    const to = q.date && isYmd(q.date) ? addDays(q.date, 1) : q.to;
    if (!isYmd(from) || !isYmd(to)) throw badRequest('date (or from and to) must be dates like 2026-10-05');
    const span = dayDiff(from, to);
    if (span <= 0 || span > 62) throw badRequest('to must be 1 to 62 days after from');
    return choresBetween(db, from, to);
  });

  const choreSchema = { text: v.text(60), icon: v.text(16), memberIds: v.ids, rrule: v.rrule, start: v.ymd, sort: v.int(0, 1000) };

  app.post('/api/chores', async (req, reply) => {
    requireEditor(req);
    const c = parseBody(choreSchema, req.body, ['icon', 'memberIds', 'rrule', 'start', 'sort']);
    const memberIds = c.memberIds ?? [];
    checkMembers(memberIds);
    const id = tx(db, () => {
      const { id } = run(
        db, 'INSERT INTO chores (text, icon, rrule, start, sort) VALUES (?, ?, ?, ?, ?)',
        c.text, c.icon ?? guessTaskIcon(c.text), c.rrule ?? 'FREQ=DAILY', c.start ?? ymd(new Date()), c.sort ?? 0,
      );
      setMembers(id, memberIds);
      return id;
    });
    changed('chores');
    return reply.status(201).send(getChore(db, id));
  });

  app.patch('/api/chores/:id', async (req) => {
    requireEditor(req);
    const c = getChore(db, idParam(req.params));
    const p = parsePatch(choreSchema, req.body);
    if (p.memberIds) checkMembers(p.memberIds);
    tx(db, () => {
      run(
        db, 'UPDATE chores SET text = ?, icon = ?, rrule = ?, start = ?, sort = ? WHERE id = ?',
        p.text ?? c.text, p.icon ?? (p.text ? guessTaskIcon(p.text) : c.icon), p.rrule ?? c.rrule, p.start ?? c.start, p.sort ?? c.sort, c.id,
      );
      if (p.memberIds) setMembers(c.id, p.memberIds);
    });
    changed('chores');
    return getChore(db, c.id);
  });

  app.delete('/api/chores/:id', async (req, reply) => {
    requireEditor(req);
    run(db, 'DELETE FROM chores WHERE id = ?', getChore(db, idParam(req.params)).id);
    changed('chores');
    return reply.status(204).send();
  });

  // memberId says whose tile it is; leave it out for a family job, which anyone can tick.
  app.put('/api/chores/:id/done/:date', async (req) => {
    const c = getChore(db, idParam(req.params));
    const date = (req.params as { date: string }).date;
    if (!isYmd(date)) throw badRequest('date: must be a date like 2026-10-05');
    const { done, memberId } = parseBody({ done: v.bool, memberId: v.optId }, req.body, ['memberId']);
    if (c.memberIds.length) {
      if (!memberId || !c.memberIds.includes(memberId)) throw badRequest('memberId: say whose job this is');
      requireCanComplete(req, memberId);
    } else {
      if (memberId) throw badRequest('memberId: this is a family job, so leave it out');
      requireAuth(req);
    }
    if (!expandDates(c.start, c.rrule, date, addDays(date, 1)).length) throw badRequest('date: this job isn’t due that day');
    if (date > ymd(new Date())) throw badRequest('date: this job isn’t due yet, so tick it off on the day');
    if (done) {
      run(
        db, 'INSERT OR IGNORE INTO chore_completions (chore_id, member_id, date, completed_at) VALUES (?, ?, ?, ?)',
        c.id, memberId ?? 0, date, new Date().toISOString(),
      );
    } else {
      run(db, 'DELETE FROM chore_completions WHERE chore_id = ? AND member_id = ? AND date = ?', c.id, memberId ?? 0, date);
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
