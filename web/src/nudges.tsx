import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { Nudge, NudgeKind } from '@shared';
import { api } from './api.ts';
import { useAction, useFamily } from './context.tsx';
import { ago } from './lib.ts';
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
 * amber, and on kid screens it shrinks to a quiet chip with nothing for small hands to press.
 */
export function NudgeBanners({ ambient = false, night = false }: { ambient?: boolean; night?: boolean }) {
  const f = useFamily();
  const act = useAction();
  const isHub = f.session.kind === 'hub';
  const show = isHub || f.me?.role === 'adult';
  const { data: nudges = [] } = useActiveNudges(show);
  const [open, setOpen] = useState<number | null>(null);
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

  if (kidScreen) {
    return (
      <div className={`nudges kid-chip${night ? ' night' : ''}`}>
        {announce}
        <p className="nudge-chip"><span aria-hidden="true">🔔</span> {nudges.length === 1 ? 'A note' : `${nudges.length} notes`} for grown-ups</p>
      </div>
    );
  }

  const look = night ? ' night' : ambient ? ' over-photo' : '';
  return (
    <section className={`nudges${look}`} aria-label="Nudges">
      {announce}
      {nudges.map((n) => {
        const [icon, text] = splitTitle(n);
        const expanded = open === n.id;
        return (
          <div key={n.id} className={`nudge ${n.kind}`}>
            <button className="nudge-main" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : n.id)}>
              <span className="nudge-ic" aria-hidden="true">{icon}</span>
              <span className="nudge-text">
                <b>{text}</b>
                {expanded && <span className="nudge-body">{n.body}<small>{ago(n.createdAt)}</small></span>}
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
