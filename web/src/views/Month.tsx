import { useState } from 'react';
import {
  addDays, addMonths, dayLabel, fmtTime, minutesOf, parseYmd, startOfWeek, WEEKDAYS, weekdayMon, type Occurrence, type Ymd,
} from '@shared';
import { useFamily, useNow } from '../context.tsx';
import { occDate } from '../lib.ts';
import { useCalendars, useOccurrences } from '../queries.ts';
import { EventForm } from '../sheets/EventForm.tsx';
import { EventSheet } from '../sheets/EventSheet.tsx';
import { Face, pc, Sheet, useSheets } from '../ui.tsx';

/** Timed events belong to the day they start; all-day ones to every day they cover. */
const onDay = (o: Occurrence, d: Ymd) => (o.allDay ? o.start.slice(0, 10) <= d && d < o.end.slice(0, 10) : occDate(o) === d);
const byTime = (a: Occurrence, b: Occurrence) => (a.allDay !== b.allDay ? (a.allDay ? -1 : 1) : a.start < b.start ? -1 : 1);
const monthName = (d: Ymd) => parseYmd(d).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const longDay = (d: Ymd) => parseYmd(d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

/** The month at a glance: a colored dot for each person busy that day. Tap a day for its agenda. */
export function Month() {
  const f = useFamily();
  const sheets = useSheets();
  const { today } = useNow();
  const [offset, setOffset] = useState(0);
  const first = addMonths(`${today.slice(0, 8)}01`, offset);
  const gridStart = startOfWeek(first);
  const last = addDays(addMonths(first, 1), -1);
  const weeks = Math.ceil((weekdayMon(first) + Number(last.slice(8))) / 7);
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i));
  const { data: occs = [], isFetching } = useOccurrences(gridStart, days[days.length - 1]);
  const { data: calendars = [] } = useCalendars();
  const calColor = (o: Occurrence) => calendars.find((c) => c.id === o.calendarId)?.color;

  return (
    <>
      <div className="week-head">
        <div className="row">
          <button className="icon-btn" onClick={() => setOffset(offset - 1)} aria-label="Previous month">←</button>
          <h2 aria-live="polite">{monthName(first)}</h2>
          <button className="icon-btn" onClick={() => setOffset(offset + 1)} aria-label="Next month">→</button>
          {offset !== 0 && <button className="icon-btn" onClick={() => setOffset(0)}>This month</button>}
          {isFetching && <span className="note">Updating…</span>}
        </div>
        <div className="legend">
          {f.members.map((m) => <span key={m.id} className="row" style={{ gap: 6 }}><i className="dot" style={pc(m.color)} />{m.name}</span>)}
        </div>
      </div>
      <div className="month">
        <div className="month-row" aria-hidden="true">
          {WEEKDAYS.map((w) => <div key={w} className="mh">{w.slice(0, 3)}</div>)}
        </div>
        {Array.from({ length: weeks }, (_, w) => (
          <div key={w} className="month-row">
            {days.slice(w * 7, w * 7 + 7).map((d) => {
              const list = occs.filter((o) => onDay(o, d)).sort(byTime);
              const shown = list.filter((o) => o.category !== 'work');
              const people = f.members.filter((m) => shown.some((o) => o.memberIds.includes(m.id) || o.driverId === m.id));
              const feedOnly = [...new Set(shown.filter((o) => !o.memberIds.length).map(calColor).filter(Boolean))];
              const label = `${longDay(d)}: ${shown.length ? `${shown.length} thing${shown.length === 1 ? '' : 's'}${people.length ? ` for ${people.map((m) => m.name).join(', ')}` : ''}` : 'nothing planned'}`;
              return (
                <div key={d} className={`mday ${d.slice(0, 7) !== first.slice(0, 7) ? 'out' : ''} ${d === today ? 'today' : ''} ${d < today ? 'past' : ''}`}>
                  <button className="mday-btn" onClick={() => sheets.open(<DaySheet day={d} />)} aria-label={label}>
                    <span className="mnum num">{Number(d.slice(8))}</span>
                    <span className="micons" aria-hidden="true">{[...new Set(shown.map((o) => o.icon))].slice(0, 3).join('')}</span>
                    <span className="mdots" aria-hidden="true">
                      {people.map((m) => <i key={m.id} className="dot" style={pc(m.color)} />)}
                      {feedOnly.map((c) => <i key={c} className="dot" style={pc(c)} />)}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

/** One day's agenda: tap an event for its details, or add something. */
function DaySheet({ day }: { day: Ymd }) {
  const f = useFamily();
  const sheets = useSheets();
  const { today } = useNow();
  const { data: occs = [] } = useOccurrences(day, addDays(day, 1));
  const list = occs.filter((o) => onDay(o, day)).sort(byTime);
  const label = dayLabel(today, day);
  return (
    <Sheet title={longDay(day)} sub={['Today', 'Tomorrow', 'Yesterday'].includes(label) ? label : undefined} icon="📅">
      {list.length ? (
        <div className="agenda">
          {list.map((o) => (
            <button key={o.key} className="agenda-row" style={pc(f.byId(o.memberIds[0])?.color)} onClick={() => sheets.open(<EventSheet occ={o} />)}>
              <span className="num agenda-time">{o.allDay ? 'All day' : fmtTime(minutesOf(o.start))}</span>
              <span className="e" aria-hidden="true">{o.icon}</span>
              <span className="agenda-title">
                <b>{o.title}</b>
                {o.location && <span className="note">📍 {o.location}</span>}
              </span>
              <span className="faces">{o.memberIds.map((id) => <Face key={id} m={f.byId(id)} />)}</span>
            </button>
          ))}
        </div>
      ) : <p className="empty">Nothing planned yet.</p>}
      <div className="row-end">
        <button className="primary" onClick={() => sheets.replace(<EventForm draft={{ start: `${day}T16:00`, end: `${day}T17:00` }} />)}>+ Add to this day</button>
      </div>
    </Sheet>
  );
}
