import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  addDays, dayLabel, fmtTime, guessTaskIcon, MEMBER_AVATARS, MEMBER_COLORS, minutesOf,
  type Calendar, type CalendarPreview, type Chore, type Member, type Role, type SyncResult,
} from '@shared';
import { api } from '../api.ts';
import { useAction, useFamily, useNow } from '../context.tsx';
import { ago, money, relDay } from '../lib.ts';
import { useBills, useCalendars, useChores } from '../queries.ts';
import { UnlockSheet } from '../sheets/PinPad.tsx';
import { Avatar, ConfirmButton, Face, pc, useSheets } from '../ui.tsx';

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const daysText = (days: number[]) =>
  days.length === 7 ? 'Every day' : days.join() === '0,1,2,3,4' ? 'Weekdays' : days.join() === '5,6' ? 'Weekends' : days.map((d) => DAY_SHORT[d]).join(', ');

export function Settings() {
  const f = useFamily();
  const sheets = useSheets();
  if (!f.canEdit) {
    return (
      <section className="panel" style={{ alignItems: 'flex-start' }}>
        <h1>Settings</h1>
        <p>Only a parent can change settings.</p>
        <button className="primary" onClick={() => sheets.open(<UnlockSheet onDone={() => sheets.close()} />)}>Unlock with a parent PIN</button>
        <DeviceSection />
      </section>
    );
  }
  return (
    <div className="stack">
      <h1>Settings</h1>
      <div className="two-col">
        <div className="col">
          <FamilySection />
          <ChoresSection />
        </div>
        <div className="col">
          <CalendarsSection />
          <BillsSection />
          <DeviceSection />
        </div>
      </div>
    </div>
  );
}

function FamilySection() {
  const f = useFamily();
  const act = useAction();
  const [name, setName] = useState(f.familyName);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  return (
    <section className="panel">
      <h2>Family</h2>
      <form className="row" onSubmit={(e) => { e.preventDefault(); act(() => api('/settings', { method: 'PATCH', body: { familyName: name.trim() } }), 'Family name saved'); }}>
        <label className="field" style={{ flex: 1 }}>Family name<input id="set-family" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required /></label>
        <button className="icon-btn" style={{ alignSelf: 'end' }} disabled={name.trim() === f.familyName || !name.trim()}>Save</button>
      </form>
      <div>
        {f.members.map((m) => (
          editing === m.id ? <MemberEditor key={m.id} member={m} onDone={() => setEditing(null)} /> : (
            <div key={m.id} className="setting-row" style={pc(m.color)}>
              <Avatar m={m} />
              <div><b>{m.name}</b><div className="note">{m.role === 'adult' ? 'Parent' : 'Kid'}{m.hasPin ? ' · has a PIN' : ''}</div></div>
              <span className="spacer" />
              <button className="icon-btn" onClick={() => setEditing(m.id)}>Edit</button>
            </div>
          )
        ))}
      </div>
      {editing === 'new' ? <MemberEditor onDone={() => setEditing(null)} /> : <button className="icon-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setEditing('new')}>+ Add a family member</button>}
    </section>
  );
}

function MemberEditor({ member, onDone }: { member?: Member; onDone: () => void }) {
  const f = useFamily();
  const act = useAction();
  const [name, setName] = useState(member?.name ?? '');
  const [role, setRole] = useState<Role>(member?.role ?? 'kid');
  const [avatar, setAvatar] = useState(member?.avatar ?? '🧒');
  const [color, setColor] = useState(member?.color ?? MEMBER_COLORS[f.members.length % MEMBER_COLORS.length]);
  const [pin, setPin] = useState('');
  const needsPin = role === 'adult' && !member?.hasPin;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { name: name.trim(), role, avatar, color, ...(pin ? { pin } : {}) };
    const ok = await act(
      () => (member ? api(`/members/${member.id}`, { method: 'PATCH', body }) : api('/members', { method: 'POST', body })),
      member ? `Saved ${body.name}` : `Welcome, ${body.name}!`,
    );
    if (ok) onDone();
  };

  return (
    <form className="member-editor" style={pc(color)} onSubmit={save}>
      <span className="avatar" style={{ width: 56, height: 56, fontSize: 30 }}>{avatar}</span>
      <div className="stack" style={{ gap: 10 }}>
        <div className="form-grid">
          <label className="field">Name<input id="me-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} /></label>
          <label className="field">Role
            <select id="me-role" value={role} onChange={(e) => setRole(e.target.value as Role)}><option value="adult">Parent</option><option value="kid">Kid</option></select>
          </label>
          <label className="field">{member?.hasPin ? 'New PIN (optional)' : role === 'adult' ? 'PIN (4–8 digits)' : 'PIN (optional)'}
            <input id="me-pin" inputMode="numeric" pattern="\d{4,8}" value={pin} maxLength={8} required={needsPin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
          </label>
        </div>
        <div className="emoji-grid">{MEMBER_AVATARS.map((a) => <button type="button" key={a} aria-pressed={avatar === a} onClick={() => setAvatar(a)}>{a}</button>)}</div>
        <div className="swatches">{MEMBER_COLORS.map((c) => <button type="button" key={c} className="swatch" style={{ background: c }} aria-pressed={color === c} aria-label={`Color ${c}`} onClick={() => setColor(c)} />)}</div>
        <div className="row">
          <button className="primary">{member ? 'Save' : 'Add'}</button>
          <button type="button" className="icon-btn" onClick={onDone}>Cancel</button>
          <span className="spacer" />
          {member && (
            <ConfirmButton label="Remove" confirmText={`Remove ${member.name}? Their chores go too; events stay for everyone else.`}
              onConfirm={async () => { if (await act(() => api(`/members/${member.id}`, { method: 'DELETE' }), `Removed ${member.name}`)) onDone(); }} />
          )}
        </div>
      </div>
    </form>
  );
}

function ChoresSection() {
  const f = useFamily();
  const act = useAction();
  const { today } = useNow();
  const { data: chores = [] } = useChores(today);
  const [text, setText] = useState('');
  const [who, setWho] = useState(String(f.members.find((m) => m.role === 'kid')?.id ?? f.members[0]?.id ?? ''));
  const [days, setDays] = useState([0, 1, 2, 3, 4, 5, 6]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    const ok = await act(() => api<Chore>('/chores', { method: 'POST', body: { text: t, icon: guessTaskIcon(t), assigneeId: Number(who), days } }), `Added “${t}”`);
    if (ok) setText('');
  };

  return (
    <section className="panel">
      <h2>Daily jobs</h2>
      <p className="note" style={{ margin: 0 }}>These show as sticker tiles on each kid’s page and in kid mode, and reset every day.</p>
      <div>
        {chores.map((c) => (
          <div key={c.id} className="setting-row">
            <span style={{ fontSize: '1.5rem' }}>{c.icon}</span>
            <div><b>{c.text}</b><div className="note">{daysText(c.days)}</div></div>
            <span className="spacer" />
            <Face m={f.byId(c.assigneeId)} />
            <button className="x-btn" aria-label={`Remove ${c.text}`} onClick={() => act(() => api(`/chores/${c.id}`, { method: 'DELETE' }), `Removed “${c.text}”`)}>✕</button>
          </div>
        ))}
      </div>
      <form className="form" onSubmit={add}>
        <div className="form-grid">
          <label className="field">Job<input id="ch-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Feed the dog" required maxLength={60} /></label>
          <label className="field">Who<select id="ch-who" value={who} onChange={(e) => setWho(e.target.value)}>{f.members.map((m) => <option key={m.id} value={m.id}>{m.avatar} {m.name}</option>)}</select></label>
        </div>
        <div className="toggles">
          {DAY_SHORT.map((d, i) => (
            <button type="button" key={d} className="tog plain" aria-pressed={days.includes(i)} onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort())}>{d}</button>
          ))}
        </div>
        <div className="row-end"><button className="primary" disabled={!text.trim() || !days.length}>Add job</button></div>
      </form>
    </section>
  );
}

const syncText = (r: SyncResult) =>
  r.status === 'error' ? `Couldn’t refresh: ${r.error}`
    : r.added + r.updated + r.removed === 0 ? 'Already up to date'
      : `Updated: ${r.added} new, ${r.updated} changed, ${r.removed} removed`;

function CalendarsSection() {
  const { data: cals = [] } = useCalendars();
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const subs = cals.filter((c) => c.kind === 'ics');
  return (
    <section className="panel">
      <h2>Subscribed calendars</h2>
      <p className="note" style={{ margin: 0 }}>
        School, team and work calendars flow in on their own and refresh every half hour. Their times come from the calendar,
        but you can still pick who’s going, who drives and what to bring.
      </p>
      {subs.length > 0 && (
        <div>
          {subs.map((c) => (editing === c.id
            ? <CalendarEditor key={c.id} cal={c} onDone={() => setEditing(null)} />
            : <CalendarRow key={c.id} cal={c} onEdit={() => setEditing(c.id)} />))}
        </div>
      )}
      {editing === 'new'
        ? <CalendarEditor onDone={() => setEditing(null)} />
        : <button className="icon-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setEditing('new')}>+ Subscribe to a calendar</button>}
    </section>
  );
}

function CalendarRow({ cal, onEdit }: { cal: Calendar; onEdit: () => void }) {
  const f = useFamily();
  const act = useAction();
  const [syncing, setSyncing] = useState(false);
  const refresh = async () => {
    setSyncing(true);
    await act(() => api<SyncResult>(`/calendars/${cal.id}/sync`, { method: 'POST' }), syncText);
    setSyncing(false);
  };
  return (
    <div className="setting-row">
      <span className="cal-dot" style={{ background: cal.color }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <b>{cal.name}</b>
        <div className="note">
          {cal.eventCount} event{cal.eventCount === 1 ? '' : 's'} · {cal.lastSynced ? `updated ${ago(cal.lastSynced)}` : 'not loaded yet'}
        </div>
        {cal.lastError && <span className="pill bad">⚠ {cal.lastError}</span>}
      </div>
      <span className="faces">{cal.memberIds.map((id) => <Face key={id} m={f.byId(id)} />)}</span>
      <button className="icon-btn" onClick={refresh} disabled={syncing}>{syncing ? 'Checking…' : '↻ Refresh'}</button>
      <button className="icon-btn" onClick={onEdit}>Edit</button>
    </div>
  );
}

/** Subscribe (paste a link, check what's in it, then save) or change an existing subscription. */
function CalendarEditor({ cal, onDone }: { cal?: Calendar; onDone: () => void }) {
  const f = useFamily();
  const act = useAction();
  const { today } = useNow();
  const [url, setUrl] = useState(cal?.url ?? '');
  const [preview, setPreview] = useState<CalendarPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [name, setName] = useState(cal?.name ?? '');
  const [color, setColor] = useState(cal?.color ?? '#0E9AA7');
  const [memberIds, setMemberIds] = useState<number[]>(cal?.memberIds ?? []);
  const [busy, setBusy] = useState(false);
  // A new or changed link must be checked before saving.
  const urlChanged = !cal || url.trim() !== cal.url;
  const ready = !!name.trim() && (!urlChanged || !!preview);
  const showDetails = !!cal || !!preview;

  const check = async () => {
    setChecking(true);
    const p = await act(() => api<CalendarPreview>('/calendars/preview', { method: 'POST', body: { url: url.trim() } }));
    setChecking(false);
    if (!p) return;
    setPreview(p);
    if (!name.trim() && p.name) setName(p.name);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const body = { name: name.trim(), color, memberIds, ...(urlChanged ? { url: url.trim() } : {}) };
    const saved = await act(
      () => (cal ? api<Calendar>(`/calendars/${cal.id}`, { method: 'PATCH', body }) : api<Calendar>('/calendars', { method: 'POST', body })),
      (c) => (c.lastError ? `Saved, but it couldn’t load: ${c.lastError}` : cal ? `Saved ${c.name}` : `Subscribed to ${c.name}: ${c.eventCount} events`),
    );
    setBusy(false);
    if (saved) onDone();
  };

  return (
    <form className="form" onSubmit={save} style={{ background: 'var(--surface-2)', borderRadius: 18, padding: 14 }}>
      <div className="row" style={{ alignItems: 'end' }}>
        <label className="field" style={{ flex: 1 }}>Calendar link (ICS or webcal)
          <input id="cal-url" value={url} onChange={(e) => { setUrl(e.target.value); setPreview(null); }} placeholder="webcal://school.example.org/calendar.ics" required autoFocus={!cal} />
        </label>
        <button type="button" className="icon-btn" onClick={check} disabled={!url.trim() || checking || !urlChanged}>{checking ? 'Checking…' : 'Check link'}</button>
      </div>
      <details className="help">
        <summary>Where do I find the link?</summary>
        <ul>
          <li><b>Google Calendar:</b> Settings → pick the calendar → “Secret address in iCal format”.</li>
          <li><b>Outlook:</b> Settings → Calendar → Shared calendars → Publish a calendar → copy the ICS link.</li>
          <li><b>iPhone / iCloud:</b> Calendar app → tap ⓘ next to the calendar → Public Calendar → Share Link.</li>
          <li><b>School and team sites:</b> look for “Subscribe”, “iCal”, “ICS” or “webcal”.</li>
        </ul>
      </details>

      {preview && (
        <div className="feed-preview">
          <div className="note"><b>{preview.name ?? 'This calendar'}</b> has {preview.eventCount} event{preview.eventCount === 1 ? '' : 's'}. Coming up:</div>
          {preview.upcoming.length ? (
            <ul>
              {preview.upcoming.map((o, i) => (
                <li key={i}>
                  <span className="num">{dayLabel(today, o.start.slice(0, 10))}{o.allDay ? '' : `, ${fmtTime(minutesOf(o.start))}`}</span>
                  {o.title}{o.repeats ? ' 🔁' : ''}
                </li>
              ))}
            </ul>
          ) : <div className="note">Nothing in the next three months.</div>}
          {preview.warnings.map((w) => <span key={w} className="pill warn">{w}</span>)}
        </div>
      )}

      {showDetails && (
        <>
          <label className="field">Name<input id="cal-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required placeholder="Lincoln Elementary" /></label>
          <div className="field">Whose calendar is it? New events go to them.
            <div className="toggles">
              {f.members.map((m) => (
                <button type="button" key={m.id} className="tog" style={pc(m.color)} aria-pressed={memberIds.includes(m.id)}
                  onClick={() => setMemberIds(memberIds.includes(m.id) ? memberIds.filter((x) => x !== m.id) : [...memberIds, m.id])}>
                  <Face m={m} />{m.name}
                </button>
              ))}
            </div>
          </div>
          <div className="swatches">
            {MEMBER_COLORS.map((c) => <button type="button" key={c} className="swatch" style={{ background: c }} aria-pressed={color === c} aria-label={`Color ${c}`} onClick={() => setColor(c)} />)}
          </div>
        </>
      )}

      <div className="row">
        {showDetails && <button className="primary" disabled={busy || !ready}>{busy ? 'Loading events…' : cal ? 'Save' : 'Subscribe'}</button>}
        <button type="button" className="icon-btn" onClick={onDone}>Cancel</button>
        <span className="spacer" />
        {cal && (
          <ConfirmButton label="Unsubscribe" confirmText={`Unsubscribe from “${cal.name}”? Its ${cal.eventCount} events leave Homebase (the calendar itself isn’t touched).`}
            onConfirm={async () => { if (await act(() => api(`/calendars/${cal.id}`, { method: 'DELETE' }), `Unsubscribed from ${cal.name}`)) onDone(); }} />
        )}
      </div>
    </form>
  );
}

function BillsSection() {
  const act = useAction();
  const { today } = useNow();
  const { data: bills = [] } = useBills();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [due, setDue] = useState(addDays(today, 7));
  const [monthly, setMonthly] = useState(true);
  const [autopay, setAutopay] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const cents = Math.round(Number.parseFloat(amount) * 100);
    const ok = await act(() => api('/bills', { method: 'POST', body: { name: name.trim(), amountCents: cents, due, monthly, autopay } }), `Added ${name.trim()}`);
    if (ok) { setName(''); setAmount(''); }
  };

  return (
    <section className="panel">
      <h2>Bills</h2>
      <div>
        {bills.map((b) => (
          <div key={b.id} className="bill">
            <span className="e">{b.icon}</span>
            <div><b>{b.name}</b><div className="note">{b.paidAt ? 'Paid' : `Due ${relDay(today, b.due)}`}{b.monthly ? ' · monthly' : ''}{b.autopay ? ' · autopay' : ''}</div></div>
            <span className="amt num">{money(b.amountCents)}</span>
            <button className="x-btn" aria-label={`Remove ${b.name}`} onClick={() => act(() => api(`/bills/${b.id}`, { method: 'DELETE' }), `Removed ${b.name}`)}>✕</button>
          </div>
        ))}
      </div>
      <form className="form" onSubmit={add}>
        <div className="form-grid">
          <label className="field">Bill<input id="bill-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Hydro" required maxLength={60} /></label>
          <label className="field">Amount ($)<input id="bill-amt" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
          <label className="field">Next due<input id="bill-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} required /></label>
        </div>
        <div className="row">
          <label className="checkline"><input type="checkbox" checked={monthly} onChange={(e) => setMonthly(e.target.checked)} />Repeats monthly</label>
          <label className="checkline"><input type="checkbox" checked={autopay} onChange={(e) => setAutopay(e.target.checked)} />Autopay (no reminders)</label>
          <span className="spacer" />
          <button className="primary" disabled={!name.trim() || !amount}>Add bill</button>
        </div>
      </form>
    </section>
  );
}

function DeviceSection() {
  const f = useFamily();
  const qc = useQueryClient();
  const act = useAction();
  const who = f.session.kind === 'hub' ? 'the family hub' : f.me?.name ?? 'someone';
  return (
    <section className="panel">
      <h2>This device</h2>
      <p style={{ margin: 0 }}>Signed in as <b>{who}</b>.</p>
      <div className="row">
        {f.session.elevatedUntil && (
          <button className="icon-btn" onClick={() => act(() => api('/lock', { method: 'POST' }), 'Locked')}>🔒 Lock editing now</button>
        )}
        <button className="icon-btn" onClick={async () => { await api('/logout', { method: 'POST' }); qc.clear(); qc.invalidateQueries(); }}>
          Switch person or set up as the family hub
        </button>
      </div>
    </section>
  );
}
