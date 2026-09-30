import { useEffect, useState } from 'react';
import { fmtTime } from '@shared';
import { namesOf, useFamily, useNow } from '../context.tsx';
import { mainRange, personItems } from '../lib.ts';
import { useOccurrences } from '../queries.ts';
import { Avatar } from '../ui.tsx';

// Placeholder scenes until the family photo folder arrives (milestone 5).
const SCENES = [
  'radial-gradient(120% 90% at 20% 20%, #ffd59e 0%, #f29a6b 40%, #6b3f63 100%)',
  'radial-gradient(120% 90% at 80% 30%, #bfeee4 0%, #3aa6a0 45%, #123a4f 100%)',
  'radial-gradient(120% 90% at 40% 70%, #e7f5b8 0%, #79b85a 45%, #1f4230 100%)',
];

/** The hub's idle screen: a slow slideshow with the clock and everyone's next thing. Tap to wake. */
export function Ambient({ onWake }: { onWake: () => void }) {
  const f = useFamily();
  const { now, today, nowMin } = useNow();
  const range = mainRange(today);
  const { data: occs = [] } = useOccurrences(range.from, range.to);
  const [scene, setScene] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setScene((s) => (s + 1) % SCENES.length), 9000);
    return () => clearInterval(t);
  }, []);
  const h = now.getHours();
  const dim = nowMin >= 21 * 60 || nowMin < 6.5 * 60;

  return (
    <button className={`ambient ${dim ? 'dim' : ''}`} onClick={onWake} aria-label="Wake the screen">
      {SCENES.map((s, i) => <div key={s} className={`scene ${i === scene ? 'on' : ''}`} style={{ background: s }} />)}
      <div className="amb-shade" />
      <div className="amb-content">
        <div>
          <div className="amb-clock num">{h % 12 || 12}:{String(now.getMinutes()).padStart(2, '0')}<small>{h >= 12 ? 'PM' : 'AM'}</small></div>
          <div className="amb-date">{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        </div>
        <div className="amb-people">
          {f.members.map((m) => {
            const next = personItems(today, occs, m.id).find((i) => i.e > nowMin && !i.occ.allDay && i.occ.category !== 'work' && i.s < 1440);
            return (
              <div key={m.id} className="amb-p">
                <Avatar m={m} />
                <div>
                  {m.name}
                  <small>
                    {next ? `${next.drive ? `🚗 Drive ${namesOf(f, next.occ.memberIds)}` : `${next.occ.icon} ${next.occ.title}`} · ${fmtTime(next.s)}` : 'All done today'}
                  </small>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </button>
  );
}
