import { useState } from 'react';
import { describeRRule, guessTaskIcon, monthlyRules, presetToRRule, rruleToPreset, TASK_ICONS, weekdayMon, type Chore } from '@shared';
import { api } from '../api.ts';
import { useAction, useFamily, useNow } from '../context.tsx';
import { ConfirmButton, Face, pc, Sheet, useSheets } from '../ui.tsx';

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type Repeat = 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly-date' | 'monthly-day' | 'custom';

/** The rule each repeat choice stands for, given the first day and the weekdays picked. */
function rules(start: string, days: number[]): Record<Exclude<Repeat, 'custom'>, string> {
  const monthly = monthlyRules(start);
  return {
    daily: 'FREQ=DAILY',
    weekdays: presetToRRule('weekdays', [])!,
    weekly: presetToRRule('weekly', days)!,
    biweekly: presetToRRule('biweekly', days)!,
    'monthly-date': monthly.byDate,
    'monthly-day': monthly.byWeekday,
  };
}

/** Add a job (memberIds picks who it starts with) or edit one. Jobs always repeat; one-offs are to-dos. */
export function ChoreSheet({ chore, memberIds: initMembers = [] }: { chore?: Chore; memberIds?: number[] }) {
  const f = useFamily();
  const sheets = useSheets();
  const act = useAction();
  const { today } = useNow();
  const [text, setText] = useState(chore?.text ?? '');
  const [icon, setIcon] = useState(chore?.icon ?? '✅');
  const [iconTouched, setIconTouched] = useState(!!chore);
  const [memberIds, setMemberIds] = useState<number[]>(chore?.memberIds ?? initMembers);
  const [start, setStart] = useState(chore?.start ?? today);
  const initDays = rruleToPreset(chore?.rrule ?? null).weekdays;
  const [weekdays, setWeekdays] = useState<number[]>(initDays);
  // A rule the sheet can't make (from an old version, or written by hand) is kept as it is.
  const [repeat, setRepeat] = useState<Repeat>(() => {
    if (!chore) return 'daily';
    if (chore.rrule === 'FREQ=MONTHLY') return 'monthly-date';
    const found = Object.entries(rules(chore.start, initDays)).find(([, r]) => r === chore.rrule);
    return (found?.[0] as Repeat) ?? 'custom';
  });
  const [busy, setBusy] = useState(false);

  const weekly = repeat === 'weekly' || repeat === 'biweekly';
  const days = weekly && !weekdays.length ? [weekdayMon(start)] : weekdays;
  const choices = rules(start, days);
  const rrule = repeat === 'custom' ? chore!.rrule : choices[repeat];
  const toggle = (list: number[], id: number) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const onText = (t: string) => {
    setText(t);
    if (!iconTouched) setIcon(guessTaskIcon(t));
  };
  const save = async () => {
    setBusy(true);
    const body = { text: text.trim(), icon, memberIds, rrule, start };
    const ok = await act(
      () => (chore ? api(`/chores/${chore.id}`, { method: 'PATCH', body }) : api('/chores', { method: 'POST', body })),
      chore ? `Saved “${body.text}”` : `Added “${body.text}”`,
    );
    setBusy(false);
    if (ok) sheets.close();
  };
  const remove = async () => {
    if (await act(() => api(`/chores/${chore!.id}`, { method: 'DELETE' }), `Removed “${chore!.text}”`)) sheets.close();
  };

  return (
    <Sheet title={chore ? 'Edit job' : 'New job'} icon={icon} sub="Shows as a sticker tile on each day it’s due.">
      <form className="form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <label className="field">Job
          <input id="cs-text" value={text} onChange={(e) => onText(e.target.value)} required maxLength={60} placeholder="Feed the dog" autoFocus={!chore} />
        </label>

        <div className="field">Who does it?
          <div className="toggles">
            {f.members.map((m) => (
              <button type="button" key={m.id} className="tog" style={pc(m.color)} aria-pressed={memberIds.includes(m.id)} onClick={() => setMemberIds(toggle(memberIds, m.id))}>
                <Face m={m} />{m.name}
              </button>
            ))}
            <button type="button" className="tog plain" aria-pressed={!memberIds.length} onClick={() => setMemberIds([])}><span aria-hidden="true">🏠</span> Anyone</button>
          </div>
          <span className="note">{memberIds.length > 1 ? 'Each person ticks off their own.' : !memberIds.length ? 'A family job: one tick from anyone and it’s done.' : ''}</span>
        </div>

        <div className="form-grid">
          <label className="field">Repeats
            <select id="cs-repeat" value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)}>
              <option value="daily">Every day</option>
              <option value="weekdays">Every weekday (Mon–Fri)</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Every 2 weeks</option>
              <option value="monthly-date">{describeRRule(choices['monthly-date'])}</option>
              <option value="monthly-day">{describeRRule(choices['monthly-day'])}</option>
              {repeat === 'custom' && <option value="custom">{describeRRule(chore!.rrule)}</option>}
            </select>
          </label>
          <label className="field">Starts<input id="cs-start" type="date" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} required /></label>
        </div>
        {weekly && (
          <div className="toggles" aria-label="Repeat on">
            {DAY_SHORT.map((d, i) => (
              <button type="button" key={d} className="tog plain" aria-pressed={days.includes(i)} onClick={() => setWeekdays(toggle(days, i).sort())}>{d}</button>
            ))}
          </div>
        )}

        <div className="field">Picture
          <div className="emoji-grid" role="group" aria-label="Picture">
            {(TASK_ICONS.includes(icon) ? TASK_ICONS : [icon, ...TASK_ICONS]).map((e) => (
              <button type="button" key={e} aria-pressed={icon === e} onClick={() => { setIcon(e); setIconTouched(true); }}>{e}</button>
            ))}
          </div>
        </div>

        <div className="row-end">
          <button type="button" className="icon-btn" onClick={sheets.close}>Cancel</button>
          <button className="primary" disabled={busy || !text.trim()}>{chore ? 'Save changes' : 'Add job'}</button>
        </div>
      </form>
      {chore && (
        <ConfirmButton label="Remove" confirmText={`Remove “${chore.text}”? Its ticks go too.`} onConfirm={remove} />
      )}
    </Sheet>
  );
}
