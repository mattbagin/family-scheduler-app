import { addDays, computeFlags, dayDiff, fmtTime, minutesOf, parseYmd, weatherLook, type Occurrence, type Ymd } from '@shared';
import { namesOf, useFamily, useNow } from '../context.tsx';
import { useBoardDay, useNight } from '../hub.tsx';
import { leaveBy, mainRange, occDate } from '../lib.ts';
import { useOccurrences, usePrep, useWeather } from '../queries.ts';
import { EventSheet, useSetDriver } from '../sheets/EventSheet.tsx';
import { PrepList } from '../todos.tsx';
import { Face, pc, useSheets } from '../ui.tsx';

/**
 * The evening run-sheet for parents: when the first person has to be out the door, what still
 * needs sorting (a ride with no driver is fixed right here), who goes where, and the packing.
 * On the hub it stands in for Today in the evening; phones open it at /tomorrow.
 */
export function Tomorrow({ day: shown }: { day?: Ymd }) {
  const f = useFamily();
  const sheets = useSheets();
  const setDriver = useSetDriver();
  const { today, nowMin } = useNow();
  const evening = useBoardDay();
  const day = shown ?? evening ?? addDays(today, 1);
  // After night mode starts the hub dims the whole screen to the bedside amber.
  const night = useNight() && f.session.kind === 'hub';
  const range = mainRange(today);
  const { data: occs = [] } = useOccurrences(range.from, range.to);
  const { data: prep = [] } = usePrep(today, addDays(today, 2), nowMin);
  const { data: weather } = useWeather();

  const items = occs.filter((o) => occDate(o) === day && o.category !== 'work').sort((a, b) => (a.start < b.start ? -1 : 1));
  const allDay = items.filter((o) => o.allDay);
  const timed = items.filter((o) => !o.allDay);
  const flags = computeFlags(items, f.members);
  const adults = f.members.filter((m) => m.role === 'adult');
  const firstOut = timed.filter((o) => o.travelMin > 0).sort((a, b) => leaveBy(a) - leaveBy(b))[0];
  const gaps = timed.filter((o) => o.needsDriver && o.driverId === null);
  const clashes = timed.filter((o) => flags.get(o.key)?.some((x) => x.kind === 'bad'));
  const packing = prep.filter((p) => p.date === day);
  const wx = weather?.days.find((d) => d.date === day);
  const look = wx && weatherLook(wx.code);
  const name = day === today ? 'Today' : dayDiff(today, day) === 1 ? 'Tomorrow' : parseYmd(day).toLocaleDateString(undefined, { weekday: 'long' });
  const open = (o: Occurrence) => sheets.open(<EventSheet occ={o} />);
  const who = (ids: number[]) => namesOf(f, ids);

  return (
    <div className={`tb${night ? ' night' : ''}`}>
      <div className="tb-left">
        <header className="tb-head">
          <div>
            <h1>{name}</h1>
            <div className="dateline">{parseYmd(day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          </div>
          {wx && look && (
            <div className="weather" title={look.text}>
              <span className="wx-ic" aria-hidden="true">{look.icon}</span>
              <span className="wx-text"><span className="num">{wx.hi}° / {wx.lo}°</span><small>{look.text}{wx.rainChance >= 30 ? ` · ${wx.rainChance}% rain` : ''}</small></span>
            </div>
          )}
        </header>

        <FirstOut o={firstOut} first={timed[0]} />

        {timed.length > 0 && (
          <section className={`panel tb-sort${gaps.length || clashes.length ? '' : ' all-set'}`} aria-label="Needs sorting">
            {gaps.length || clashes.length ? (
              <>
                <h2>Needs sorting</h2>
                {gaps.map((o) => (
                  <div key={o.key} className="tb-gap">
                    <span className="e" aria-hidden="true">{o.icon}</span>
                    <div className="tb-gap-main">
                      <b>Who’s driving {who(o.memberIds)} to {o.title}?</b>
                      <span className="note">Starts {fmtTime(minutesOf(o.start))}{o.travelMin ? ` · leave by ${fmtTime(leaveBy(o))}` : ''}</span>
                    </div>
                    <div className="toggles" role="group" aria-label={`Driver for ${o.title}`}>
                      {adults.map((m) => (
                        <button key={m.id} className="tog" style={pc(m.color)} onClick={() => setDriver(o, m.id)}>
                          <Face m={m} />{m.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {clashes.map((o) => (
                  <button key={o.key} className="tb-clash" onClick={() => open(o)}>
                    <span className="pill bad">{flags.get(o.key)!.find((x) => x.kind === 'bad')!.text}</span>
                    <span><b>{o.title}</b> <span className="note">{fmtTime(minutesOf(o.start))}–{fmtTime(minutesOf(o.end))}</span></span>
                    <span className="note" aria-hidden="true">Open →</span>
                  </button>
                ))}
              </>
            ) : (
              <p className="tb-allset"><span className="tb-star" aria-hidden="true">★</span> All set for {name === 'Today' || name === 'Tomorrow' ? name.toLowerCase() : name}</p>
            )}
          </section>
        )}
      </div>

      <div className="tb-right">
        <section className="panel">
          <h2>Who’s going where</h2>
          {allDay.length > 0 && (
            <div className="allday">
              {allDay.map((o) => (
                <button key={o.key} className="pill muted" onClick={() => open(o)}><span aria-hidden="true">{o.icon}</span> {o.title}</button>
              ))}
            </div>
          )}
          {timed.length ? (
            <div className="tb-list">
              {timed.map((o) => {
                const driver = f.byId(o.driverId);
                const bad = flags.get(o.key)?.find((x) => x.kind === 'bad');
                return (
                  <button key={o.key} className={`tb-row${o.memberIds.length === 1 ? ' solo' : ''}`} style={pc(f.byId(o.memberIds[0])?.color)} onClick={() => open(o)}>
                    <span className="tb-row-time num">{fmtTime(minutesOf(o.start))}</span>
                    <span className="e" aria-hidden="true">{o.icon}</span>
                    <span className="tb-row-main">
                      <b>{o.title}</b>
                      {(o.location || o.bring) && (
                        <span className="note">
                          {o.location && <><span aria-hidden="true">📍</span> {o.location}</>}
                          {o.location && o.bring && ' · '}
                          {o.bring && <><span aria-hidden="true">🎒</span> {o.bring}</>}
                        </span>
                      )}
                      {bad && <span className="pill bad">{bad.text}</span>}
                    </span>
                    <span className="faces">{o.memberIds.map((id) => <Face key={id} m={f.byId(id)} />)}</span>
                    <span className="tb-ride">
                      {driver ? (
                        <><span aria-hidden="true">🚗</span><Face m={driver} size={24} />{o.travelMin > 0 && <span className="num">{fmtTime(leaveBy(o))}</span>}</>
                      ) : o.needsDriver ? <span className="pill warn"><span aria-hidden="true">🚗</span> Needs a ride</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : <p className="empty">Nothing planned. A slow morning <span aria-hidden="true">☕</span></p>}
        </section>

        {packing.length > 0 && (
          <section className="panel">
            <h2><span aria-hidden="true">🎒</span> Packing</h2>
            <PrepList items={packing} dayLabels={false} />
          </section>
        )}
      </div>
    </div>
  );
}

/** The thesis of the board: the first moment someone has to be out the door, at clock size. */
function FirstOut({ o, first }: { o?: Occurrence; first?: Occurrence }) {
  const f = useFamily();
  const who = (ids: number[]) => namesOf(f, ids);
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
  if (!o && !first) return null;
  if (!o) {
    return (
      <section className="tb-hero">
        <span className="tb-time num">{fmtTime(minutesOf(first!.start))}</span>
        <p><b>First up: {first!.title}</b><span className="note">{cap(who(first!.memberIds))} · no driving needed</span></p>
      </section>
    );
  }
  const driver = f.byId(o.driverId);
  return (
    <section className="tb-hero" style={pc(driver?.color)}>
      <span className="tb-time num">{fmtTime(leaveBy(o))}</span>
      <p>
        <b>{driver ? <><Face m={driver} size={44} /> {driver.name} leaves for {o.title}</> : <>Leave for {o.title}: no driver yet</>}</b>
        <span className="note"><span aria-hidden="true">{o.icon}</span> {cap(who(o.memberIds))} · starts {fmtTime(minutesOf(o.start))} · {o.travelMin} min drive</span>
      </p>
    </section>
  );
}
