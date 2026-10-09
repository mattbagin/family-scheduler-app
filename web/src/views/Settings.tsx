import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  addDays, dayLabel, fmtTime, guessTaskIcon, hhmmToMin, MEMBER_AVATARS, MEMBER_COLORS, minutesOf,
  type BackupInfo, type Calendar, type CalendarPreview, type Chore, type Member, type NotifyPrefs, type NudgeSettings, type Place, type Role,
  type SyncResult,
} from '@shared';
import { api } from '../api.ts';
import { useAction, useFamily, useNow } from '../context.tsx';
import { ago, money, relDay } from '../lib.ts';
import { canInstall, install, installHint, onInstallChange, pushState, turnOffPush, turnOnPush, type PushState } from '../push.ts';
import { useBills, useCalendars, useChores, useHub, type HubInfo } from '../queries.ts';
import { UnlockSheet } from '../sheets/PinPad.tsx';
import { Avatar, ConfirmButton, Face, pc, setMuted, useMuted, useSheets, useToast } from '../ui.tsx';

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const daysText = (days: number[]) =>
  days.length === 7 ? 'Every day' : days.join() === '0,1,2,3,4' ? 'Weekdays' : days.join() === '5,6' ? 'Weekends' : days.map((d) => DAY_SHORT[d]).join(', ');

const SECTIONS = [
  ['set-family', 'Family'], ['set-jobs', 'Daily jobs'], ['set-calendars', 'Calendars'], ['set-nudges', 'Nudges'],
  ['set-hub', 'Family hub'], ['set-bills', 'Bills'], ['set-backups', 'Backups'], ['set-device', 'This device'],
] as const;

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
      <nav className="jump" aria-label="Settings sections">
        {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`} className="mini-btn">{label}</a>)}
      </nav>
      <div className="two-col">
        <div className="col">
          <FamilySection />
          <ChoresSection />
        </div>
        <div className="col">
          <CalendarsSection />
          <NudgesSection />
          <HubSection />
          <BillsSection />
          <BackupSection />
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
    <section className="panel" id="set-family">
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
        <div className="emoji-grid" role="group" aria-label="Picture">{MEMBER_AVATARS.map((a) => <button type="button" key={a} aria-pressed={avatar === a} onClick={() => setAvatar(a)}>{a}</button>)}</div>
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
    <section className="panel" id="set-jobs">
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
    <section className="panel" id="set-calendars">
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

type SettingsWithDevices = NudgeSettings & { devices: Record<number, number> };

const NUDGE_KINDS: [keyof NotifyPrefs, string][] = [
  ['leaveBy', '🚗 Time to leave'], ['reminders', '⏰ Event reminders'], ['morning', '☀️ Morning briefing'],
  ['evening', '🎒 Evening packing'], ['bills', '💵 Bills'],
];

function NudgesSection() {
  const f = useFamily();
  const act = useAction();
  const { data: s } = useQuery({ queryKey: ['nudges', 'settings'], queryFn: () => api<SettingsWithDevices>('/nudge-settings') });
  const save = (body: object) => act(() => api('/nudge-settings', { method: 'PATCH', body }), 'Saved');
  const adults = f.members.filter((m) => m.role === 'adult');
  return (
    <section className="panel" id="set-nudges">
      <h2>Nudges</h2>
      <p className="note" style={{ margin: 0 }}>
        Homebase nudges parents when it’s time to leave, what to pack tonight, bills coming due, and reminders set on events.
        The hub shows them as banners with a soft chime.
      </p>
      <ThisDeviceNotifications />
      {s && (
        <>
          <div className="form-grid">
            <label className="field">Morning briefing
              <input id="nd-morning" type="time" value={s.morningAt} onChange={(e) => e.target.value && save({ morningAt: e.target.value })} />
            </label>
            <label className="field">Evening packing reminder
              <input id="nd-evening" type="time" value={s.eveningAt} onChange={(e) => e.target.value && save({ eveningAt: e.target.value })} />
            </label>
          </div>
          <label className="field">If nobody taps “Got it” on a time-to-leave nudge
            <select id="nd-escalate" value={s.escalateMin} onChange={(e) => save({ escalateMin: Number(e.target.value) })}>
              <option value={0}>Leave it at one nudge</option>
              {[5, 10, 15].map((n) => <option key={n} value={n}>Repeat after {n} min, then tell the other parent</option>)}
            </select>
          </label>
          <div>
            {adults.map((m) => {
              const p = s.members[m.id];
              if (!p) return null;
              const devices = s.devices[m.id] ?? 0;
              return (
                <div key={m.id} className="setting-row" style={{ ...pc(m.color), alignItems: 'flex-start' }}>
                  <Avatar m={m} />
                  <div className="stack" style={{ gap: 8, flex: 1, minWidth: 0 }}>
                    <div>
                      <b>{m.name}</b>
                      <div className="note">
                        {devices ? `Nudges go to ${devices} device${devices === 1 ? '' : 's'}` : `No phone set up yet: sign in as ${m.name} on it and turn notifications on`}
                      </div>
                    </div>
                    <div className="toggles">
                      {NUDGE_KINDS.map(([k, label]) => (
                        <button key={k} className="tog plain" aria-pressed={!!p[k]} onClick={() => save({ members: { [m.id]: { [k]: !p[k] } } })}>{label}</button>
                      ))}
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      <span className="note">Quiet from</span>
                      <input type="time" className="inline-select" style={{ width: 'auto' }} value={p.quietStart} aria-label={`${m.name}’s quiet hours start`}
                        onChange={(e) => e.target.value && save({ members: { [m.id]: { quietStart: e.target.value } } })} />
                      <span className="note">to</span>
                      <input type="time" className="inline-select" style={{ width: 'auto' }} value={p.quietEnd} aria-label={`${m.name}’s quiet hours end`}
                        onChange={(e) => e.target.value && save({ members: { [m.id]: { quietEnd: e.target.value } } })} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

const PUSH_TEXT: Record<Exclude<PushState, 'off' | 'on'>, string> = {
  insecure: 'Notifications need Homebase’s secure https:// address. See “Phones and HTTPS” in the README.',
  'install-first': 'On iPhone and iPad, first add Homebase to your Home Screen (Share → Add to Home Screen), then open it from there.',
  unsupported: 'This browser can’t show notifications.',
  denied: 'Notifications are blocked for Homebase in this browser. Allow them in the site settings, then come back here.',
};

function ThisDeviceNotifications() {
  const f = useFamily();
  const toast = useToast();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    pushState().then(setState, () => setState('unsupported'));
  }, []);
  if (f.session.kind === 'hub') {
    return <div className="feed-preview note">This is the family hub: nudges show here as banners. Notifications go to parents’ own phones.</div>;
  }
  if (f.me?.role !== 'adult' || !state) return null;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That didn’t work');
    }
    setBusy(false);
    setState(await pushState().catch(() => 'unsupported' as const));
  };
  const test = () => run(async () => {
    const r = await api<{ devices: number; delivered: number }>('/push/test', { method: 'POST' });
    if (!r.delivered) throw new Error('The test didn’t reach any device. Try turning notifications off and on again.');
  }, 'Test sent. It should pop up in a moment.');

  return (
    <div className="feed-preview">
      <b>On this device</b>
      {state === 'on' ? (
        <>
          <span className="note">✓ {f.me.name}’s nudges come to this device.</span>
          <div className="row">
            <button className="mini-btn" disabled={busy} onClick={test}>Send a test</button>
            <button className="mini-btn" disabled={busy} onClick={() => run(turnOffPush, 'Notifications turned off here')}>Turn off</button>
          </div>
        </>
      ) : state === 'off' ? (
        <>
          <span className="note">Get {f.me.name}’s nudges here, even when Homebase is closed.</span>
          <button className="primary" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => run(turnOnPush, 'Notifications are on')}>Turn on notifications</button>
        </>
      ) : <span className="note">{PUSH_TEXT[state]}</span>}
    </div>
  );
}

function InstallButton() {
  const act = useAction();
  const [available, setAvailable] = useState(canInstall());
  useEffect(() => {
    const off = onInstallChange(() => setAvailable(canInstall()));
    return () => { off(); };
  }, []);
  const hint = installHint();
  if (available) {
    return <button className="icon-btn" onClick={() => act(install, (ok) => (ok ? 'Homebase is installed' : 'Maybe later'))}>📲 Install Homebase on this device</button>;
  }
  return hint ? <p className="note" style={{ margin: 0 }}>📲 {hint}</p> : null;
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
    <section className="panel" id="set-bills">
      <h2>Bills</h2>
      <div>
        {bills.map((b) => (
          <div key={b.id} className="bill">
            <span className="e" aria-hidden="true">{b.icon}</span>
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

function HubSection() {
  const act = useAction();
  const { data: hub } = useHub();
  const [dir, setDir] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [searching, setSearching] = useState(false);
  if (!hub) return null;
  const save = (body: Partial<HubInfo>, ok = 'Saved') => act(() => api<HubInfo>('/hub-settings', { method: 'PATCH', body }), ok);
  const folder = dir ?? hub.photoDir ?? '';

  const saveFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await save({ photoDir: folder.trim() || null }, folder.trim() ? 'Photo folder saved' : 'Photo folder cleared')) setDir(null);
  };
  const find = async (e: React.FormEvent) => {
    e.preventDefault();
    setSearching(true);
    const r = await act(() => api<Place[]>(`/places?q=${encodeURIComponent(q.trim())}`));
    setSearching(false);
    if (r) setPlaces(r);
  };
  const pick = async (p: Place) => {
    if (await save({ place: p }, `Weather is now for ${p.name}`)) {
      setPlaces(null);
      setQ('');
    }
  };

  return (
    <section className="panel" id="set-hub">
      <h2>Family hub</h2>
      <p className="note" style={{ margin: 0 }}>
        After two minutes without a touch, the shared screen shows a slideshow with the clock, the weather and everyone’s next thing.
      </p>

      <form className="form" onSubmit={saveFolder}>
        <div className="row" style={{ alignItems: 'end' }}>
          <label className="field" style={{ flex: 1 }}>Photo folder on the home computer
            <input id="hub-photos" value={folder} onChange={(e) => setDir(e.target.value)} placeholder="Paste the folder’s full path" spellCheck={false} />
          </label>
          <button className="icon-btn" disabled={dir === null || folder.trim() === (hub.photoDir ?? '')}>Save</button>
        </div>
        <span className="note">
          {!hub.photoDir ? 'No folder yet, so the slideshow shows color scenes. Paste the full path of a folder of family photos.'
            : hub.photoCount === null ? '⚠ That folder can’t be read right now. Check that it still exists.'
              : `${hub.photoCount} photo${hub.photoCount === 1 ? '' : 's'}, including folders inside it. New ones show up within a few minutes.`}
        </span>
        {hub.photoDir && <button type="button" className="mini-btn" style={{ alignSelf: 'flex-start' }} onClick={() => save({ photoDir: null }, 'Back to color scenes')}>Use color scenes instead</button>}
      </form>

      <div className="stack" style={{ gap: 8 }}>
        <label className="checkline">
          <input type="checkbox" checked={hub.night} onChange={(e) => save({ night: e.target.checked }, e.target.checked ? 'Night mode on' : 'Night mode off')} />
          Night mode: a dim clock instead of photos, and no chimes
        </label>
        {hub.night && (
          <div className="row" style={{ gap: 8 }}>
            <span className="note">From</span>
            <input type="time" className="inline-select" style={{ width: 'auto' }} value={hub.nightStart} aria-label="Night mode starts"
              onChange={(e) => e.target.value && save({ nightStart: e.target.value })} />
            <span className="note">to</span>
            <input type="time" className="inline-select" style={{ width: 'auto' }} value={hub.nightEnd} aria-label="Night mode ends"
              onChange={(e) => e.target.value && save({ nightEnd: e.target.value })} />
          </div>
        )}
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <label className="checkline">
          <input type="checkbox" checked={hub.eveningStart !== null} onChange={(e) => save({ eveningStart: e.target.checked ? '19:30' : null }, e.target.checked ? 'Tomorrow board on' : 'Tomorrow board off')} />
          Show tomorrow in the evening
        </label>
        <span className="note">Who leaves first, who drives, and what’s still unsorted, in place of Today.</span>
        {hub.eveningStart !== null && (
          <div className="row" style={{ gap: 8 }}>
            <span className="note">From</span>
            <input type="time" className="inline-select" style={{ width: 'auto' }} value={hub.eveningStart} aria-label="Evening starts at"
              onChange={(e) => e.target.value && save({ eveningStart: e.target.value })} />
            <span className="note">until {hub.night ? 'night mode ends' : 'the morning'} ({fmtTime(hhmmToMin(hub.nightEnd))})</span>
          </div>
        )}
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <div className="row">
          <b>Weather</b>
          <span className="note">{hub.place ? `${hub.place.name}${hub.place.detail ? `, ${hub.place.detail}` : ''}` : 'Not set up yet'}</span>
          <span className="spacer" />
          <div className="toggles" role="group" aria-label="Temperature units">
            <button className="tog plain" aria-pressed={hub.tempUnit === 'c'} onClick={() => save({ tempUnit: 'c' })}>°C</button>
            <button className="tog plain" aria-pressed={hub.tempUnit === 'f'} onClick={() => save({ tempUnit: 'f' })}>°F</button>
          </div>
        </div>
        <form className="row" onSubmit={find}>
          <div className="field" style={{ flex: 1 }}>
            <input id="hub-place" aria-label="Town or city for the weather" value={q} onChange={(e) => { setQ(e.target.value); setPlaces(null); }}
              placeholder={hub.place ? 'Change the town or city' : 'Your town or city'} autoComplete="off" />
          </div>
          <button className="icon-btn" disabled={!q.trim() || searching}>{searching ? 'Looking…' : 'Find'}</button>
        </form>
        {places && (places.length ? (
          <div className="toggles">
            {places.map((p) => (
              <button key={`${p.lat},${p.lon}`} className="tog plain" onClick={() => pick(p)}>
                📍 {p.name}{p.detail && <span className="note">{p.detail}</span>}
              </button>
            ))}
          </div>
        ) : <span className="note">No places by that name. Try the nearest bigger town.</span>)}
        {hub.place && <button className="mini-btn" style={{ alignSelf: 'flex-start' }} onClick={() => save({ place: null }, 'Weather turned off')}>Turn weather off</button>}
      </div>
    </section>
  );
}

function BackupSection() {
  const act = useAction();
  const { data: info, refetch } = useQuery({ queryKey: ['backups'], queryFn: () => api<BackupInfo | null>('/backups') });
  const [busy, setBusy] = useState(false);
  if (!info) return null;
  const latest = info.files[0];
  const backUp = async () => {
    setBusy(true);
    await act(() => api<BackupInfo>('/backups', { method: 'POST' }), 'Backed up');
    setBusy(false);
    refetch();
  };
  return (
    <section className="panel" id="set-backups">
      <h2>Backups</h2>
      <p className="note" style={{ margin: 0 }}>
        Each night the home computer copies everything to a backup file and keeps the last {info.keep}.{' '}
        {latest ? `Latest: ${ago(latest.at)} (${Math.max(1, Math.round(latest.size / 1024))} KB).` : 'None yet.'}
      </p>
      <p className="note" style={{ margin: 0, overflowWrap: 'anywhere' }}>Folder: {info.dir}</p>
      <div className="row"><button className="icon-btn" disabled={busy} onClick={backUp}>{busy ? 'Backing up…' : 'Back up now'}</button></div>
    </section>
  );
}

function DeviceSection() {
  const f = useFamily();
  const qc = useQueryClient();
  const act = useAction();
  const muted = useMuted();
  const who = f.session.kind === 'hub' ? 'the family hub' : f.me?.name ?? 'someone';
  return (
    <section className="panel" id="set-device">
      <h2>This device</h2>
      <p style={{ margin: 0 }}>Signed in as <b>{who}</b>.</p>
      <label className="checkline">
        <input type="checkbox" checked={!muted} onChange={(e) => setMuted(!e.target.checked)} />
        Sounds on this device (chimes for jobs, celebrations and nudges)
      </label>
      <InstallButton />
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
