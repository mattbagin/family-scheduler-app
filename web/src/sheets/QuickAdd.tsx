import { useMemo, useState } from 'react';
import {
  addDays, addMinutes, dayLabel, fmtShortDate, fmtTime, parseQuickAdd, weekdayMon, withMinutes, type Plan,
} from '@shared';
import { api } from '../api.ts';
import { namesOf, useAction, useFamily, useNow } from '../context.tsx';
import { Face, pc, Sheet, useSheets } from '../ui.tsx';
import { EventForm, type EventDraft } from './EventForm.tsx';
import { PlanSheet } from './PlanSheet.tsx';

const DAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

export function QuickAdd({ mode: initialMode = 'event' }: { mode?: 'event' | 'plan' }) {
  const [mode, setMode] = useState(initialMode);
  return (
    <Sheet title="What’s happening?">
      <div className="seg" role="tablist">
        <button role="tab" aria-selected={mode === 'event'} onClick={() => setMode('event')}>Single event</button>
        <button role="tab" aria-selected={mode === 'plan'} onClick={() => setMode('plan')}>Plan with tasks</button>
      </div>
      {mode === 'event' ? <EventQuick /> : <PlanQuick />}
    </Sheet>
  );
}

function EventQuick() {
  const f = useFamily();
  const act = useAction();
  const sheets = useSheets();
  const { today } = useNow();
  const [text, setText] = useState('');
  const [whoOverride, setWhoOverride] = useState<number[] | null>(null);
  const parsed = useMemo(() => parseQuickAdd(text, f.members, today), [text, f.members, today]);
  const who = whoOverride ?? parsed?.memberIds ?? [];
  const firstName = f.members.find((m) => m.role === 'kid')?.name ?? f.members[0]?.name ?? 'Emma';
  const examples = [`Swim Tuesday 4pm ${firstName} weekly at Aquatic Centre`, 'Dentist tomorrow 10am', 'Pizza night Friday 6pm family'];

  const draft = (): EventDraft | null => {
    if (!parsed) return null;
    const date = parsed.date ?? today;
    const start = withMinutes(date, parsed.startMin ?? 16 * 60);
    return {
      title: parsed.title, icon: parsed.icon, category: parsed.category, start, end: addMinutes(start, 60),
      memberIds: who, location: parsed.location,
      rrule: parsed.weekly ? `FREQ=WEEKLY;BYDAY=${DAY_CODES[weekdayMon(date)]}` : null,
    };
  };
  const ready = !!parsed && parsed.date !== null && parsed.startMin !== null && who.length > 0;

  const add = async () => {
    const d = draft();
    if (!ready || !d || !parsed) return;
    const ok = await act(
      () => api('/events', { method: 'POST', body: d }),
      `Added ${parsed.title} · ${dayLabel(today, parsed.date!)} ${fmtTime(parsed.startMin!)} · ${namesOf(f, who)}${parsed.weekly ? ' · weekly' : ''}`,
    );
    if (ok) sheets.close();
  };

  return (
    <>
      <input
        id="qa-input"
        className="big-input"
        value={text}
        autoFocus
        autoComplete="off"
        placeholder="e.g. Soccer Thursday 5pm Emma weekly"
        onChange={(e) => { setText(e.target.value); setWhoOverride(null); }}
        onKeyDown={(e) => e.key === 'Enter' && add()}
      />
      {!text && (
        <div className="row">
          {examples.map((x) => <button key={x} className="mini-btn" onClick={() => setText(x)}>{x}</button>)}
        </div>
      )}
      {parsed && (
        <>
          <dl className="details">
            <dt>What</dt><dd>{parsed.icon} <b>{parsed.title}</b></dd>
            <dt>When</dt>
            <dd>
              {parsed.date === null ? <span className="pill warn">Add a day</span> : `${dayLabel(today, parsed.date)}${addDays(today, 1) < parsed.date ? ` ${fmtShortDate(parsed.date)}` : ''}`}{' '}
              {parsed.startMin === null ? <span className="pill warn">Add a time</span> : `at ${fmtTime(parsed.startMin)}`}
              {parsed.weekly && ' · repeats weekly'}
            </dd>
            {parsed.location && <><dt>Where</dt><dd>📍 {parsed.location}</dd></>}
          </dl>
          <div className="stack" style={{ gap: 8 }}>
            <div className="label">Who’s going?</div>
            <div className="toggles">
              {f.members.map((m) => (
                <button key={m.id} className="tog" style={pc(m.color)} aria-pressed={who.includes(m.id)}
                  onClick={() => setWhoOverride(who.includes(m.id) ? who.filter((x) => x !== m.id) : [...who, m.id])}>
                  <Face m={m} />{m.name}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      <div className="row-end">
        <button className="icon-btn" onClick={() => sheets.replace(<EventForm draft={draft() ?? { title: text }} />)}>More options…</button>
        <button className="primary" disabled={!ready} onClick={add}>Add to calendar</button>
      </div>
    </>
  );
}

function PlanQuick() {
  const act = useAction();
  const sheets = useSheets();
  const { today } = useNow();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(addDays(today, 14));
  const [time, setTime] = useState('15:00');

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const plan = await act(() => api<Plan>('/plans', { method: 'POST', body: { title: title.trim(), start: `${date}T${time}` } }), 'Plan created. Now add the tasks.');
    if (plan) sheets.replace(<PlanSheet planId={plan.id} />);
  };

  return (
    <form className="form" onSubmit={create}>
      <p className="note" style={{ margin: 0 }}>For bigger things like hosting a holiday, a birthday party, or a trip. You’ll split it into tasks, each with a person and a due date.</p>
      <input id="np-title" className="big-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Leo’s birthday party" autoFocus required maxLength={120} />
      <div className="form-grid">
        <label className="field">Day<input id="np-date" type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} required /></label>
        <label className="field">Starts<input id="np-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} required /></label>
      </div>
      <div className="row-end"><button className="primary" disabled={!title.trim()}>Create plan</button></div>
    </form>
  );
}
