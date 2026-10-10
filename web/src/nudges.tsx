import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { leaveByTitle, type Nudge, type NudgeKind } from '@shared';
import { api } from './api.ts';
import { useAction, useFamily, useNow } from './context.tsx';
import { ago, leaveBy, mainRange, occDate } from './lib.ts';
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

  useEffect(() => {
    if (!isHub) return;
    const ring = () => chime([587, 784, 988]);
    addEventListener('hb-nudge', ring);
    return () => removeEventListener('hb-nudge', ring);
  }, [isHub]);

  if (!show || !nudges.length) return null;
  // On a locked hub, answering takes a parent's PIN (the server asks; the PIN pad opens).
  const needsPin = isHub && !f.session.canEdit;
  const answer = (id: number) => act(
    () => api<Nudge>(`/nudges/${id}/ack`, { method: 'POST' }),
    (n) => (f.byId(n.ackedBy) ? `${f.byId(n.ackedBy)!.name}’s got it` : 'Got it'),
  );
  // Screen readers hear the newest title once, not every banner's details on every change.
  const announce = <p className="sr-only" role="status">{splitTitle(nudges[0])[1]}</p>;

  if (kidScreen) return null;

  const look = night ? ' night' : ambient ? ' over-photo' : '';
  return (
    <section className={`nudges${look}`} aria-label="Nudges">
      {announce}
      {nudges.map((n) => {
        const [icon, written] = splitTitle(n);
        const ride = n.kind === 'leave_by' ? occs.find((o) => o.driverId && occDate(o) === today && n.title.endsWith(`for ${o.title}`)) : undefined;
        const mins = ride ? leaveBy(ride) - nowMin : null;
        const text = ride && mins !== null ? leaveByTitle(mins, ride.title) : written;
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
            <button className="act" onClick={() => answer(n.id)} title={needsPin ? 'A parent answers this with their PIN' : undefined}>
              {needsPin && <span aria-hidden="true">🔒 </span>}Got it{needsPin && <span className="sr-only"> (needs a parent’s PIN)</span>}
            </button>
          </div>
        );
      })}
    </section>
  );
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
