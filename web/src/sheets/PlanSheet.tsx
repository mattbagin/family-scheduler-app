import { useState } from 'react';
import { addDays, dayDiff, dayLabel, dayWithDate, fmtShortDate, fmtTime, guessTaskIcon, minutesOf, type Plan, type PlanTask } from '@shared';
import { api } from '../api.ts';
import { useAction, useFamily, useNow } from '../context.tsx';
import { dueLabel, relDay } from '../lib.ts';
import { usePlans } from '../queries.ts';
import { burstFrom, chime, ConfirmButton, Face, pc, Sheet, useSheets, useToast } from '../ui.tsx';

export function useToggleTask() {
  const f = useFamily();
  const act = useAction();
  const toast = useToast();
  return async (task: PlanTask, plan: Plan, el: Element | null) => {
    const done = !task.doneAt;
    if (done) {
      burstFrom(el);
      chime([784, 988, 1319]);
    }
    const ok = await act(() => api(`/tasks/${task.id}`, { method: 'PATCH', body: { done } }));
    if (ok && done) {
      const left = plan.tasks.filter((t) => !t.doneAt && t.id !== task.id).length;
      const who = f.byId(task.assigneeId)?.name ?? 'Someone';
      toast(left ? `${who} finished “${task.text}”. ${left} left for ${plan.title}.` : `Everything’s ready for ${plan.title}! 🎉`);
    }
  };
}

export function TaskRow({ task, plan, showPlan }: { task: PlanTask; plan: Plan; showPlan?: boolean }) {
  const f = useFamily();
  const act = useAction();
  const { today } = useNow();
  const toggle = useToggleTask();
  const who = f.byId(task.assigneeId);
  const late = !task.doneAt && task.due < today;
  // In the plan sheet a row is just the task; tapping it opens the day, the person and remove.
  const [editing, setEditing] = useState(false);
  const main = (
    <>
      <span className="e" aria-hidden="true">{task.icon}</span>
      <span className="task-main">
        <b>{task.text}</b>
        <span className={`note ${late ? 'late' : ''}`}>{showPlan ? `${plan.icon} ${plan.title} · ` : ''}{dueLabel(today, task.due)}</span>
      </span>
      {who ? <Face m={who} /> : !showPlan && <span className="pill muted">Anyone</span>}
    </>
  );
  return (
    <div className={`task ${task.doneAt ? 'is-done' : ''}`} style={pc(who?.color)}>
      <button className="check" aria-pressed={!!task.doneAt} aria-label={`Mark “${task.text}” ${task.doneAt ? 'not done' : 'done'}`} onClick={(e) => toggle(task, plan, e.currentTarget)}>
        {task.doneAt ? '✓' : ''}
      </button>
      {showPlan ? main : (
        <button className="task-open" aria-expanded={editing} onClick={() => setEditing(!editing)} aria-label={`${task.text}, ${dueLabel(today, task.due)}${who ? `, ${who.name}` : ''}. Change it`}>
          {main}
        </button>
      )}
      {!showPlan && editing && (
        <div className="task-edit">
          <label className="field">Due
          <input
            type="date"
            className="inline-select"
            style={{ width: 'auto' }}
            aria-label={`When “${task.text}” is due`}
            value={task.due}
            onChange={(e) => {
              const due = e.target.value;
              if (due) act(() => api(`/tasks/${task.id}`, { method: 'PATCH', body: { due } }), `“${task.text}” is now due ${relDay(today, due)}`);
            }}
          />
          </label>
          <label className="field">Who
          <select
            id={`assign-${task.id}`}
            className="inline-select"
            aria-label={`Who does “${task.text}”`}
            value={task.assigneeId ?? ''}
            onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : null;
              act(() => api(`/tasks/${task.id}`, { method: 'PATCH', body: { assigneeId: id } }), `“${task.text}” is now ${id ? `${f.byId(id)?.name}’s job` : 'up for grabs'}`);
            }}
          >
            <option value="">Anyone</option>
            {f.members.map((m) => <option key={m.id} value={m.id}>{m.avatar} {m.name}</option>)}
          </select>
          </label>
          <ConfirmButton label="Remove" className="mini-btn danger" confirmText={`Remove “${task.text}” from the plan?`}
            onConfirm={() => act(() => api(`/tasks/${task.id}`, { method: 'DELETE' }), `Removed “${task.text}”`)} />
        </div>
      )}
    </div>
  );
}

/** A plan: an event broken into tasks, each with a person and a due date. */
export function PlanSheet({ planId }: { planId: number }) {
  const f = useFamily();
  const act = useAction();
  const sheets = useSheets();
  const { today } = useNow();
  const { data: plans } = usePlans();
  const plan = plans?.find((p) => p.id === planId);
  const eventDay = plan?.start.slice(0, 10) ?? today;
  const [text, setText] = useState('');
  const [who, setWho] = useState('');
  const [due, setDue] = useState(() => (dayDiff(today, eventDay) > 0 ? addDays(eventDay, -1) : today));

  if (!plan) return <Sheet title="Plan">{plans ? <p>This plan was removed.</p> : <p className="note">Loading…</p>}</Sheet>;

  const done = plan.tasks.filter((t) => t.doneAt).length;
  const perPerson = f.members
    .map((m) => ({ m, n: plan.tasks.filter((t) => t.assigneeId === m.id).length, d: plan.tasks.filter((t) => t.assigneeId === m.id && t.doneAt).length }))
    .filter((x) => x.n);
  const span = Math.max(0, Math.min(90, dayDiff(today, eventDay)));
  const dueOptions = Array.from({ length: span + 1 }, (_, i) => addDays(today, i));
  const sorted = [...plan.tasks].sort((a, b) => Number(!!a.doneAt) - Number(!!b.doneAt) || (a.due < b.due ? -1 : a.due > b.due ? 1 : a.id - b.id));

  const addTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    const ok = await act(
      () => api(`/plans/${plan.id}/tasks`, { method: 'POST', body: { text: t, icon: guessTaskIcon(t), assigneeId: who ? Number(who) : null, due } }),
      `Added “${t}”${who ? ` for ${f.byId(Number(who))?.name}` : ''}`,
    );
    if (ok) {
      setText('');
      document.getElementById('nt-text')?.focus();
    }
  };

  return (
    <Sheet
      wide
      icon={plan.icon}
      title={plan.title}
      sub={`${dayWithDate(today, eventDay)} at ${fmtTime(minutesOf(plan.start))}${plan.notes ? ` · ${plan.notes}` : ''}`}
    >
      <div className="bar big" role="progressbar" aria-valuenow={done} aria-valuemax={plan.tasks.length} aria-label="Tasks done">
        <i style={{ transform: `scaleX(${plan.tasks.length ? done / plan.tasks.length : 0})` }} />
      </div>
      {perPerson.length > 0 && (
        <div className="toggles">
          {perPerson.map(({ m, n, d }) => (
            <span key={m.id} className="who-chip"><Face m={m} />{m.name} <span className="note num">{d === n ? '✓ all done' : `${d} of ${n}`}</span></span>
          ))}
        </div>
      )}
      <div className="tasks">
        {sorted.length ? sorted.map((t) => <TaskRow key={t.id} task={t} plan={plan} />) : <p className="note">Add the first task below.</p>}
      </div>

      <form className="form" onSubmit={addTask} style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
        <input id="nt-text" className="big-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a task, e.g. Cook the turkey" autoComplete="off" maxLength={120} />
        <div className="row">
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>Who
            <select id="nt-who" className="inline-select" value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">Anyone</option>
              {f.members.map((m) => <option key={m.id} value={m.id}>{m.avatar} {m.name}</option>)}
            </select>
          </label>
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>Due
            <select id="nt-due" className="inline-select" value={due} onChange={(e) => setDue(e.target.value)}>
              {!dueOptions.includes(due) && <option value={due}>{dayLabel(today, due)}</option>}
              {dueOptions.map((d) => <option key={d} value={d}>{dayLabel(today, d)}{dayDiff(today, d) > 1 && dayDiff(today, d) < 7 ? ` ${fmtShortDate(d)}` : ''}</option>)}
            </select>
          </label>
          <span className="spacer" />
          <button className="primary" disabled={!text.trim()}>Add task</button>
        </div>
      </form>

      <div className="row">
        <span className="spacer" />
        <ConfirmButton
          label="Remove plan"
          confirmText="Remove the task list? The event stays on the calendar."
          onConfirm={async () => {
            if (await act(() => api(`/plans/${plan.id}`, { method: 'DELETE' }), 'Plan removed')) sheets.close();
          }}
        />
      </div>
    </Sheet>
  );
}
