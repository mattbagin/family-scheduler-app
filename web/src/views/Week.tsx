import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  addDays, computeFlags, dayDiff, fmtShortDate, fmtTime, minutesOf, startOfWeek, weekdayMon, WEEKDAYS, withMinutes, type Occurrence,
} from '@shared';
import { api } from '../api.ts';
import { useAction, useFamily, useNow } from '../context.tsx';
import { occDate } from '../lib.ts';
import { useOccurrences } from '../queries.ts';
import { EventForm } from '../sheets/EventForm.tsx';
import { EventSheet } from '../sheets/EventSheet.tsx';
import { Avatar, pc, useSheets, useToast } from '../ui.tsx';

/** Days across, people down: conflicts and missing drivers stand out at a glance. */
export function Week() {
  const f = useFamily();
  const sheets = useSheets();
  const act = useAction();
  const toast = useToast();
  const { today } = useNow();
  const [offset, setOffset] = useState(0);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const first = addDays(startOfWeek(today), offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(first, i));
  const { data: occs = [], isFetching } = useOccurrences(first, addDays(first, 7));
  const flags = computeFlags(occs, f.members);

  const move = (o: Occurrence, day: string, memberId: number) => {
    setDragKey(null);
    setOver(null);
    const shift = dayDiff(occDate(o), day);
    const changePerson = o.memberIds.length === 1 && o.memberIds[0] !== memberId;
    if (!shift && !changePerson) return;
    const newStart = withMinutes(addDays(occDate(o), shift), minutesOf(o.start));
    const newEnd = withMinutes(addDays(o.end.slice(0, 10), shift), minutesOf(o.end));
    const label = `Moved ${o.title} to ${WEEKDAYS[weekdayMon(day)]}${changePerson ? ` for ${f.byId(memberId)?.name}` : ''}`;
    if (o.rrule) {
      if (changePerson) {
        toast('A repeating event can only move to another day here. Edit it to change who goes.');
        return;
      }
      act(() => api(`/events/${o.id}/occurrences/${o.originalDate}`, { method: 'PUT', body: { start: newStart, end: newEnd } }), label);
    } else {
      act(() => api(`/events/${o.id}`, { method: 'PATCH', body: { start: newStart, end: newEnd, ...(changePerson ? { memberIds: [memberId] } : {}) } }), label);
    }
  };

  return (
    <>
      <div className="week-head">
        <div className="row">
          <button className="icon-btn" onClick={() => setOffset(offset - 1)} aria-label="Previous week">←</button>
          <h2>{fmtShortDate(days[0])} – {fmtShortDate(days[6])}</h2>
          <button className="icon-btn" onClick={() => setOffset(offset + 1)} aria-label="Next week">→</button>
          {offset !== 0 && <button className="icon-btn" onClick={() => setOffset(0)}>This week</button>}
          {isFetching && <span className="note">Updating…</span>}
        </div>
        <div className="legend">
          <span><span className="pill bad">⚠ Overlap</span> kid in two places</span>
          <span><span className="pill warn">🚗 Needs a ride</span> no driver yet</span>
          <span className="hint-pointer">Drag to move · double-click a day to add</span>
          <span className="hint-touch">Tap an event for details · + adds one</span>
        </div>
      </div>
      <div className="scroll">
        <div className="grid">
          <div className="gh corner" />
          {days.map((d) => (
            <div key={d} className={`gh ${d === today ? 'today' : ''}`}>
              {WEEKDAYS[weekdayMon(d)].slice(0, 3)}<span className="d num">{Number(d.slice(8))}</span>
            </div>
          ))}
          {f.members.map((m) => (
            <Fragment key={m.id}>
              <Link to={`/person/${m.id}`} className="rowlab" style={pc(m.color)}><Avatar m={m} />{m.name}</Link>
              {days.map((d) => {
                const cellKey = `${d}:${m.id}`;
                const list = occs.filter((o) => o.memberIds.includes(m.id) && occDate(o) === d);
                return (
                  <div
                    key={d}
                    className={`cell ${d === today ? 'today' : ''} ${over === cellKey ? 'over' : ''}`}
                    style={pc(m.color)}
                    onDragOver={(e) => { if (dragKey) { e.preventDefault(); setOver(cellKey); } }}
                    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const o = occs.find((x) => x.key === dragKey);
                      if (o) move(o, d, m.id);
                    }}
                    onDoubleClick={(e) => { if (e.target === e.currentTarget) sheets.open(<EventForm draft={{ start: `${d}T16:00`, end: `${d}T17:00`, memberIds: [m.id] }} />); }}
                  >
                    {list.map((o) => {
                      const fl = flags.get(o.key) ?? [];
                      const cls = fl.some((x) => x.kind === 'bad') ? 'flag-bad' : fl.length ? 'flag-warn' : '';
                      return (
                        <button
                          key={o.key}
                          className={`ev ${o.category === 'work' ? 'work' : ''} ${cls}`}
                          // Subscribed events keep the feed's times, so they can't be dragged.
                          draggable={o.calendarId === null}
                          onDragStart={(e) => { setDragKey(o.key); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', o.key); }}
                          onDragEnd={() => { setDragKey(null); setOver(null); }}
                          onClick={() => sheets.open(<EventSheet occ={o} />)}
                        >
                          <span className="tm num">{o.allDay ? 'All day' : fmtTime(minutesOf(o.start))}</span>
                          <b>{o.icon} {o.title}</b>
                          {fl.map((x) => <span key={x.text} className={`pill ${x.kind}`}>{x.kind === 'bad' ? '⚠' : '🚗'} {x.text}</span>)}
                        </button>
                      );
                    })}
                    <button className="cell-add" onClick={() => sheets.open(<EventForm draft={{ start: `${d}T16:00`, end: `${d}T17:00`, memberIds: [m.id] }} />)} aria-label={`Add for ${m.name} on ${WEEKDAYS[weekdayMon(d)]}`}>+ Add</button>
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
      <p className="note">On a touch screen, tap an event and use Edit to move it.</p>
    </>
  );
}

