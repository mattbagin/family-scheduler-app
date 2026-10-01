import { useEffect, useMemo, useState } from 'react';
import { fmtTime } from '@shared';
import { namesOf, useFamily, useNow } from '../context.tsx';
import { useNight, WeatherNow } from '../hub.tsx';
import { mainRange, personItems } from '../lib.ts';
import { useHub, useOccurrences, usePhotos } from '../queries.ts';
import { Avatar } from '../ui.tsx';

/** Color scenes for when there's no photo folder yet. */
const SCENES = [
  'radial-gradient(120% 90% at 20% 20%, #ffd59e 0%, #f29a6b 40%, #6b3f63 100%)',
  'radial-gradient(120% 90% at 80% 30%, #bfeee4 0%, #3aa6a0 45%, #123a4f 100%)',
  'radial-gradient(120% 90% at 40% 70%, #e7f5b8 0%, #79b85a 45%, #1f4230 100%)',
];
const PHOTO_MS = 12_000;
const SCENE_MS = 9_000;

const photoUrl = (p: string) => `/api/photos/file?p=${encodeURIComponent(p)}`;

function shuffled<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The family's photos in a shuffled loop. Each one is loaded before it fades in, so there's never a blank frame. */
function Photos({ photos }: { photos: string[] }) {
  const order = useMemo(() => shuffled(photos), [photos]);
  const [shown, setShown] = useState<{ n: number; src: string }[]>([]);
  useEffect(() => {
    let n = 0;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const show = () => {
      const src = photoUrl(order[n % order.length]);
      const img = new Image();
      const next = () => {
        if (stopped) return;
        timer = setTimeout(show, PHOTO_MS);
      };
      img.onload = () => {
        if (stopped) return;
        const key = n;
        setShown((s) => [...s.slice(-1), { n: key, src }]);
        n++;
        next();
      };
      img.onerror = () => { n++; if (!stopped) timer = setTimeout(show, 500); };
      img.src = src;
    };
    show();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [order]);
  return (
    <>
      {shown.map((p) => (
        <div key={p.n} className="photo">
          <img className="ph-bg" src={p.src} alt="" />
          <img className="ph-fg" src={p.src} alt="" />
        </div>
      ))}
    </>
  );
}

function Scenes() {
  const [scene, setScene] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setScene((s) => (s + 1) % SCENES.length), SCENE_MS);
    return () => clearInterval(t);
  }, []);
  return <>{SCENES.map((s, i) => <div key={s} className={`scene ${i === scene ? 'on' : ''}`} style={{ background: s }} />)}</>;
}

/**
 * The hub's idle screen: the family's photos (or color scenes) with the clock, the weather and
 * everyone's next thing. At night it turns into a dim bedside clock. Tap to wake.
 */
export function Ambient({ onWake }: { onWake: () => void }) {
  const f = useFamily();
  const { now, today, nowMin } = useNow();
  const range = mainRange(today);
  const { data: occs = [] } = useOccurrences(range.from, range.to);
  const { data: hub } = useHub();
  const { data: photos = [] } = usePhotos(!!hub?.photoDir);
  const night = useNight();
  const h = now.getHours();

  return (
    <button className={`ambient ${night ? 'night' : ''}`} onClick={onWake} aria-label="Wake the screen">
      {!night && (photos.length ? <Photos photos={photos} /> : <Scenes />)}
      <div className="amb-shade" />
      <div className="amb-content">
        <div className="amb-top">
          <div>
            <div className="amb-clock num">{h % 12 || 12}:{String(now.getMinutes()).padStart(2, '0')}<small>{h >= 12 ? 'PM' : 'AM'}</small></div>
            <div className="amb-date">{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          </div>
          <WeatherNow className="amb-weather" />
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
                    {next ? `${next.drive ? `🚗 Drive ${namesOf(f, next.occ.memberIds)}` : `${next.occ.icon} ${next.occ.title}`} · ${fmtTime(next.s)}` : night ? 'Sleep well' : 'All done today'}
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
