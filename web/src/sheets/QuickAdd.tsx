import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  addDays, addMinutes, CATEGORIES, dayDiff, dayLabel, describeRRule, EVENT_ICONS, dayWithDate, fmtShortDate, fmtTime, parseQuickAdd, parseRRule, presetToRRule,
  REMINDER_CHOICES, REPEAT_PRESETS, rruleToPreset, WEEKDAYS, weekdayMon, withMinutes, type Category, type Plan, type RepeatPreset, type TodoKind,
} from '@shared';
import { api } from '../api.ts';
import { namesOf, useAction, useFamily, useNow } from '../context.tsx';
import { todoFromText } from '../todos.tsx';
import { Face, pc, Sheet, useSheets } from '../ui.tsx';
import { EventForm, type EventDraft } from './EventForm.tsx';
import { PlanSheet } from './PlanSheet.tsx';

type Mode = 'event' | 'todo' | 'plan';

/** A one-line box that grows to fit what's typed (phones show the whole phrase); Enter adds, like an input. */
function GrowInput({ id, label, value, placeholder, onChange, onEnter }: { id: string; label: string; value: string; placeholder: string; onChange: (v: string) => void; onEnter: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 4}px`; }
  }, [value]);
  return (
    <textarea
      ref={ref} id={id} className="big-input grow" aria-label={label} rows={1} value={value} autoFocus autoComplete="off" placeholder={placeholder}
      onChange={(e) => onChange(e.target.value.replace(/\n/g, ' '))}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } }}
    />
  );
}

export function QuickAdd({ mode: initialMode = 'event' }: { mode?: Mode }) {
  const [mode, setMode] = useState(initialMode);
  // Shared, so text typed as an event can become a to-do without retyping.
  const [text, setText] = useState('');
  return (
    <Sheet title="What’s happening?">
      <div className="seg" role="tablist">
        <button role="tab" aria-selected={mode === 'event'} onClick={() => setMode('event')}>Event</button>
        <button role="tab" aria-selected={mode === 'todo'} onClick={() => setMode('todo')}>To-do or packing</button>
        <button role="tab" aria-selected={mode === 'plan'} onClick={() => setMode('plan')}>Plan with tasks</button>
      </div>
      {mode === 'event' && <EventQuick text={text} setText={setText} toTodo={() => setMode('todo')} />}
      {mode === 'todo' && <TodoQuick text={text} setText={setText} />}
      {mode === 'plan' && <PlanQuick />}
    </Sheet>
  );
}

function Examples({ list, onPick }: { list: string[]; onPick: (x: string) => void }) {
  return <div className="row">{list.map((x) => <button key={x} className="mini-btn" onClick={() => onPick(x)}>{x}</button>)}</div>;
}

function EventQuick({ text, setText, toTodo }: { text: string; setText: (t: string) => void; toTodo: () => void }) {
  const f = useFamily();
  const act = useAction();
  const sheets = useSheets();
  const { today, nowMin } = useNow();
  // Whole minutes, so the parse (and the memo) only change once a minute.
  const minute = Math.floor(nowMin);
  // Choices made on the card win over what was typed, until the text changes.
  const [whoPick, setWhoPick] = useState<number[] | null>(null);
  const [iconPick, setIconPick] = useState<string | null>(null);
  const [catPick, setCatPick] = useState<Category | null>(null);
  // undefined = not picked on the card, so the typed driver ("Dad drives") stands.
  const [driverPick, setDriverPick] = useState<number | null | undefined>(undefined);
  const [reminders, setReminders] = useState<number[]>([]);
  const parsed = useMemo(() => parseQuickAdd(text, f.members, today, { nowMin: minute }), [text, f.members, today, minute]);
  const who = whoPick ?? parsed?.memberIds ?? [];
  const driverId = driverPick !== undefined ? driverPick : parsed?.driverId ?? null;
  const icon = iconPick ?? parsed?.icon ?? '📅';
  const category = catPick ?? parsed?.category ?? 'family';
  const adults = f.members.filter((m) => m.role === 'adult');
  const hasKid = who.some((id) => f.byId(id)?.role === 'kid');
  const kid = f.members.find((m) => m.role === 'kid')?.name ?? 'Emma';
  const examples = [`Swim every Tue and Thu 4-5pm ${kid} at Aquatic Centre`, 'Dentist Oct 12 10am Mom', 'Pizza night Friday 6pm family'];

  const onText = (t: string) => {
    setText(t);
    setWhoPick(null);
    setIconPick(null);
    setCatPick(null);
    setDriverPick(undefined);
  };

  const draft = (): EventDraft | null => {
    if (!parsed) return null;
    const date = parsed.date ?? today;
    const start = parsed.allDay ? `${date}T00:00` : withMinutes(date, parsed.startMin ?? 16 * 60);
    const length = parsed.startMin !== null && parsed.endMin !== null ? parsed.endMin - parsed.startMin : 60;
    return {
      title: parsed.title, icon, category, start, end: parsed.allDay ? `${addDays(date, 1)}T00:00` : addMinutes(start, length),
      allDay: parsed.allDay, memberIds: who, location: parsed.location, bring: parsed.bring, rrule: parsed.rrule, driverId: hasKid ? driverId : null,
      reminders,
    };
  };
  const timed = !!parsed && (parsed.allDay || parsed.startMin !== null);
  const ready = !!parsed && parsed.date !== null && timed && who.length > 0;
  const when = parsed && [
    // A weekday that has already gone by this week rolls on a week: say so, so it's no surprise.
    parsed.date === null ? null
      : dayDiff(today, parsed.date) >= 7 && dayDiff(today, parsed.date) < 14 ? `Next ${WEEKDAYS[weekdayMon(parsed.date)]}, ${fmtShortDate(parsed.date)}`
        : dayWithDate(today, parsed.date),
    parsed.allDay ? 'all day'
      : parsed.startMin === null ? null
        : `${fmtTime(parsed.startMin)}${parsed.endMin !== null ? ` – ${fmtTime(parsed.endMin)}` : ''}`,
  ].filter(Boolean).join(' · ');

  const add = async () => {
    const d = draft();
    if (!ready || !d || !parsed) return;
    const ok = await act(
      () => api('/events', { method: 'POST', body: d }),
      `Added ${parsed.title} · ${when} · ${namesOf(f, who)}${parsed.rrule ? ` · ${describeRRule(parsed.rrule)}` : ''}`,
    );
    if (ok) sheets.close();
  };

  return (
    <>
      <GrowInput id="qa-input" label="What’s happening, when, and who’s going" value={text} placeholder="e.g. Soccer Thursday 5-6pm Emma weekly" onChange={onText} onEnter={add} />
      {!text && <Examples list={examples} onPick={onText} />}
      {parsed && (
        <>
          <dl className="details">
            <dt>What</dt><dd>{icon} <b>{parsed.title}</b></dd>
            <dt>When</dt>
            <dd>
              {when}{' '}
              {parsed.date === null && <span className="pill warn">Add a day</span>}{' '}
              {!timed && <span className="pill warn">Add a time, or “all day”</span>}{' '}
              {parsed.date === today && parsed.startMin !== null && !parsed.allDay && parsed.startMin < minute && <span className="pill warn">That’s earlier today</span>}
            </dd>
            {parsed.rrule && <><dt>Repeats</dt><dd>🔁 {describeRRule(parsed.rrule)}</dd></>}
            {parsed.location && <><dt>Where</dt><dd>📍 {parsed.location}</dd></>}
            {parsed.bring && <><dt>Bring</dt><dd>🎒 {parsed.bring}</dd></>}
          </dl>
          {!timed && (
            <button className="mini-btn" style={{ alignSelf: 'flex-start' }} onClick={toTodo}>No set time? Save it as a to-do instead →</button>
          )}
          <div className="stack" style={{ gap: 8 }}>
            <div className="label">Who’s going?</div>
            <div className="toggles">
              {f.members.map((m) => (
                <button key={m.id} className="tog" style={pc(m.color)} aria-pressed={who.includes(m.id)}
                  onClick={() => setWhoPick(who.includes(m.id) ? who.filter((x) => x !== m.id) : [...who, m.id])}>
                  <Face m={m} />{m.name}
                </button>
              ))}
            </div>
          </div>
          {hasKid && adults.length > 0 && (
            <div className="stack" style={{ gap: 8 }}>
              <div className="label">Who’s driving?</div>
              <div className="toggles">
                {adults.map((m) => (
                  <button key={m.id} className="tog" style={pc(m.color)} aria-pressed={driverId === m.id} onClick={() => setDriverPick(driverId === m.id ? null : m.id)}>
                    <Face m={m} />{m.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="stack" style={{ gap: 8 }}>
            <div className="label">Remind parents</div>
            <div className="toggles">
              {REMINDER_CHOICES.map((c) => (
                <button key={c.min} className="tog plain" aria-pressed={reminders.includes(c.min)}
                  onClick={() => setReminders(reminders.includes(c.min) ? reminders.filter((x) => x !== c.min) : [...reminders, c.min])}>
                  ⏰ {c.label}
                </button>
              ))}
            </div>
          </div>
          {/* Picture and kind are guessed from the words; most of the time there's nothing to change. */}
          <details className="help qa-look">
            <summary>Picture and kind: <span aria-hidden="true">{icon}</span> {CATEGORIES.find((c) => c.id === category)?.label}</summary>
            <div className="stack" style={{ gap: 8 }}>
              <div className="label" id="qa-cat">Kind of event</div>
              <div className="toggles" role="group" aria-labelledby="qa-cat">
                {CATEGORIES.map((c) => (
                  <button key={c.id} className="tog plain" aria-pressed={category === c.id} onClick={() => setCatPick(c.id)}>{c.icon} {c.label}</button>
                ))}
              </div>
            </div>
            <div className="stack" style={{ gap: 8 }}>
              <div className="label">Picture</div>
              <div className="emoji-grid" role="group" aria-label="Picture">
                {[icon, ...EVENT_ICONS.filter((x) => x !== icon)].slice(0, 12).map((e) => (
                  <button key={e} aria-pressed={icon === e} onClick={() => setIconPick(e)}>{e}</button>
                ))}
              </div>
            </div>
          </details>
        </>
      )}
      <div className="row-end">
        <button className="icon-btn" onClick={() => sheets.replace(<EventForm draft={draft() ?? { title: text }} />)}>More options…</button>
        <button className="primary" disabled={!ready} onClick={add}>Add to calendar</button>
      </div>
    </>
  );
}

/** A to-do ("Call the plumber Friday") or something to pack ("Pack gym shoes Thursday Emma"). */
function TodoQuick({ text, setText }: { text: string; setText: (t: string) => void }) {
  const f = useFamily();
  const act = useAction();
  const sheets = useSheets();
  const { today } = useNow();
  const [kindPick, setKindPick] = useState<TodoKind | null>(null);
  const [whoPick, setWhoPick] = useState<number | null | undefined>(undefined);
  const [duePick, setDuePick] = useState<string | null | undefined>(undefined);
  const [rrulePick, setRrulePick] = useState<string | null | undefined>(undefined);
  const base = useMemo(() => todoFromText(text, f.members, today, null), [text, f.members, today]);
  const kind = kindPick ?? base?.kind ?? 'todo';
  const who = whoPick !== undefined ? whoPick : (base?.assigneeId ?? null);
  const due = duePick !== undefined ? duePick : (base?.due ?? (kind === 'prep' ? addDays(today, 1) : null));
  const rrule = rrulePick !== undefined ? rrulePick : (base?.rrule ?? null);
  const kid = f.members.find((m) => m.role === 'kid')?.name ?? 'Emma';
  const ready = !!base && (kind === 'todo' || !!due);

  const onText = (t: string) => {
    setText(t);
    setKindPick(null);
    setWhoPick(undefined);
    setDuePick(undefined);
    setRrulePick(undefined);
  };
  const pickRepeat = (preset: RepeatPreset) => {
    // Weekly keeps the days already chosen (“every Tue and Thu”), or repeats on the due day.
    const days = rrule ? (parseRRule(rrule).byDay ?? []) : [];
    setRrulePick(presetToRRule(preset, days.length ? days : [weekdayMon(due ?? today)]));
  };
  const add = async () => {
    if (!ready || !base) return;
    const body = { kind, text: base.text, assigneeId: who, due, rrule };
    const whose = who ? `${f.byId(who)?.name}’s` : 'the family';
    const ok = await act(() => api('/todos', { method: 'POST', body }), `Added “${base.text}” to ${whose} ${kind === 'prep' ? 'packing list' : 'to-dos'}`);
    if (ok) sheets.close();
  };

  return (
    <>
      <GrowInput id="qa-todo" label="What needs doing" value={text} placeholder="e.g. Call the plumber Friday" onChange={onText} onEnter={add} />
      {!text && <Examples list={['Call the plumber Friday Dad', `Pack gym shoes Thursday ${kid}`, 'Sign the permission slip tomorrow Mom', 'Take the bins out every Monday']} onPick={onText} />}
      {base && (
        <>
          <div className="toggles">
            <button className="tog plain" aria-pressed={kind === 'todo'} onClick={() => setKindPick('todo')}>✅ To-do</button>
            <button className="tog plain" aria-pressed={kind === 'prep'} onClick={() => setKindPick('prep')}>🎒 Pack or get ready</button>
          </div>
          <dl className="details">
            <dt>What</dt><dd><b>{base.text}</b></dd>
            <dt>{kind === 'prep' ? 'Ready by' : 'Due'}</dt>
            <dd className="row" style={{ gap: 8 }}>
              <input type="date" className="inline-select" style={{ width: 'auto' }} value={due ?? ''} min={today} aria-label="Day"
                onChange={(e) => setDuePick(e.target.value || null)} />
              {due ? dayLabel(today, due) : rrule ? 'Starts today' : 'No day (someday)'}
            </dd>
            <dt>Repeats</dt>
            <dd className="row" style={{ gap: 8 }}>
              <select className="inline-select" style={{ width: 'auto' }} value={rruleToPreset(rrule).preset} aria-label="Repeats"
                onChange={(e) => pickRepeat(e.target.value as RepeatPreset)}>
                {REPEAT_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              {rrule && <span><span aria-hidden="true">🔁</span> {describeRRule(rrule)}</span>}
            </dd>
          </dl>
          <div className="stack" style={{ gap: 8 }}>
            <div className="label">Whose is it?</div>
            <div className="toggles">
              {f.members.map((m) => (
                <button key={m.id} className="tog" style={pc(m.color)} aria-pressed={who === m.id} onClick={() => setWhoPick(who === m.id ? null : m.id)}>
                  <Face m={m} />{m.name}
                </button>
              ))}
              <button className="tog plain" aria-pressed={who === null} onClick={() => setWhoPick(null)}>Anyone</button>
            </div>
          </div>
        </>
      )}
      <div className="row-end">
        <button className="primary" disabled={!ready} onClick={add}>{kind === 'prep' ? 'Add to the packing list' : 'Add to-do'}</button>
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
