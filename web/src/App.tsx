import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import type { Bootstrap } from '@shared';
import { api, errorText, onSignedOut, onUnlockNeeded } from './api.ts';
import { FamilyProvider, useAction, useFamily } from './context.tsx';
import { useBoardDay, useNight } from './hub.tsx';
import { NudgeBanners } from './nudges.tsx';
import { useBootstrap, useLiveSync } from './queries.ts';
import { UnlockSheet } from './sheets/PinPad.tsx';
import { QuickAdd } from './sheets/QuickAdd.tsx';
import { Avatar, setHushed, setMuted, SheetProvider, useMuted, useSheets } from './ui.tsx';
import { Ambient } from './views/Ambient.tsx';
import { Tomorrow } from './views/Tomorrow.tsx';
import { Kid } from './views/Kid.tsx';
import { Month } from './views/Month.tsx';
import { Person } from './views/Person.tsx';
import { Settings } from './views/Settings.tsx';
import { Login, Setup } from './views/SignIn.tsx';
import { Today } from './views/Today.tsx';
import { Week } from './views/Week.tsx';

/** The shared hub drops into the ambient screen after this long without a touch. */
const IDLE_MS = 2 * 60 * 1000;

export function App() {
  const boot = useBootstrap();
  const qc = useQueryClient();
  if (boot.isPending) return <div className="center-page"><p className="empty">Loading…</p></div>;
  if (boot.error) {
    return (
      <div className="center-page">
        <div className="welcome">
          <h1>Can’t reach Homebase</h1>
          <p>{errorText(boot.error)}</p>
          <button className="primary" onClick={() => qc.invalidateQueries()}>Try again</button>
        </div>
      </div>
    );
  }
  const b = boot.data;
  if (b.needsSetup) return <Setup />;
  if (!b.session) return <Login boot={b} />;
  return <SignedIn boot={b} />;
}

function SignedIn({ boot }: { boot: Bootstrap }) {
  const value = useMemo(() => ({ familyName: boot.familyName, members: boot.members, session: boot.session! }), [boot]);
  return (
    <FamilyProvider value={value}>
      <SheetProvider>
        <Shell />
      </SheetProvider>
    </FamilyProvider>
  );
}

function Shell() {
  const f = useFamily();
  const sheets = useSheets();
  const qc = useQueryClient();
  const act = useAction();
  const location = useLocation();
  const connected = useLiveSync(true);
  const [ambient, setAmbient] = useState(false);
  const muted = useMuted();
  const night = useNight();
  const isHub = f.session.kind === 'hub';

  // The hub stays quiet during night mode.
  useEffect(() => setHushed(isHub && night), [isHub, night]);

  // Server says a parent must unlock: show the PIN sheet on top of whatever is open.
  useEffect(() => {
    onUnlockNeeded(() => new Promise<boolean>((resolve) => {
      sheets.open(<UnlockSheet onDone={(ok) => { sheets.close(); resolve(ok); }} />);
    }));
    onSignedOut(() => qc.invalidateQueries({ queryKey: ['bootstrap'] }));
  }, [sheets, qc]);

  // Re-check the lock when the 10-minute unlock runs out.
  useEffect(() => {
    if (!f.session.elevatedUntil) return;
    const t = setTimeout(() => qc.invalidateQueries({ queryKey: ['bootstrap'] }), f.session.elevatedUntil - Date.now() + 500);
    return () => clearTimeout(t);
  }, [f.session.elevatedUntil, qc]);

  // The hub goes ambient when nobody has touched it for a while.
  useEffect(() => {
    if (f.session.kind !== 'hub' || location.pathname !== '/') return;
    let last = Date.now();
    const bump = () => { last = Date.now(); };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((e) => addEventListener(e, bump, { passive: true }));
    const t = setInterval(() => {
      if (Date.now() - last > IDLE_MS && !document.querySelector('.scrim')) setAmbient(true);
    }, 5000);
    return () => {
      clearInterval(t);
      events.forEach((e) => removeEventListener(e, bump));
    };
  }, [f.session.kind, location.pathname]);

  const isKidScreen = location.pathname.startsWith('/kid');
  // In the evening the hub's Today becomes the Tomorrow board, until night mode ends.
  const evening = useBoardDay();
  const boardDay = isHub ? evening : null;
  const unlocked = !!f.session.elevatedUntil;
  const showLock = !(f.session.kind === 'member' && f.me?.role === 'adult');

  return (
    <div className="app">
      <a className="skip" href="#main">Skip to the main content</a>
      {!connected && <div className="offline" role="status">Reconnecting to the home server…</div>}
      <NudgeBanners ambient={ambient} night={isHub && night} />
      {/* Kid mode is a space of its own: no parent tabs, settings or PIN button (Kid has its own way out). */}
      {!isKidScreen && <header className="top">
        <Link to="/" className="brand"><b>Homebase</b><span>{f.familyName}</span></Link>
        <nav className="tabs" aria-label="Views">
          <NavLink to="/" end>{boardDay ? 'Tomorrow' : 'Today'}</NavLink>
          <NavLink to="/week">Week</NavLink>
          <NavLink to="/month">Month</NavLink>
          <NavLink to="/kid">Kid mode</NavLink>
          <button className="amb-tab" onClick={() => setAmbient(true)}>Ambient</button>
        </nav>
        <div className="top-right">
          {isHub && (
            <button className="icon-btn" onClick={() => setMuted(!muted)} aria-pressed={muted} title={muted ? 'Sounds are off. Tap to turn them on.' : 'Turn sounds off on this screen'}>
              {muted ? '🔕' : '🔔'}<span className="sr-only">{muted ? 'Sounds off' : 'Sounds on'}</span>
            </button>
          )}
          {showLock && (unlocked ? (
            <button className="icon-btn lock-on" onClick={() => act(() => api('/lock', { method: 'POST' }), 'Locked')} title="Lock editing"><span aria-hidden="true">🔓</span><span className="btn-word"> Unlocked</span></button>
          ) : (
            <button className="icon-btn" onClick={() => sheets.open(<UnlockSheet onDone={() => sheets.close()} />)} title="A parent can unlock editing"><span aria-hidden="true">🔒</span><span className="btn-word"> Parent unlock</span></button>
          ))}
          <NavLink to="/settings" className="icon-btn" aria-label="Settings">⚙️</NavLink>
          {f.me ? <Link to={`/person/${f.me.id}`} aria-label={`${f.me.name}’s page`}><Avatar m={f.me} /></Link> : <span className="hub-tag" title="This device is the family hub"><span aria-hidden="true">🏡</span><span className="btn-word"> Hub</span></span>}
        </div>
      </header>}

      <main className="stack" id="main" tabIndex={-1}>
        <Routes>
          <Route path="/" element={boardDay ? <Tomorrow day={boardDay} /> : <Today />} />
          <Route path="/tomorrow" element={<Tomorrow />} />
          <Route path="/week" element={<Week />} />
          <Route path="/month" element={<Month />} />
          <Route path="/person/:id" element={<Person />} />
          <Route path="/kid" element={<Kid />} />
          <Route path="/kid/:id" element={<Kid />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {!isKidScreen && <button className="fab" onClick={() => sheets.open(<QuickAdd />)} aria-label="Add an event or plan">+</button>}
      {ambient && <Ambient onWake={() => setAmbient(false)} />}
    </div>
  );
}
