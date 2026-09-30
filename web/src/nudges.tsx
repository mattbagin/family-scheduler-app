import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { Nudge } from '@shared';
import { api } from './api.ts';
import { useAction, useFamily } from './context.tsx';
import { ago } from './lib.ts';
import { chime } from './ui.tsx';

export const useActiveNudges = (enabled: boolean) =>
  useQuery({ queryKey: ['nudges', 'active'], queryFn: () => api<Nudge[]>('/nudges/active'), enabled, refetchInterval: 60_000 });
export const useRecentNudges = () => useQuery({ queryKey: ['nudges', 'recent'], queryFn: () => api<Nudge[]>('/nudges') });

/**
 * Banners for nudges nobody has answered yet, on the hub (even over the ambient screen) and on
 * parents' screens. The hub also plays a soft chime when one arrives.
 */
export function NudgeBanners() {
  const f = useFamily();
  const act = useAction();
  const isHub = f.session.kind === 'hub';
  const show = isHub || f.me?.role === 'adult';
  const { data: nudges = [] } = useActiveNudges(show);

  useEffect(() => {
    if (!isHub) return;
    const ring = () => chime([587, 784, 988]);
    addEventListener('hb-nudge', ring);
    return () => removeEventListener('hb-nudge', ring);
  }, [isHub]);

  if (!show || !nudges.length) return null;
  return (
    <div className="nudges" role="status" aria-live="polite">
      {nudges.map((n) => (
        <div key={n.id} className={`nudge ${n.kind}`}>
          <div className="nudge-text">
            <b>{n.title}</b>
            <p>{n.body}</p>
          </div>
          <button className="act" onClick={() => act(() => api(`/nudges/${n.id}/ack`, { method: 'POST' }))}>Got it</button>
        </div>
      ))}
    </div>
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
