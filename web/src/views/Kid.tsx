import { Link, Navigate, useParams } from 'react-router-dom';
import { addDays, dayDiff, dayLabel, fmtTime, minutesOf } from '@shared';
import { useFamily, useNow } from '../context.tsx';
import { endAbs, mainRange, occDate, sleepsWord, startAbs } from '../lib.ts';
import { useChores, useOccurrences, usePlans, usePrep, useTodos } from '../queries.ts';
import { useToggleTask } from '../sheets/PlanSheet.tsx';
import { PrepTiles, useToggleTodo } from '../todos.tsx';
import { Avatar, ClockFace, Face, pc } from '../ui.tsx';
import { ChoreTile } from './Person.tsx';

/** Picture-first view for young kids: now, next, later, my jobs, and sleeps until the fun stuff. */
export function Kid() {
  const { id } = useParams();
  const f = useFamily();
  const { today, nowMin } = useNow();
  const range = mainRange(today);
  const { data: occs = [] } = useOccurrences(range.from, range.to);
  const { data: chores = [] } = useChores(today);
  const { data: plans = [] } = usePlans();
  const { data: prep = [] } = usePrep(today, addDays(today, 2), nowMin);
  const { data: todos = [] } = useTodos();
  const toggleTask = useToggleTask();
  const toggleTodo = useToggleTodo();
  const kids = f.members.filter((m) => m.role === 'kid');
  const fallback = f.me?.role === 'kid' ? f.me : kids[0];
  if (!id) return fallback ? <Navigate to={`/kid/${fallback.id}`} replace /> : <p className="empty">Add a kid in Settings to use kid mode.</p>;
  const k = f.byId(Number(id));
  if (!k) return <Navigate to="/kid" replace />;

  const color = k.color;
  const mine = occs.filter((o) => o.memberIds.includes(k.id) && !o.allDay && occDate(o) === today).sort((a, b) => (a.start < b.start ? -1 : 1));
  const cur = mine.find((o) => startAbs(today, o) <= nowMin && nowMin < endAbs(today, o));
  const up = mine.filter((o) => startAbs(today, o) > nowMin);
  const next = up[0];
  const later = up.slice(1);
  const late = nowMin > 19.5 * 60;
  const myChores = chores.filter((c) => c.assigneeId === k.id && c.scheduled);
  const myPrep = prep.filter((p) => p.memberIds.includes(k.id));
  const myTodos = todos.filter((t) => t.kind === 'todo' && t.assigneeId === k.id);
  const seen = new Set<number>();
  const sleeps = occs
    .filter((o) => o.fun && o.memberIds.includes(k.id) && occDate(o) > today)
    .filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)))
    .slice(0, 3);

  return (
    <div className="stack">
      <div className="kidpick">
        {kids.map((m) => (
          <Link key={m.id} to={`/kid/${m.id}`} className="kidbtn" aria-current={m.id === k.id} style={pc(m.color)}>
            <Avatar m={m} />{m.name}
          </Link>
        ))}
      </div>
      <div className="kid" style={pc(color)}>
        <div className="col">
          <section className="now-card">
            <span className="tagbig">RIGHT NOW</span>
            {cur ? (
              <>
                <div className="row"><span className="big">{cur.icon}</span><div className="word">{cur.kidTitle ?? cur.title}</div></div>
                <div className="face-clock"><ClockFace min={minutesOf(cur.end)} color={color} /><span>Finishes when the clock looks like this</span></div>
              </>
            ) : (
              <div className="row"><span className="big">{late ? '😴' : '🎈'}</span><div className="word">{late ? 'Sleepy time' : 'Free time!'}</div></div>
            )}
          </section>
          {next && (
            <section className="now-card next">
              <span className="tagbig">NEXT</span>
              <div className="row">
                <span className="big">{next.icon}</span>
                <div>
                  <div className="word">{next.kidTitle ?? next.title}</div>
                  {next.driverId && <div className="face-clock"><Face m={f.byId(next.driverId)} size={36} />{f.byId(next.driverId)?.name} takes you</div>}
                </div>
              </div>
              <div className="face-clock"><ClockFace min={minutesOf(next.start)} color={color} /><span>Starts when the clock looks like this</span></div>
            </section>
          )}
          {later.length > 0 && (
            <div>
              <div className="label" style={{ marginBottom: 8 }}>Later today</div>
              <div className="pics">
                {later.map((o) => (
                  <div key={o.key} className="pic"><span className="tag">{fmtTime(minutesOf(o.start)).replace(':00', '')}</span><span className="e">{o.icon}</span>{o.kidTitle ?? o.title}</div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="col">
          {myChores.length > 0 && (
            <section className="panel"><h2>My jobs</h2><div className="tiles">{myChores.map((c) => <ChoreTile key={c.id} c={c} all={chores} />)}</div></section>
          )}
          {myPrep.length > 0 && (
            <section className="panel"><h2>🎒 Get ready</h2><PrepTiles items={myPrep} /></section>
          )}
          {myTodos.length > 0 && (
            <section className="panel">
              <h2>Things to do</h2>
              <div className="tiles">
                {myTodos.map((t) => (
                  <button key={t.id} className={`tile ${t.doneAt ? 'is-done' : ''}`} aria-pressed={!!t.doneAt} onClick={(e) => toggleTodo(t, e.currentTarget)}>
                    <span className="e">{t.icon}</span>{t.text}{t.due && <span className="note">{dayLabel(today, t.due)}</span>}
                  </button>
                ))}
              </div>
            </section>
          )}
          {plans.map((p) => {
            const ts = p.tasks.filter((t) => t.assigneeId === k.id);
            if (!ts.length) return null;
            return (
              <section key={p.id} className="panel">
                <h2>{p.icon} Helping with {p.title.replace(/^Hosting /, '')}</h2>
                <div className="tiles">
                  {ts.map((t) => {
                    const n = dayDiff(today, t.due);
                    return (
                      <button key={t.id} className={`tile ${t.doneAt ? 'is-done' : ''}`} aria-pressed={!!t.doneAt} onClick={(e) => toggleTask(t, p, e.currentTarget)}>
                        <span className="e">{t.icon}</span>{t.text}
                        <span className="moons" aria-label={n > 0 ? `${n} ${sleepsWord(n)}` : 'Today'}>{n > 0 ? '🌙'.repeat(Math.min(n, 10)) : 'Today!'}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
          {sleeps.map((o) => {
            const n = dayDiff(today, occDate(o));
            return (
              <div key={o.key} className="sleep">
                <span className="e">{o.icon}</span>
                <div>
                  <b>{o.kidTitle ?? o.title}</b>
                  <span className="moons" aria-hidden="true">{'🌙'.repeat(Math.min(n, 14))}</span>
                  <div className="note">{n} {sleepsWord(n)} to go</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
