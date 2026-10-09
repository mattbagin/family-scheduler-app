import { useState } from 'react';
import {
  addDays, computeFlags, dayLabel, describeRRule, fmtShortDate, fmtTime, minutesOf, reminderLabel, type EventRecord, type Occurrence, type Plan,
} from '@shared';
import { api } from '../api.ts';
import { namesOf, useAction, useFamily, useNow } from '../context.tsx';
import { leaveBy, occDate } from '../lib.ts';
import { useFeed, useOccurrences, usePlans } from '../queries.ts';
import { ConfirmButton, Face, pc, Sheet, useSheets } from '../ui.tsx';
import { EventForm } from './EventForm.tsx';
import { PlanSheet } from './PlanSheet.tsx';

/** Set who drives to one occurrence, or (everyTime) to every time a repeating event happens. */
export function useSetDriver() {
  const f = useFamily();
  const act = useAction();
  return (occ: Occurrence, id: number | null, everyTime = false) => {
    const label = id ? `${f.byId(id)?.name}’s driving to ${occ.title}` : 'Driver cleared';
    return occ.rrule && !everyTime
      ? act(() => api(`/events/${occ.id}/occurrences/${occ.originalDate}`, { method: 'PUT', body: { driverId: id } }), label)
      : act(() => api(`/events/${occ.id}`, { method: 'PATCH', body: { driverId: id } }), label);
  };
}

/** Details for one occurrence: who, where, rides, and the plan behind it. */
export function EventSheet({ occ: initial }: { occ: Occurrence }) {
  const f = useFamily();
  const sheets = useSheets();
  const act = useAction();
  const { today } = useNow();
  const day = occDate(initial);
  const { data: dayOccs } = useOccurrences(day, addDays(day, 1));
  const { data: plans } = usePlans();
  const occ = dayOccs?.find((o) => o.key === initial.key) ?? initial;
  const [everyTime, setEveryTime] = useState(false);
  const flags = computeFlags(dayOccs ?? [occ], f.members).get(occ.key) ?? [];
  const plan = plans?.find((p) => p.id === occ.planId);
  const adults = f.members.filter((m) => m.role === 'adult');
  const recurring = !!occ.rrule;
  const feed = useFeed(occ.calendarId);

  const setDriverFor = useSetDriver();
  const setDriver = (id: number | null) => setDriverFor(occ, id, everyTime);
  const openPlan = async () => {
    if (plan) return sheets.replace(<PlanSheet planId={plan.id} />);
    const created = await act(() => api<Plan>('/plans', { method: 'POST', body: { eventId: occ.id } }), 'Plan started. Add the tasks.');
    if (created) sheets.replace(<PlanSheet planId={created.id} />);
  };
  const edit = async () => {
    const series = await act(() => api<EventRecord>(`/events/${occ.id}`));
    if (series) sheets.replace(<EventForm event={series} />);
  };

  const when = occ.allDay
    ? `${dayLabel(today, day)}, ${fmtShortDate(day)} · all day`
    : `${dayLabel(today, day)}, ${fmtShortDate(day)} · ${fmtTime(minutesOf(occ.start))} – ${fmtTime(minutesOf(occ.end))}`;

  return (
    <Sheet title={occ.title} icon={occ.icon} sub={when}>
      {occ.memberIds.length > 0 && (
        <div className="toggles">
          {occ.memberIds.map((id) => {
            const m = f.byId(id);
            return m && <span key={id} className="tog" aria-pressed="true" style={pc(m.color)}><Face m={m} />{m.name}</span>;
          })}
        </div>
      )}
      {feed && (
        <div className="row">
          <span className="pill muted" title="Time, place and name update from this calendar">
            <span className="cal-dot" style={{ background: feed.color, width: 10, height: 10 }} />From {feed.name}
          </span>
        </div>
      )}
      {flags.length > 0 && <div className="row">{flags.map((x) => <span key={x.text} className={`pill ${x.kind}`}>{x.kind === 'bad' ? '⚠' : '🚗'} {x.text}</span>)}</div>}

      <dl className="details">
        {occ.location && <><dt>Where</dt><dd>📍 {occ.location}</dd></>}
        {occ.travelMin > 0 && <><dt>Drive</dt><dd>{occ.travelMin} min · leave by {fmtTime(leaveBy(occ))}</dd></>}
        {occ.bring && <><dt>Bring</dt><dd>🎒 {occ.bring}</dd></>}
        {recurring && <><dt>Repeats</dt><dd>{describeRRule(occ.rrule)}{occ.isException ? ' (changed this time)' : ''}</dd></>}
        {occ.reminders.length > 0 && <><dt>Nudges</dt><dd>⏰ {occ.reminders.map(reminderLabel).join(', ')}</dd></>}
        {occ.notes && <><dt>Notes</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{occ.notes}</dd></>}
      </dl>

      {(occ.needsDriver || occ.driverId || occ.travelMin > 0) && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="label">Who’s driving{occ.memberIds.length ? ` ${namesOf(f, occ.memberIds)}` : ''}?</div>
          <div className="toggles">
            {adults.map((m) => (
              <button key={m.id} className="tog" style={pc(m.color)} aria-pressed={occ.driverId === m.id} onClick={() => setDriver(occ.driverId === m.id ? null : m.id)}>
                <Face m={m} />{m.name}
              </button>
            ))}
          </div>
          {recurring && (
            <label className="checkline note"><input type="checkbox" checked={everyTime} onChange={(e) => setEveryTime(e.target.checked)} />Make this the usual driver every time</label>
          )}
        </div>
      )}

      <button className="proj" onClick={openPlan}>
        <div className="proj-top">
          <span className="e" aria-hidden="true">📋</span>
          <div>
            <b>{plan ? 'Open the plan' : 'Break into tasks'}</b>
            <div className="note">
              {plan ? `${plan.tasks.filter((t) => t.doneAt).length} of ${plan.tasks.length} tasks done` : 'Split it into jobs with a person and a due date for each'}
            </div>
          </div>
        </div>
        {plan && plan.tasks.length > 0 && <div className="bar"><i style={{ width: `${(plan.tasks.filter((t) => t.doneAt).length / plan.tasks.length) * 100}%` }} /></div>}
      </button>

      <div className="row">
        <button className="icon-btn" onClick={edit}>{feed ? '✏️ Who’s going & rides' : `✏️ Edit${recurring ? ' every time' : ''}`}</button>
        {recurring && (
          <button className="icon-btn" onClick={async () => {
            if (await act(() => api(`/events/${occ.id}/occurrences/${occ.originalDate}`, { method: 'PUT', body: { cancelled: true } }), `Skipped ${occ.title} on ${fmtShortDate(day)}`)) sheets.close();
          }}>Skip just this time</button>
        )}
        <span className="spacer" />
        {!feed && <ConfirmButton
          label={recurring ? 'Delete every time' : 'Delete'}
          confirmText={recurring ? `Delete “${occ.title}” and every repeat?` : `Delete “${occ.title}”?`}
          onConfirm={async () => {
            if (await act(() => api(`/events/${occ.id}`, { method: 'DELETE' }), `Deleted ${occ.title}`)) sheets.close();
          }}
        />}
      </div>
    </Sheet>
  );
}
