import { useState } from 'react';
import {
  addDays, addMinutes, CATEGORIES, dayLabel, describeRRule, EVENT_ICONS, fmtTime, guessEventStyle, minutesOf, parseRRule, presetToRRule,
  REMINDER_CHOICES, REPEAT_PRESETS, rruleToPreset, weekdayMon, type Category, type EventRecord, type RepeatPreset,
} from '@shared';
import { api } from '../api.ts';
import { useAction, useFamily, useNow } from '../context.tsx';
import { useFeed } from '../queries.ts';
import { Face, pc, Sheet, useSheets } from '../ui.tsx';

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export type EventDraft = Partial<Omit<EventRecord, 'id' | 'calendarId' | 'planId'>>;

/**
 * Create or edit an event (for a repeating event, this edits every occurrence). For an event from
 * a subscribed calendar only the family's own details can change; the rest is shown read-only.
 */
export function EventForm({ event, draft = {} }: { event?: EventRecord; draft?: EventDraft }) {
  const f = useFamily();
  const sheets = useSheets();
  const act = useAction();
  const { today } = useNow();
  const init: EventDraft = event ?? draft;
  const feed = useFeed(event?.calendarId);

  const startInit = init.start ?? `${today}T16:00`;
  const [title, setTitle] = useState(init.title ?? '');
  const [icon, setIcon] = useState(init.icon ?? '📅');
  const [iconTouched, setIconTouched] = useState(!!event || !!init.icon);
  const [category, setCategory] = useState<Category>(init.category ?? 'family');
  const [date, setDate] = useState(startInit.slice(0, 10));
  const [startTime, setStartTime] = useState(startInit.slice(11, 16));
  const [endTime, setEndTime] = useState((init.end ?? addMinutes(startInit, 60)).slice(11, 16));
  const [allDay, setAllDay] = useState(init.allDay ?? false);
  const rep = rruleToPreset(init.rrule ?? null);
  const [preset, setPreset] = useState<RepeatPreset>(rep.preset);
  const [weekdays, setWeekdays] = useState<number[]>(rep.weekdays);
  const [until, setUntil] = useState(init.rrule ? (parseRRule(init.rrule).until ?? '') : '');
  const [memberIds, setMemberIds] = useState<number[]>(init.memberIds ?? []);
  const [driverId, setDriverId] = useState<number | null>(init.driverId ?? null);
  const [needsDriver, setNeedsDriver] = useState(init.needsDriver ?? false);
  const [travelMin, setTravelMin] = useState(String(init.travelMin ?? 0));
  const [location, setLocation] = useState(init.location ?? '');
  const [bring, setBring] = useState(init.bring ?? '');
  const [notes, setNotes] = useState(init.notes ?? '');
  const [kidTitle, setKidTitle] = useState(init.kidTitle ?? '');
  const [fun, setFun] = useState(init.fun ?? false);
  const [reminders, setReminders] = useState<number[]>(init.reminders ?? []);
  const [busy, setBusy] = useState(false);

  const adults = f.members.filter((m) => m.role === 'adult');
  const hasKids = memberIds.some((id) => f.byId(id)?.role === 'kid');
  const weekly = preset === 'weekly' || preset === 'biweekly';
  const days = weekly && !weekdays.length ? [weekdayMon(date)] : weekdays;

  const onTitle = (t: string) => {
    setTitle(t);
    if (!iconTouched) {
      const g = guessEventStyle(t);
      setIcon(g.icon);
      setCategory(g.category);
    }
  };
  const toggle = (list: number[], id: number) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const save = async () => {
    setBusy(true);
    let rrule = presetToRRule(preset, days);
    if (rrule && until) rrule += `;UNTIL=${until.replaceAll('-', '')}`;
    const start = allDay ? `${date}T00:00` : `${date}T${startTime}`;
    let end = allDay ? `${addDays(date, 1)}T00:00` : `${date}T${endTime}`;
    if (!allDay && end <= start) end = endTime === startTime ? addMinutes(start, 60) : `${addDays(date, 1)}T${endTime}`;
    const family = {
      icon, category, memberIds, driverId, needsDriver: needsDriver && !driverId, travelMin: Math.max(0, Number.parseInt(travelMin, 10) || 0),
      bring: bring.trim() || null, kidTitle: kidTitle.trim() || null, fun, reminders,
    };
    const body = feed ? family : {
      ...family, title: title.trim(), start, end, allDay, rrule, location: location.trim() || null, notes: notes.trim() || null,
    };
    const ok = await act(
      () => (event ? api(`/events/${event.id}`, { method: 'PATCH', body }) : api('/events', { method: 'POST', body })),
      event ? `Saved ${title.trim()}` : `Added ${title.trim()}`,
    );
    setBusy(false);
    if (ok) sheets.close();
  };

  return (
    <Sheet title={feed ? title : event ? 'Edit event' : 'New event'} icon={icon} sub={event?.rrule ? 'Changes apply to every time it repeats.' : undefined} wide>
      <form className="form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {feed && event ? (
          <>
            <p className="note" style={{ margin: 0 }}>
              <span className="cal-dot" style={{ background: feed.color, display: 'inline-block', width: 10, height: 10, marginRight: 6 }} />
              The name, time and place come from <b>{feed.name}</b> and update on their own. Everything below is yours to set.
            </p>
            <dl className="details">
              <dt>When</dt>
              <dd>
                {/* A repeating event's start is its first-ever date, so show just the time. */}
                {event.rrule ? '' : `${dayLabel(today, event.start.slice(0, 10))}, `}
                {event.allDay ? 'all day' : `${fmtTime(minutesOf(event.start))} – ${fmtTime(minutesOf(event.end))}`}
              </dd>
              {event.rrule && <><dt>Repeats</dt><dd>{describeRRule(event.rrule)}</dd></>}
              {event.location && <><dt>Where</dt><dd>📍 {event.location}</dd></>}
            </dl>
          </>
        ) : (
          <label className="field">What
            <input id="ef-title" value={title} onChange={(e) => onTitle(e.target.value)} required maxLength={120} placeholder="Soccer practice" autoFocus />
          </label>
        )}

        <div className="field">Who’s going?
          <div className="toggles">
            {f.members.map((m) => (
              <button type="button" key={m.id} className="tog" style={pc(m.color)} aria-pressed={memberIds.includes(m.id)} onClick={() => setMemberIds(toggle(memberIds, m.id))}>
                <Face m={m} />{m.name}
              </button>
            ))}
          </div>
        </div>

        {!feed && <>
        <div className="form-grid">
          <label className="field">Day<input id="ef-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
          {!allDay && <label className="field">Starts<input id="ef-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required /></label>}
          {!allDay && <label className="field">Ends<input id="ef-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required /></label>}
          <label className="checkline" style={{ alignSelf: 'end', paddingBottom: 10 }}>
            <input id="ef-allday" type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />All day
          </label>
        </div>

        <div className="form-grid">
          <label className="field">Repeats
            <select id="ef-repeat" value={preset} onChange={(e) => setPreset(e.target.value as RepeatPreset)}>
              {REPEAT_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          {preset !== 'none' && <label className="field">Until (optional)<input id="ef-until" type="date" value={until} min={date} onChange={(e) => setUntil(e.target.value)} /></label>}
        </div>
        {weekly && (
          <div className="toggles" aria-label="Repeat on">
            {DAY_SHORT.map((d, i) => (
              <button type="button" key={d} className="tog plain" aria-pressed={days.includes(i)} onClick={() => setWeekdays(toggle(days, i).sort())}>{d}</button>
            ))}
          </div>
        )}
        </>}

        <div className="form-grid">
          {!feed && <label className="field">Where<input id="ef-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Riverside Park, field 3" /></label>}
          <label className="field">Drive time (minutes)<input id="ef-travel" type="number" min={0} max={600} value={travelMin} onChange={(e) => setTravelMin(e.target.value)} /></label>
        </div>

        <div className="field">Who’s driving?
          <div className="toggles">
            {adults.map((m) => (
              <button type="button" key={m.id} className="tog" style={pc(m.color)} aria-pressed={driverId === m.id} onClick={() => setDriverId(driverId === m.id ? null : m.id)}>
                <Face m={m} />{m.name}
              </button>
            ))}
            {!driverId && (
              <label className="checkline"><input type="checkbox" checked={needsDriver} onChange={(e) => setNeedsDriver(e.target.checked)} />Needs a ride (not decided yet)</label>
            )}
          </div>
        </div>

        <div className="field">Remind parents
          <div className="toggles">
            {REMINDER_CHOICES.map((c) => (
              <button type="button" key={c.min} className="tog plain" aria-pressed={reminders.includes(c.min)}
                onClick={() => setReminders(reminders.includes(c.min) ? reminders.filter((x) => x !== c.min) : [...reminders, c.min].sort((a, b) => a - b))}>
                ⏰ {c.label}
              </button>
            ))}
          </div>
        </div>
        <label className="field">What to bring<input id="ef-bring" value={bring} onChange={(e) => setBring(e.target.value)} placeholder="Cleats and a water bottle" /></label>
        {hasKids && <label className="field">Short name for kid mode<input id="ef-kid" value={kidTitle} onChange={(e) => setKidTitle(e.target.value)} maxLength={40} placeholder="Soccer" /></label>}
        {!feed && <label className="field">Notes<textarea id="ef-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>}

        <div className="form-grid">
          <label className="field">Type
            <select id="ef-cat" value={category} onChange={(e) => { setCategory(e.target.value as Category); setIconTouched(true); }}>
              {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
            </select>
          </label>
          <label className="checkline" style={{ alignSelf: 'end', paddingBottom: 10 }}>
            <input id="ef-fun" type="checkbox" checked={fun} onChange={(e) => setFun(e.target.checked)} />Count down the sleeps 🌙
          </label>
        </div>
        <div className="field">Picture
          <div className="emoji-grid">
            {(EVENT_ICONS.includes(icon) ? EVENT_ICONS : [icon, ...EVENT_ICONS]).map((e) => (
              <button type="button" key={e} aria-pressed={icon === e} onClick={() => { setIcon(e); setIconTouched(true); }}>{e}</button>
            ))}
          </div>
        </div>

        <div className="row-end">
          <button type="button" className="icon-btn" onClick={sheets.close}>Cancel</button>
          <button className="primary" disabled={busy || !title.trim()}>{event ? 'Save changes' : 'Add to calendar'}</button>
        </div>
      </form>
    </Sheet>
  );
}
