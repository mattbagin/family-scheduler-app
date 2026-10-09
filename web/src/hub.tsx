import { eveningBoardDay, inQuietHours, weatherLook, type Ymd } from '@shared';
import { useNow } from './context.tsx';
import { useHub, useWeather } from './queries.ts';

/** Whether the hub's night mode is on right now (it dims deeply and stays quiet). */
export function useNight(): boolean {
  const { data: hub } = useHub();
  const { nowMin } = useNow();
  return !!hub?.night && inQuietHours({ quietStart: hub.nightStart, quietEnd: hub.nightEnd }, Math.floor(nowMin));
}

/** The day the hub's Tomorrow board shows right now, or null outside the evening (see eveningBoardDay). */
export function useBoardDay(): Ymd | null {
  const { data: hub } = useHub();
  const { today, nowMin } = useNow();
  return hub ? eveningBoardDay(today, Math.floor(nowMin), hub) : null;
}

/** Now and today's high and low, for the Today board and the ambient screen. Hidden until a home location is set. */
export function WeatherNow({ className = '' }: { className?: string }) {
  const { data: w } = useWeather();
  if (!w?.days.length) return null;
  const day = w.days[0];
  const look = weatherLook(w.now.code, w.now.isDay);
  const rain = day.rainChance >= 30 ? `${day.rainChance}% rain` : '';
  return (
    <div className={`weather ${className}`} role="group" aria-label={`Weather in ${w.place}`}>
      <span className="wx-ic" aria-hidden="true">{look.icon}</span>
      <b className="wx-temp num">{w.now.temp}°</b>
      <span className="wx-text">
        {look.text}
        <small className="num">High {day.hi}° · Low {day.lo}°{rain && ` · ${rain}`}</small>
      </span>
    </div>
  );
}
