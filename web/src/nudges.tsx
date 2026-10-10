import { useQuery } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { isSameDayReminder, leaveByTitle, startsInTitle, type Nudge, type NudgeKind } from '@shared';
import { api } from './api.ts';
import { useAction, useFamily, useNow } from './context.tsx';
import { ago, leaveBy, mainRange, occDate, startAbs } from './lib.ts';
import { useOccurrences } from './queries.ts';
import { useNight } from './hub.tsx';
import { chime, Face } from './ui.tsx';

export const useActiveNudges = (enabled: boolean) =>
  useQuery({ queryKey: ['nudges', 'active'], queryFn: () => api<Nudge[]>('/nudges/active'), enabled, refetchInterval: 60_000 });
export const useRecentNudges = () => useQuery({ queryKey: ['nudges', 'recent'], queryFn: () => api<Nudge[]>('/nudges') });

const KIND_ICON: Record<NudgeKind, string> = { leave_by: '🚗', reminder: '⏰', morning: '☀️', evening: '🌙', bill: '🧾' };

/** Titles start with their own emoji ("🚗 Time to leave…"); split it off to sit in the icon tile. */
function splitTitle(n: Nudge): [icon: string, text: string] {
  const m = /^(\p{Extended_Pictographic}[️‍\p{Extended_Pictographic}]*)\s*(.*)$/u.exec(n.title);
  return m ? [m[1], m[2]] : [KIND_ICON[n.kind], n.title];
}

/**
 * Banners for nudges nobody has answered yet, on the hub (even over the ambient screen) and on
 * parents' screens. The hub also plays a soft chime when one arrives.
 * Each is one line until tapped. Over photos it turns frosted, at night it dims to the bedside
 * amber. Kid screens show GrownUpsNote in their own top row instead.
 */
export function NudgeBanners({ ambient = false, night = false }: { ambient?: boolean; night?: boolean }) {
  const f = useFamily();
  const act = useAction();
  const isHub = f.session.kind === 'hub';
  const show = isHub || f.me?.role === 'adult';
  const { data: nudges = [] } = useActiveNudges(show);
  const [open, setOpen] = useState<number | null>(null);
  // A leave-by banner keeps time: it reads its ride's leave time and says how late it's getting.
  const { today, nowMin } = useNow();
  const range = mainRange(today);
  const { data: occs = [] } = useOccurrences(range.from, range.to, show);
  const kidScreen = useLocation().pathname.startsWith('/kid') && !ambient;
  // Phones show the most urgent nudge and roll the rest into "2 more nudges ▾".
  const narrow = useNarrow();
  const [all, setAll] = useState(false);
  // The stack reports how much of the screen bottom it covers, so the page can scroll out from
  // under it and toasts can sit above it (--nudge-clear, in px from the bottom of the window).
  const stack = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const root = document.documentElement.style;
    const el = stack.current;
    if (!el) { root.setProperty('--nudge-clear', '0px'); return; }
    const measure = () => root.setProperty('--nudge-clear', `${Math.ceil(innerHeight - el.getBoundingClientRect().top)}px`);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    addEventListener('resize', measure);
    return () => { ro.disconnect(); removeEventListener('resize', measure); root.setProperty('--nudge-clear', '0px'); };
  });

  useEffect(() => {
    if (!isHub) return;
    const ring = () => chime([587, 784, 988]);
    addEventListener('hb-nudge', ring);
    return () => removeEventListener('hb-nudge', ring);
  }, [isHub]);

  if (!show || !nudges.length) return null;
  // On a locked hub, answering a time-to-leave nudge takes a parent's PIN (it stops escalation;
  // the server asks and the PIN pad opens). Anything else, anyone can clear.
  const needsPin = (n: Nudge) => n.kind === 'leave_by' && isHub && !f.session.canEdit;
  const answer = (id: number) => act(
    () => api<Nudge>(`/nudges/${id}/ack`, { method: 'POST' }),
    (n) => (f.byId(n.ackedBy) ? `${f.byId(n.ackedBy)!.name}’s got it` : 'Got it'),
  );
  // Screen readers hear the newest title once, not every banner's details on every change.
  const announce = <p className="sr-only" role="status">{splitTitle(nudges[0])[1]}{nudges.length > 1 ? `, and ${nudges.length - 1} more` : ''}</p>;

  if (kidScreen) return null;

  const look = night ? ' night' : ambient ? ' over-photo' : '';
  // A leave-by banner's ride, so it can keep time (and be ordered by when that ride has to go).
  const rideOf = (n: Nudge) => (n.kind === 'leave_by' ? occs.find((o) => o.driverId && occDate(o) === today && n.title.endsWith(`for ${o.title}`)) : undefined);
  const leaveAt = (n: Nudge) => { const o = rideOf(n); return o ? leaveBy(o) : Infinity; };
  // Time-to-leave first, the earliest (most overdue) leading; everything else newest first.
  const ordered = [...nudges].sort((a, b) => Number(b.kind === 'leave_by') - Number(a.kind === 'leave_by') || leaveAt(a) - leaveAt(b) || b.createdAt.localeCompare(a.createdAt));
  const rolled = narrow && !all && ordered.length > 1;
  const shown = rolled ? ordered.slice(0, 1) : ordered;
  return (
    <section ref={stack} className={`nudges${look}`} aria-label="Nudges">
      {announce}
      {shown.map((n) => {
        const [icon, written] = splitTitle(n);
        const ride = rideOf(n);
        const mins = ride ? leaveBy(ride) - nowMin : null;
        // A same-day reminder ("… in 15 min") keeps counting down too, instead of freezing when it fired.
        const soon = n.kind === 'reminder' && isSameDayReminder(n.title)
          ? occs.find((o) => !o.allDay && occDate(o) === today && n.title.startsWith(`${o.icon} ${o.title} `)) : undefined;
        const text = ride && mins !== null ? leaveByTitle(mins, ride.title) : soon ? startsInTitle(startAbs(today, soon) - nowMin, soon.title) : written;
        // Same steps as the timeline pill: amber for the first five minutes late, then red.
        const late = mins === null ? '' : Math.round(mins) <= -5 ? ' late' : Math.round(mins) < 0 ? ' late-soon' : '';
        const expanded = open === n.id;
        return (
          <div key={n.id} className={`nudge ${n.kind}${late}`}>
            <button className="nudge-main" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : n.id)}>
              <span className="nudge-ic" aria-hidden="true">{icon}</span>
              <span className="nudge-text">
                <b>{text}</b>
                {expanded && <span className="nudge-body">{n.body}<small>{ago(n.createdAt)}{n.kind === 'leave_by' ? ' · Got it stops the repeats, so it isn’t passed to the other parent.' : ''}</small></span>}
              </span>
              <span className="faces" aria-label={`For ${n.audience.map((id) => f.byId(id)?.name).filter(Boolean).join(' and ')}`}>
                {n.audience.map((id) => <Face key={id} m={f.byId(id)} size={24} />)}
              </span>
            </button>
            <button className="act" onClick={() => answer(n.id)} title={needsPin(n) ? 'A parent answers this with their PIN' : undefined}>
              {needsPin(n) && <span aria-hidden="true">🔒 </span>}Got it{needsPin(n) && <span className="sr-only"> (needs a parent’s PIN)</span>}
            </button>
          </div>
        );
      })}
      {narrow && ordered.length > 1 && (
        <button className="nudge-more" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? 'Show just the first' : `${ordered.length - 1} more nudge${ordered.length > 2 ? 's' : ''} ▾`}
        </button>
      )}
    </section>
  );
}

/** True on phone-width screens (matches the 520px breakpoint in styles.css). */
function useNarrow(): boolean {
  const q = '(max-width: 520px)';
  const [narrow, setNarrow] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

/** Kid mode's stand-in for the banners: a quiet note in its top row, with nothing for small hands to press. */
export function GrownUpsNote() {
  const f = useFamily();
  const isHub = f.session.kind === 'hub';
  const night = useNight() && isHub;
  const { data: nudges = [] } = useActiveNudges(isHub || f.me?.role === 'adult');
  if (!nudges.length) return null;
  return (
    <p className={`nudge-chip${night ? ' night' : ''}`} role="status">
      <span aria-hidden="true">🔔</span> {nudges.length === 1 ? 'A note' : `${nudges.length} notes`} for grown-ups
    </p>
  );
}

/** A parent's recent nudges, newest first. */
export function NudgeFeed({ memberId }: { memberId: number }) {
  const f = useFamily();
  const { data = [] } = useRecentNudges();
  const mine = data.filter((n) => n.audience.includes(memberId)).slice(0, 8);
  if (!mine.length) return <p className="note">No nudges this week.</p>;
  return (
    <div className="feed">
      {mine.map((n) => (
        <div key={n.id} className="feed-row">
          <div>
            <b>{n.title}</b>
            <div className="note">{n.body.split('\n')[0]}</div>
          </div>
          <span className="note" style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
            {ago(n.createdAt)}
            <br />
            {n.ackedAt ? `✓ ${f.byId(n.ackedBy)?.name ?? 'Hub'}` : Date.parse(n.expiresAt) > Date.now() ? 'Waiting' : ''}
          </span>
        </div>
      ))}
    </div>
  );
}
