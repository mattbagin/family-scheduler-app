import { Link, Navigate, useParams } from 'react-router-dom';
import { addDays, dayLabel, fmtShortDate, fmtTime, type ChoreForDay } from '@shared';
import { api } from '../api.ts';
import { namesOf, useAction, useFamily, useNow } from '../context.tsx';
import { mainRange, money, occDate, personItems, type PersonItem, relDay } from '../lib.ts';
import { useBills, useChores, useOccurrences, usePlans, usePrep, useTodos } from '../queries.ts';
import { EventSheet } from '../sheets/EventSheet.tsx';
import { TaskRow, useToggleTask } from '../sheets/PlanSheet.tsx';
import { NudgeFeed } from '../nudges.tsx';
import { AddTodo, PrepList, PrepTiles, TodoRow, useToggleTodo } from '../todos.tsx';
import { Avatar, burstFrom, celebrate, chime, pc, useSheets, useToast } from '../ui.tsx';

export function useToggleChore() {
  const f = useFamily();
  const act = useAction();
  const toast = useToast();
  return async (c: ChoreForDay, all: ChoreForDay[], el: Element | null) => {
    const done = !c.done;
    if (done) {
      burstFrom(el);
      chime([784, 988, 1319]);
    }
    const ok = await act(() => api(`/chores/${c.id}/done/${c.date}`, { method: 'PUT', body: { done } }));
    if (ok && done) {
      const left = all.filter((x) => x.assigneeId === c.assigneeId && x.scheduled && !x.done && x.id !== c.id).length;
      const name = f.byId(c.assigneeId)?.name ?? '';
      if (left) toast(`Nice one, ${name}! ${left} to go.`);
      else celebrate(`All jobs done, ${name}!`);
    }
  };
}

export function ChoreTile({ c, all }: { c: ChoreForDay; all: ChoreForDay[] }) {
  const toggle = useToggleChore();
  return (
    <button className={`tile ${c.done ? 'is-done' : ''}`} aria-pressed={c.done} onClick={(e) => toggle(c, all, e.currentTarget)}>
      <span className="e" aria-hidden="true">{c.icon}</span>{c.text}
    </button>
  );
}

/** One person's page: their day, their week, their jobs. */
export function Person() {
  const { id } = useParams();
  const f = useFamily();
  const sheets = useSheets();
  const { today, nowMin } = useNow();
  const range = mainRange(today);
  const { data: occs = [] } = useOccurrences(range.from, range.to);
  const { data: plans = [] } = usePlans();
  const { data: chores = [] } = useChores(today);
  const { data: bills = [] } = useBills();
  const { data: todos = [] } = useTodos();
  const { data: prep = [] } = usePrep(today, addDays(today, 2), nowMin);
  const toggleTask = useToggleTask();
  const toggleTodo = useToggleTodo();
  const m = f.byId(Number(id));
  if (!m) return <Navigate to="/" replace />;

  const items = personItems(today, occs, m.id);
  const todays = items.filter((i) => occDate(i.occ) === today || (i.s < 1440 && i.e > 0));
  const label = (i: PersonItem) => (i.drive ? `Drive ${namesOf(f, i.occ.memberIds)} to ${i.occ.title.toLowerCase()}` : i.occ.title);
  const isKid = m.role === 'kid';
  const myChores = chores.filter((c) => c.assigneeId === m.id && c.scheduled);
  const myPrep = prep.filter((p) => p.memberIds.includes(m.id));
  const myTodos = todos.filter((t) => t.kind === 'todo' && t.assigneeId === m.id);
  const anyones = isKid ? [] : todos.filter((t) => t.kind === 'todo' && t.assigneeId === null);
  const tasks = plans
    .flatMap((p) => p.tasks.filter((t) => t.assigneeId === m.id).map((t) => ({ t, p })))
    .sort((a, b) => Number(!!a.t.doneAt) - Number(!!b.t.doneAt) || (a.t.due < b.t.due ? -1 : 1));

  const chip = (i: PersonItem, withNow: boolean) => {
    const past = withNow && i.e <= nowMin;
    const now = withNow && i.s <= nowMin && nowMin < i.e;
    return (
      <button key={`${i.occ.key}:${i.drive}`} className={`chip ${i.drive ? 'drive' : ''} ${past ? 'past' : ''} ${now ? 'now' : ''}`} onClick={() => sheets.open(<EventSheet occ={i.occ} />)}>
        <span className="t num">{i.occ.allDay ? 'All day' : fmtTime(i.s)}</span>
        <span>{i.drive ? '🚗' : i.occ.icon}</span>
        <span>{label(i)} {now && <span className="pill good">Now</span>}</span>
      </button>
    );
  };

  const nextDays = Array.from({ length: 7 }, (_, n) => addDays(today, n + 1))
    .map((d) => ({ d, list: items.filter((i) => occDate(i.occ) === d && i.occ.category !== 'work') }))
    .filter((x) => x.list.length);

  return (
    <div style={pc(m.color)} className="stack">
      <div className="person-head">
        <Link to="/" className="icon-btn">← Family</Link>
        <Avatar m={m} className="xl" />
        <div>
          <h1>{m.name}’s schedule</h1>
          <div className="note">{dayLabel(today, today)}, {fmtShortDate(today)}</div>
        </div>
        <nav className="members small" aria-label="Switch person">
          {f.members.filter((x) => x.id !== m.id).map((x) => (
            <Link key={x.id} to={`/person/${x.id}`} className="mem-btn" style={pc(x.color)} aria-label={x.name}><Avatar m={x} /></Link>
          ))}
        </nav>
        {isKid && <Link to={`/kid/${m.id}`} className="primary" style={{ textDecoration: 'none' }}>Open kid mode</Link>}
      </div>

      <div className="two-col">
        <div className="col">
          <section className="panel">
            <h2>Today</h2>
            <div className="chips">{todays.length ? todays.map((i) => chip(i, true)) : <p className="note">Nothing scheduled today.</p>}</div>
          </section>
          <section className="panel">
            <h2>Next 7 days</h2>
            {nextDays.length ? nextDays.map(({ d, list }) => (
              <div key={d} className="agenda-day">
                <div className="label">{dayLabel(today, d)} · {fmtShortDate(d)}</div>
                {list.map((i) => chip(i, false))}
              </div>
            )) : <p className="note">Nothing else this week.</p>}
          </section>
        </div>
        <div className="col">
          {myChores.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h2>Daily jobs</h2><span className="note">{myChores.filter((c) => c.done).length} of {myChores.length} done</span></div>
              <div className="tiles">{myChores.map((c) => <ChoreTile key={c.id} c={c} all={chores} />)}</div>
            </section>
          )}
          {myPrep.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h2>Get ready</h2><span className="note">{myPrep.filter((p) => !p.done).length} to pack</span></div>
              {isKid ? <PrepTiles items={myPrep} /> : <PrepList items={myPrep} showWho={false} />}
            </section>
          )}
          {!isKid && (
            <section className="panel">
              <div className="panel-head">
                <h2>To-dos</h2>
                <span className="note">{myTodos.filter((t) => !t.doneAt).length} open{f.session.kind !== 'hub' ? ' · swipe right when done, left for tomorrow' : ''}</span>
              </div>
              {myTodos.length ? <div className="tasks">{myTodos.map((t) => <TodoRow key={t.id} todo={t} />)}</div> : <p className="note">Nothing on the list.</p>}
              {anyones.length > 0 && (
                <>
                  <div className="label">Anyone can do these</div>
                  <div className="tasks">{anyones.map((t) => <TodoRow key={t.id} todo={t} />)}</div>
                </>
              )}
              {f.canEdit && <AddTodo assigneeId={m.id} />}
            </section>
          )}
          <section className="panel">
            <div className="panel-head"><h2>{isKid ? 'My tasks' : 'Plan tasks'}</h2><span className="note">{tasks.filter((x) => !x.t.doneAt).length + (isKid ? myTodos.filter((t) => !t.doneAt).length : 0)} to do</span></div>
            {!tasks.length && !(isKid && myTodos.length) ? <p className="note">No tasks assigned.</p> : isKid ? (
              <div className="tiles">
                {myTodos.map((t) => (
                  <button key={`todo-${t.id}`} className={`tile ${t.doneAt ? 'is-done' : ''}`} aria-pressed={!!t.doneAt} onClick={(e) => toggleTodo(t, e.currentTarget)}>
                    <span className="e" aria-hidden="true">{t.icon}</span>{t.text}{t.due && <span className="note">{dayLabel(today, t.due)}</span>}
                  </button>
                ))}
                {tasks.map(({ t, p }) => (
                  <button key={t.id} className={`tile ${t.doneAt ? 'is-done' : ''}`} aria-pressed={!!t.doneAt} onClick={(e) => toggleTask(t, p, e.currentTarget)}>
                    <span className="e" aria-hidden="true">{t.icon}</span>{t.text}<span className="note">{p.icon} {dayLabel(today, t.due)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="tasks">{tasks.map(({ t, p }) => <TaskRow key={t.id} task={t} plan={p} showPlan />)}</div>
            )}
          </section>
          {!isKid && (
            <section className="panel">
              <div className="panel-head"><h2>Recent nudges</h2><span className="note">Last 7 days</span></div>
              <NudgeFeed memberId={m.id} />
            </section>
          )}
          {!isKid && bills.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h2>Household bills</h2></div>
              <div>
                {bills.slice(0, 6).map((b) => (
                  <div key={b.id} className="bill">
                    <span className="e" aria-hidden="true">{b.icon}</span>
                    <div><b>{b.name}</b><div className="note">{b.autopay ? 'Autopay · ' : ''}{b.paidAt ? 'Paid' : `due ${relDay(today, b.due)}`}{b.monthly ? ' · monthly' : ''}</div></div>
                    <span className="amt num">{money(b.amountCents)}</span>
                    {b.paidAt ? <span className="paid">Paid ✓</span> : !b.autopay && <PayButton id={b.id} name={b.name} />}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function PayButton({ id, name }: { id: number; name: string }) {
  const act = useAction();
  return <button className="mini-btn" onClick={() => act(() => api(`/bills/${id}/pay`, { method: 'POST' }), `${name} marked paid`)}>Mark paid</button>;
}
