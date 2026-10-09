import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  addDays, computeFlags, dayDiff, dayLabel, fmtDur, fmtShortDate, fmtTime, minutesOf, weatherLook, type Occurrence, type Plan,
} from '@shared';
import { api } from '../api.ts';
import { namesOf, useAction, useFamily, useNow } from '../context.tsx';
import { WeatherNow } from '../hub.tsx';
import { dueLabel, endAbs, leaveBy, mainRange, money, occDate, sleepsWord, startAbs, relDay } from '../lib.ts';
import { useBills, useCalendars, useChores, useOccurrences, usePlans, usePrep, useTodos, useWeather } from '../queries.ts';
import { EventSheet } from '../sheets/EventSheet.tsx';
import { PlanSheet } from '../sheets/PlanSheet.tsx';
import { QuickAdd } from '../sheets/QuickAdd.tsx';
import { PrepList } from '../todos.tsx';
import { Avatar, Face, pc, useSheets } from '../ui.tsx';
import { ChoreTile } from './Person.tsx';

const WINDOW_MIN = 6 * 60;

interface Alert {
  cls: '' | 'warn' | 'bad';
  icon: string;
  title: string;
  /** What it's about, one line each; the first shows, the rest open with "+N more". */
  items: string[];
  action?: { label: string; run: () => void };
  link?: string;
}

/** A heads-up's headline, its first item, and the rest one tap away (instead of a run-on line). */
function AlertItems({ a }: { a: Alert }) {
  const [open, setOpen] = useState(false);
  const [first, ...rest] = a.items;
  return (
    <div className="alert-text">
      <b>{a.title}</b>
      {open ? <ul>{a.items.map((t) => <li key={t}>{t}</li>)}</ul> : <span>{first}</span>}
      {rest.length > 0 && (
        <button className="link-btn" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Show less' : `+${rest.length} more`}</button>
      )}
    </div>
  );
}

export function Today() {
  const f = useFamily();
  const sheets = useSheets();
  const act = useAction();
  const { now, today, nowMin } = useNow();
  const range = mainRange(today);
  const { data: occs = [] } = useOccurrences(range.from, range.to);
  const { data: plans = [] } = usePlans();
  const { data: chores = [] } = useChores(today);
  const { data: bills = [] } = useBills();
  const { data: calendars = [] } = useCalendars();
  const { data: todos = [] } = useTodos();
  const { data: prep = [] } = usePrep(today, addDays(today, 2), nowMin);
  const { data: weather } = useWeather();
  const flags = computeFlags(occs, f.members);
  // Person color first; an unassigned event from a subscribed calendar takes the calendar's color.
  const colorOf = (o: Occurrence) => f.byId(o.memberIds[0])?.color ?? calendars.find((c) => c.id === o.calendarId)?.color;
  const openOcc = (o: Occurrence) => sheets.open(<EventSheet occ={o} />);
  const openPlan = (p: Plan) => sheets.open(<PlanSheet planId={p.id} />);

  /* ---- what's next: everything (except work) overlapping the next 6 hours ---- */
  const upcoming = occs.filter((o) => !o.allDay && o.category !== 'work' && endAbs(today, o) > nowMin && startAbs(today, o) < nowMin + WINDOW_MIN);
  const allDayToday = occs.filter((o) => o.allDay && occDate(o) === today);
  const after = occs.find((o) => !o.allDay && o.category !== 'work' && startAbs(today, o) >= nowMin + WINDOW_MIN);

  /* ---- heads-up strip ---- */
  const alerts: Alert[] = [];
  for (const o of occs) {
    if (occDate(o) !== today || !o.travelMin || !o.driverId) continue;
    const mins = leaveBy(o) - nowMin;
    if (mins > -5 && mins <= 90) {
      alerts.push({
        cls: mins <= 15 ? 'bad' : 'warn', icon: '🚗',
        title: `Leave ${mins <= 0 ? 'now' : `in ${fmtDur(mins)}`} for ${o.title}`,
        items: [`${f.byId(o.driverId)?.name} is driving ${namesOf(f, o.memberIds)} · leave by ${fmtTime(leaveBy(o))}`],
        action: { label: 'Details', run: () => openOcc(o) },
      });
    }
  }
  const rides = occs.filter((o) => o.needsDriver && !o.driverId && startAbs(today, o) > nowMin && dayDiff(today, occDate(o)) <= 2);
  if (rides.length) {
    alerts.push({
      cls: 'warn', icon: '🚦', title: `${rides.length} ride${rides.length > 1 ? 's' : ''} still need a driver`,
      items: rides.map((r) => `${r.title} · ${dayLabel(today, occDate(r))} ${fmtTime(minutesOf(r.start))} (${namesOf(f, r.memberIds)})`),
      action: { label: 'Pick a driver', run: () => openOcc(rides[0]) },
    });
  }
  const dueSoon = [
    ...plans.flatMap((p) => p.tasks.filter((t) => !t.doneAt && dayDiff(today, t.due) <= 2).map((t) => ({ ...t, plan: p as Plan | null }))),
    ...todos.filter((t) => t.kind === 'todo' && !t.doneAt && t.due && dayDiff(today, t.due) <= 2).map((t) => ({ ...t, due: t.due!, plan: null })),
  ].sort((a, b) => (a.due < b.due ? -1 : 1));
  if (dueSoon.length) {
    const firstPlan = dueSoon.find((t) => t.plan)?.plan;
    const firstPerson = dueSoon.find((t) => !t.plan && t.assigneeId)?.assigneeId;
    alerts.push({
      cls: dueSoon.some((t) => t.due < today) ? 'bad' : '', icon: '✅', title: `${dueSoon.length} task${dueSoon.length > 1 ? 's' : ''} due soon`,
      items: dueSoon.map((t) => `${t.text} · ${f.byId(t.assigneeId)?.name ?? 'Anyone'} · ${dueLabel(today, t.due)}`),
      action: firstPlan ? { label: 'Open the plan', run: () => openPlan(firstPlan) } : undefined,
      link: !firstPlan && firstPerson ? `/person/${firstPerson}` : undefined,
    });
  }
  for (const b of bills) {
    if (b.paidAt || b.autopay || dayDiff(today, b.due) > 3) continue;
    const d = dayDiff(today, b.due);
    alerts.push({
      cls: d < 0 ? 'bad' : '', icon: '💵', title: `${b.name} bill ${d < 0 ? 'overdue' : `due ${relDay(today, b.due)}`}`, items: [money(b.amountCents)],
      action: f.canEdit || f.session.kind === 'hub' ? { label: 'Mark paid', run: () => act(() => api(`/bills/${b.id}/pay`, { method: 'POST' }), `${b.name} marked paid`) } : undefined,
    });
  }
  // Rain worth mentioning: today until the afternoon's over, then tomorrow (with the packing).
  const wxDay = weather?.days.find((d) => d.date === (nowMin < 17 * 60 ? today : addDays(today, 1)));
  if (wxDay && wxDay.rainChance >= 60) {
    const look = weatherLook(wxDay.code);
    alerts.push({
      cls: '', icon: '☔', title: `Umbrella ${wxDay.date === today ? 'day' : 'tomorrow'}`,
      items: [`${look.text}, ${wxDay.rainChance}% chance of rain, high of ${wxDay.hi}°. Grab raincoats on the way out.`],
    });
  }
  const pack = prep.filter((p) => !p.done && p.date === addDays(today, 1));
  if (pack.length) {
    alerts.push({
      cls: '', icon: '🎒', title: 'Pack for tomorrow',
      items: pack.map((p) => `${p.text}${p.memberIds.length ? ` (${namesOf(f, p.memberIds)})` : ''}`),
    });
  }

  /* ---- people, plans, countdowns ---- */
  const openCount = (id: number) =>
    chores.filter((c) => c.assigneeId === id && c.scheduled && !c.done).length +
    plans.reduce((n, p) => n + p.tasks.filter((t) => t.assigneeId === id && !t.doneAt && dayDiff(today, t.due) <= 2).length, 0) +
    todos.filter((t) => t.kind === 'todo' && t.assigneeId === id && !t.doneAt && t.due && dayDiff(today, t.due) <= 2).length +
    prep.filter((p) => p.memberIds.includes(id) && !p.done).length;
  const kidsWithJobs = f.members.filter((m) => m.role === 'kid' && chores.some((c) => c.assigneeId === m.id && c.scheduled));
  const activePlans = plans.filter((p) => p.start.slice(0, 10) >= today);
  const seen = new Set<number>();
  const countdowns = occs
    .filter((o) => o.fun && occDate(o) > today)
    .filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)))
    .slice(0, 4);

  const h = now.getHours();
  return (
    <>
      <section className="hero">
        <div className="clock num">{h % 12 || 12}<span className="colon">:</span>{String(now.getMinutes()).padStart(2, '0')}<small>{h >= 12 ? 'PM' : 'AM'}</small></div>
        <div className="row" style={{ gap: '12px 28px' }}>
          <div>
            <div className="dateline">{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
            <Link to="/tomorrow" className="link-btn">Tomorrow →</Link>
          </div>
          <WeatherNow />
        </div>
        <nav className="members" aria-label="Family members">
          {f.members.map((m) => (
            <Link key={m.id} to={`/person/${m.id}`} className="mem-btn" style={pc(m.color)}
              aria-label={`${m.name}${openCount(m.id) ? `, ${openCount(m.id)} still to do` : ''}`} title={openCount(m.id) ? `${openCount(m.id)} jobs, to-dos and things to pack still open` : undefined}>
              <Avatar m={m} badge={openCount(m.id)} />{m.name}
            </Link>
          ))}
        </nav>
      </section>

      {alerts.length > 0 && (
        <div className="heads" aria-label="Heads up">
          {alerts.map((a) => (
            <div key={a.title} className={`alert ${a.cls}`}>
              <span className="ic" aria-hidden="true">{a.icon}</span>
              <AlertItems a={a} />
              {a.action && <button className="act" onClick={a.action.run}>{a.action.label}</button>}
              {a.link && <Link className="act" to={a.link} style={{ textDecoration: 'none' }}>See to-dos</Link>}
            </div>
          ))}
        </div>
      )}

      <div className="today-main">
        <section className="panel">
          <div className="panel-head">
            <h2>Next 6 hours</h2>
            <span className="note num">{fmtTime(nowMin)} – {fmtTime(nowMin + WINDOW_MIN)}</span>
          </div>
          {allDayToday.length > 0 && (
            <div className="allday">
              {allDayToday.map((o) => (
                <button key={o.key} className="tog" style={pc(colorOf(o))} aria-pressed="true" onClick={() => openOcc(o)}>
                  <span className="face" style={{ margin: 0 }}>{o.icon}</span>{o.title} · all day
                </button>
              ))}
            </div>
          )}
          {upcoming.length ? (
            <div className="timeline">
              {upcoming.map((o) => {
                const s = startAbs(today, o);
                const isNow = s <= nowMin;
                const fl = flags.get(o.key) ?? [];
                const t = fmtTime(minutesOf(o.start));
                return (
                  <button key={o.key} className={`tl ${isNow ? 'is-now' : ''} ${o.memberIds.length === 1 ? 'solo' : ''}`} style={pc(colorOf(o))} onClick={() => openOcc(o)}>
                    <div className="tl-time num">
                      <b>{t.slice(0, -3)}</b>
                      <span>{t.slice(-2)}{occDate(o) !== today ? ' · tmrw' : ''}</span>
                      <small>{isNow ? 'Now' : `in ${fmtDur(s - nowMin)}`}</small>
                    </div>
                    <div className="tl-dot" aria-hidden="true" />
                    <div className="tl-card">
                      <span className="e" aria-hidden="true">{o.icon}</span>
                      <div className="tl-main">
                        <b>{o.title}</b>
                        <div className="note">
                          {isNow ? `Until ${fmtTime(minutesOf(o.end))}` : `${t} – ${fmtTime(minutesOf(o.end))}`}
                          {o.location && ` · 📍 ${o.location}`}
                        </div>
                        <div className="row" style={{ gap: 6 }}>
                          {o.driverId && <span className="pill good">🚗 {f.byId(o.driverId)?.name} driving · leave {fmtTime(leaveBy(o))}</span>}
                          {fl.map((x) => <span key={x.text} className={`pill ${x.kind}`}>{x.kind === 'bad' ? '⚠' : '🚗'} {x.text}</span>)}
                        </div>
                      </div>
                      <span className="faces">{o.memberIds.map((id) => <Face key={id} m={f.byId(id)} />)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="empty">
              Nothing in the next 6 hours.
              {after && <> Next up: {after.icon} {after.title}, {relDay(today, occDate(after))} at {fmtTime(minutesOf(after.start))}.</>}
            </div>
          )}
        </section>

        <div className="side">
          {kidsWithJobs.length > 0 && (
            <section className="panel" aria-label="Chore chart">
              <div className="panel-head"><h2>Today’s jobs</h2><span className="label">Tap when it’s done</span></div>
              {kidsWithJobs.map((k) => {
                const mine = chores.filter((c) => c.assigneeId === k.id && c.scheduled);
                const done = mine.filter((c) => c.done).length;
                return (
                  <div key={k.id} className="chart-row" style={pc(k.color)}>
                    <div className="who">
                      <Avatar m={k} />{k.name}
                      <span className="stars">{done === mine.length ? '⭐ All done!' : `${done} of ${mine.length}`}</span>
                    </div>
                    <div className="tiles">{mine.map((c) => <ChoreTile key={c.id} c={c} all={chores} />)}</div>
                  </div>
                );
              })}
            </section>
          )}
          {prep.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <h2>Get ready</h2>
                <button className="mini-btn" onClick={() => sheets.open(<QuickAdd mode="todo" />)}>+ Add</button>
              </div>
              <PrepList items={prep} />
            </section>
          )}
          <section className="panel">
            <div className="panel-head">
              <h2>Plans</h2>
              <button className="mini-btn" onClick={() => sheets.open(<QuickAdd mode="plan" />)}>+ New plan</button>
            </div>
            {activePlans.length ? activePlans.map((p) => <PlanCard key={p.id} plan={p} onOpen={() => openPlan(p)} />) : (
              <p className="note">Break a big event into tasks, like hosting a holiday or a birthday party.</p>
            )}
          </section>
          {countdowns.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h2>Coming up</h2><span className="label">Sleeps to go</span></div>
              <div>
                {countdowns.map((o) => {
                  const n = dayDiff(today, occDate(o));
                  return (
                    <button key={o.key} className="count" onClick={() => openOcc(o)}>
                      <span className="e" aria-hidden="true">{o.icon}</span>
                      <div><b>{o.title}</b><div className="note">{dayLabel(today, occDate(o))}{n >= 7 ? '' : `, ${fmtShortDate(occDate(o))}`}</div></div>
                      <div className="n num">{n}<small>{sleepsWord(n)}</small></div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

export function PlanCard({ plan, onOpen }: { plan: Plan; onOpen: () => void }) {
  const f = useFamily();
  const { today } = useNow();
  const done = plan.tasks.filter((t) => t.doneAt).length;
  const next = plan.tasks.filter((t) => !t.doneAt).sort((a, b) => (a.due < b.due ? -1 : 1)).slice(0, 3);
  const day = plan.start.slice(0, 10);
  return (
    <button className="proj" onClick={onOpen}>
      <div className="proj-top">
        <span className="e" aria-hidden="true">{plan.icon}</span>
        <div>
          <b>{plan.title}</b>
          <div className="note">{dayLabel(today, day)}{dayDiff(today, day) >= 7 ? '' : `, ${fmtShortDate(day)}`} · {done} of {plan.tasks.length} done</div>
        </div>
      </div>
      <div className="bar"><i style={{ width: `${plan.tasks.length ? (done / plan.tasks.length) * 100 : 0}%` }} /></div>
      {next.map((t) => (
        <div key={t.id} className="proj-next">
          {f.byId(t.assigneeId) ? <Face m={f.byId(t.assigneeId)} /> : <span className="face" style={pc(undefined)}>?</span>}
          {t.text}
          <span className={`note ${t.due < today ? 'late' : ''}`}>{dueLabel(today, t.due)}</span>
        </div>
      ))}
    </button>
  );
}
