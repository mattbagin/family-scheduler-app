import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { addDays, dayDiff, dayLabel, fmtTime, minutesOf } from '@shared';
import { useFamily, useNow } from '../context.tsx';
import { endAbs, mainRange, occDate, sleepsWord, startAbs } from '../lib.ts';
import { useNight } from '../hub.tsx';
import { GrownUpsNote } from '../nudges.tsx';
import { useChores, useOccurrences, usePlans, usePrep, useTodos } from '../queries.ts';
import { useToggleTask } from '../sheets/PlanSheet.tsx';
import { PrepTiles, useToggleTodo } from '../todos.tsx';
import { Avatar, ClockFace, Face, pc } from '../ui.tsx';
import { ChoreTile } from './Person.tsx';

/** How long a grown-up holds the house to leave kid mode on the hub or a kid's own device. */
const HOLD_MS = 1200;

/**
 * The one way out of kid mode. A parent on their own phone just taps it; on the hub or a kid's
 * device it takes a one-second hold (the house fills up), which small hands rarely do by chance.
 */
function GrownUpsExit() {
  const f = useFamily();
  const navigate = useNavigate();
  const [holding, setHolding] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (f.me?.role === 'adult') return <Link to="/" className="icon-btn"><span aria-hidden="true">🏠</span> Back</Link>;
  const stop = () => { clearTimeout(timer.current); setHolding(false); };
  return (
    <button
      className={`grownups${holding ? ' holding' : ''}`}
      aria-label="For grown-ups: hold to leave kid mode"
      onPointerDown={() => { setHolding(true); timer.current = window.setTimeout(() => navigate('/'), HOLD_MS); }}
      onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate('/'); }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span aria-hidden="true">🏠</span><small>Hold</small>
    </button>
  );
}

/** Sleeps to go: the number, then moons in fives, so 9 and 10 look different without counting. */
function Sleeps({ n, max = 15 }: { n: number; max?: number }) {
  const shown = Math.min(n, max);
  const groups: number[] = [];
  for (let i = 0; i < shown; i += 5) groups.push(Math.min(5, shown - i));
  return (
    <span className="sleeps" role="img" aria-label={`${n} ${sleepsWord(n)} to go`}>
      <b className="num">{n}</b>
      <span className="moons">{groups.map((g, i) => <span key={i}>{'🌙'.repeat(g)}</span>)}{n > max && <span>…</span>}</span>
    </span>
  );
}

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
  const night = useNight() && f.session.kind === 'hub';
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
  // A kid's tiles skip the next round of a repeating job until its day comes.
  const myTodos = todos.filter((t) => t.kind === 'todo' && t.assigneeId === k.id && !(t.rrule && t.due && t.due > today));
  const seen = new Set<number>();
  const sleeps = occs
    .filter((o) => o.fun && o.memberIds.includes(k.id) && occDate(o) > today)
    .filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)))
    .slice(0, 3);

  return (
    <div className={`stack kid-space${night ? ' night' : ''}`}>
      <div className="kid-top">
        <div className="kidpick">
          {kids.map((m) => (
            <Link key={m.id} to={`/kid/${m.id}`} className="kidbtn" aria-current={m.id === k.id} style={pc(m.color)}>
              <Avatar m={m} />{m.name}
            </Link>
          ))}
        </div>
        <GrownUpsNote />
        <GrownUpsExit />
      </div>
      <div className="kid" style={pc(color)}>
        <div className="col">
          <section className="now-card">
            <span className="tagbig"><i className="now-dot" aria-hidden="true" />Right now</span>
            {cur ? (
              <>
                <div className="row"><span className="big" aria-hidden="true">{cur.icon}</span><div className="word">{cur.kidTitle ?? cur.title}</div></div>
                <div className="face-clock"><ClockFace min={minutesOf(cur.end)} color={color} /><span>Finishes when the clock looks like this</span></div>
              </>
            ) : (
              <div className="row"><span className="big" aria-hidden="true">{late ? '😴' : '🎈'}</span><div className="word">{late ? 'Sleepy time' : 'Free time!'}</div></div>
            )}
          </section>
          {next && (
            <section className="now-card next">
              <span className="tagbig"><span aria-hidden="true">🔜</span> Next</span>
              <div className="row">
                <span className="big" aria-hidden="true">{next.icon}</span>
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
              <div className="tagbig" style={{ marginBottom: 8 }}><span aria-hidden="true">🕓</span> Later today</div>
              <div className="pics">
                {later.map((o) => (
                  <div key={o.key} className="pic"><span className="tag">{fmtTime(minutesOf(o.start)).replace(':00', '')}</span><span className="e" aria-hidden="true">{o.icon}</span>{o.kidTitle ?? o.title}</div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="col">
          {myChores.length > 0 && (
            <section className="panel"><h2><span aria-hidden="true">⭐</span> My jobs</h2><div className="tiles">{myChores.map((c) => <ChoreTile key={c.id} c={c} all={chores} />)}</div></section>
          )}
          {myPrep.length > 0 && (
            <section className="panel"><h2><span aria-hidden="true">🎒</span> Get ready</h2><PrepTiles items={myPrep} /></section>
          )}
          {myTodos.length > 0 && (
            <section className="panel">
              <h2><span aria-hidden="true">✅</span> Things to do</h2>
              <div className="tiles">
                {myTodos.map((t) => (
                  <button key={t.id} className={`tile ${t.doneAt ? 'is-done' : ''}`} aria-pressed={!!t.doneAt} onClick={(e) => toggleTodo(t, e.currentTarget)}>
                    <span className="e" aria-hidden="true">{t.icon}</span>{t.text}{t.due && <span className="note">{dayLabel(today, t.due)}</span>}
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
                        <span className="e" aria-hidden="true">{t.icon}</span>{t.text}
                        {n > 0 ? <Sleeps n={n} max={10} /> : <span className="note"><span aria-hidden="true">☀️</span> Today!</span>}
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
                <span className="e" aria-hidden="true">{o.icon}</span>
                <div>
                  <b>{o.kidTitle ?? o.title}</b>
                  <Sleeps n={n} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
