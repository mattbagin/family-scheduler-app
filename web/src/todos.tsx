import { useRef, useState, type ReactNode } from 'react';
import { addDays, dayLabel, describeRRule, guessTodoKind, parseQuickAdd, type PrepItem, type Todo, type Ymd } from '@shared';
import { api } from './api.ts';
import { namesOf, useAction, useFamily, useNow } from './context.tsx';
import { dueLabel } from './lib.ts';
import { burstFrom, chime, Face, pc, useToast } from './ui.tsx';

/** Tick a to-do (or prep item) on or off, with a little celebration. */
export function useToggleTodo() {
  const act = useAction();
  const toast = useToast();
  const f = useFamily();
  return async (t: Pick<Todo, 'id' | 'text' | 'doneAt' | 'assigneeId'>, el: Element | null) => {
    const done = !t.doneAt;
    if (done) {
      burstFrom(el);
      chime([784, 988, 1319]);
    }
    const ok = await act(() => api(`/todos/${t.id}`, { method: 'PATCH', body: { done } }));
    if (ok && done) toast(`${f.byId(t.assigneeId)?.name ?? 'Someone'} did “${t.text}”`);
  };
}

/** Tick a prep item: a bring note is marked packed for its day; a prep to-do is marked done. */
export function useTogglePrep() {
  const act = useAction();
  return async (p: PrepItem, el: Element | null) => {
    const done = !p.done;
    if (done) {
      burstFrom(el);
      chime([784, 988, 1319]);
    }
    await act(() => (p.todoId
      ? api(`/todos/${p.todoId}`, { method: 'PATCH', body: { done } })
      : api(`/events/${p.eventId}/packed/${p.date}`, { method: 'PUT', body: { packed: done } })));
  };
}

/**
 * A row that can be swiped on a touch screen: right to finish, left to push to tomorrow.
 * The same actions are always available as buttons.
 */
function SwipeRow({ onRight, onLeft, children }: { onRight: () => void; onLeft?: () => void; children: ReactNode }) {
  const [dx, setDx] = useState(0);
  const start = useRef<number | null>(null);
  const end = () => {
    if (dx > 80) onRight();
    else if (dx < -80 && onLeft) onLeft();
    start.current = null;
    setDx(0);
  };
  return (
    <div className="swipe">
      <div className="swipe-bg" aria-hidden="true"><span>✓ Done</span>{onLeft && <span>Tomorrow →</span>}</div>
      <div
        className="swipe-fg"
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: start.current === null ? 'transform .2s' : 'none' }}
        onPointerDown={(e) => { if (e.pointerType !== 'mouse') start.current = e.clientX; }}
        onPointerMove={(e) => { if (start.current !== null) setDx(Math.max(onLeft ? -120 : 0, Math.min(120, e.clientX - start.current))); }}
        onPointerUp={end}
        onPointerCancel={() => { start.current = null; setDx(0); }}
      >
        {children}
      </div>
    </div>
  );
}

/** A to-do in a list: tick it, push it to tomorrow, or (for parents) remove it. */
export function TodoRow({ todo, showWho }: { todo: Todo; showWho?: boolean }) {
  const f = useFamily();
  const act = useAction();
  const { today } = useNow();
  const toggle = useToggleTodo();
  const checkRef = useRef<HTMLButtonElement>(null);
  const who = f.byId(todo.assigneeId);
  const late = !todo.doneAt && !!todo.due && todo.due < today;
  const snooze = todo.doneAt ? undefined : () => {
    const to = addDays(todo.due && todo.due > today ? todo.due : today, 1);
    act(() => api(`/todos/${todo.id}`, { method: 'PATCH', body: { due: to } }), `“${todo.text}” moved to ${dayLabel(today, to).toLowerCase()}`);
  };
  return (
    <SwipeRow onRight={() => toggle(todo, checkRef.current)} onLeft={snooze}>
      <div className={`task ${todo.doneAt ? 'is-done' : ''}`} style={pc(who?.color)}>
        <button ref={checkRef} className="check" aria-pressed={!!todo.doneAt} aria-label={`Mark “${todo.text}” ${todo.doneAt ? 'not done' : 'done'}`}
          onClick={(e) => toggle(todo, e.currentTarget)}>
          {todo.doneAt ? '✓' : ''}
        </button>
        <span className="e" aria-hidden="true">{todo.icon}</span>
        <div className="task-main">
          <b>{todo.text}</b>
          <div className={`note ${late ? 'late' : ''}`}>
            {todo.kind === 'prep' ? `Get ready for ${todo.due ? dayLabel(today, todo.due).toLowerCase() : 'later'}` : todo.due ? dueLabel(today, todo.due) : 'Someday'}
            {todo.rrule && ` · 🔁 ${describeRRule(todo.rrule)}`}
            {showWho && ` · ${who?.name ?? 'Anyone'}`}
          </div>
        </div>
        {snooze && <button className="mini-btn" onClick={snooze} title="Push to tomorrow">Tomorrow</button>}
        {f.canEdit && (
          <button className="x-btn" aria-label={`Remove “${todo.text}”`} onClick={() => act(() => api(`/todos/${todo.id}`, { method: 'DELETE' }), `Removed “${todo.text}”`)}>✕</button>
        )}
      </div>
    </SwipeRow>
  );
}

/** A tick-list of what to get ready, grouped by day. */
export function PrepList({ items, showWho = true }: { items: PrepItem[]; showWho?: boolean }) {
  const f = useFamily();
  const { today } = useNow();
  const toggle = useTogglePrep();
  const days = [...new Set(items.map((p) => p.date))];
  return (
    <div className="stack" style={{ gap: 10 }}>
      {days.map((d) => (
        <div key={d} className="tasks">
          <div className="label">{d === today ? 'For today' : `For ${dayLabel(today, d).toLowerCase()}`}</div>
          {items.filter((p) => p.date === d).map((p) => (
            <div key={p.key} className={`task ${p.done ? 'is-done' : ''}`} style={pc(f.byId(p.memberIds[0])?.color)}>
              <button className="check" aria-pressed={p.done} aria-label={`Mark “${p.text}” ${p.done ? 'not ready' : 'ready'}`} onClick={(e) => toggle(p, e.currentTarget)}>
                {p.done ? '✓' : ''}
              </button>
              <span className="e" aria-hidden="true">{p.icon}</span>
              <div className="task-main">
                <b>{p.text}</b>
                <div className="note">{p.eventTitle ? `For ${p.eventTitle}` : 'Get ready'}{showWho && p.memberIds.length ? ` · ${namesOf(f, p.memberIds)}` : ''}</div>
              </div>
              {showWho && <span className="faces">{p.memberIds.map((id) => <Face key={id} m={f.byId(id)} />)}</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Picture tiles of what to get ready, for kids. */
export function PrepTiles({ items }: { items: PrepItem[] }) {
  const { today } = useNow();
  const toggle = useTogglePrep();
  return (
    <div className="tiles">
      {items.map((p) => (
        <button key={p.key} className={`tile ${p.done ? 'is-done' : ''}`} aria-pressed={p.done} onClick={(e) => toggle(p, e.currentTarget)}>
          <span className="e" aria-hidden="true">{p.icon}</span>{p.text}
          <span className="note"><span aria-hidden="true">{p.date === today ? '☀️' : p.date === addDays(today, 1) ? '🌙' : '📅'}</span> {p.date === today ? 'Today' : dayLabel(today, p.date)}</span>
        </button>
      ))}
    </div>
  );
}

/** One line to add a to-do: "Call the plumber Friday" (the day is optional). */
export function AddTodo({ assigneeId, placeholder = 'Add a to-do, e.g. Call the plumber Friday' }: { assigneeId: number | null; placeholder?: string }) {
  const f = useFamily();
  const act = useAction();
  const { today } = useNow();
  const [text, setText] = useState('');
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = todoFromText(text, f.members, today, assigneeId);
    if (!body) return;
    if (await act(() => api('/todos', { method: 'POST', body }), `Added “${body.text}”`)) setText('');
  };
  return (
    <form className="row" onSubmit={add}>
      <input className="inline-select" style={{ flex: 1 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} maxLength={120} aria-label="New to-do" />
      <button className="mini-btn" disabled={!text.trim()}>Add</button>
    </form>
  );
}

/** Reads a to-do out of plain words: who, which day, and whether it's something to pack. */
export function todoFromText(text: string, members: Parameters<typeof parseQuickAdd>[1], today: Ymd, fallbackWho: number | null) {
  const parsed = parseQuickAdd(text, members, today);
  if (!parsed) return null;
  const kind = guessTodoKind(text);
  // To-dos don't have a place; "Call Bob at the bank" keeps its words.
  let words = parsed.location ? `${parsed.title} at ${parsed.location}` : parsed.title;
  // "Pack gym shoes" shows as "Gym shoes" on a packing list.
  if (kind === 'prep') words = words.replace(/^(pack|bring|take)\s+(the\s+|a\s+|an\s+)?/i, '').replace(/^./, (c) => c.toUpperCase()) || words;
  const due = parsed.date ?? (kind === 'prep' ? addDays(today, 1) : null);
  return { kind, text: words, assigneeId: parsed.memberIds[0] ?? fallbackWho, due, rrule: parsed.rrule };
}
