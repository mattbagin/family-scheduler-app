import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { MEMBER_AVATARS, MEMBER_COLORS, type Bootstrap, type Member, type Role } from '@shared';
import { api, errorText } from '../api.ts';
import { PinPad } from '../sheets/PinPad.tsx';
import { Avatar, pc } from '../ui.tsx';

/** "Who's using Homebase?" Kids tap their face; parents enter a PIN. */
export function Login({ boot }: { boot: Bootstrap }) {
  const qc = useQueryClient();
  const [who, setWho] = useState<Member | null>(null);
  const [asHub, setAsHub] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const adults = boot.members.filter((m) => m.role === 'adult');

  const login = async (m: Member, pin?: string, hub = false) => {
    try {
      await api('/login', { method: 'POST', body: { memberId: m.id, pin, asHub: hub } });
      await qc.invalidateQueries();
      return null;
    } catch (e) {
      return errorText(e);
    }
  };
  const pick = async (m: Member) => {
    setError(null);
    if (m.role === 'adult' || m.hasPin) setWho(m);
    else setError(await login(m));
  };

  return (
    <div className="center-page">
      <div className="welcome">
        {who ? (
          <>
            <PinPad member={who} onSubmit={(pin) => login(who, pin, asHub)} />
            <button className="link-btn" onClick={() => { setWho(null); setAsHub(false); }}>← Someone else</button>
          </>
        ) : asHub ? (
          <>
            <h1>Set up the family hub</h1>
            <p className="note">This device will show everyone’s schedule. A parent confirms with their PIN, and kids can still tick off their jobs.</p>
            <div className="profile-grid">
              {adults.map((m) => <button key={m.id} className="profile" style={pc(m.color)} onClick={() => setWho(m)}><Avatar m={m} />{m.name}</button>)}
            </div>
            <button className="link-btn" onClick={() => setAsHub(false)}>← Back</button>
          </>
        ) : (
          <>
            <h1>Who’s using {boot.familyName}’s Homebase?</h1>
            <div className="profile-grid">
              {boot.members.map((m) => <button key={m.id} className="profile" style={pc(m.color)} onClick={() => pick(m)}><Avatar m={m} />{m.name}</button>)}
              <button className="profile hub" onClick={() => setAsHub(true)}><span className="avatar">🏡</span>Family hub</button>
            </div>
            {error && <div className="error" role="alert">{error}</div>}
            <p className="note">Pick <b>Family hub</b> on the shared tablet or laptop in the kitchen.</p>
          </>
        )}
      </div>
    </div>
  );
}

interface DraftMember { name: string; role: Role; avatar: string; color: string; pin: string }

/** First run: create the family, or try the app with a sample family. */
export function Setup() {
  const qc = useQueryClient();
  const [familyName, setFamilyName] = useState('');
  const [members, setMembers] = useState<DraftMember[]>([
    { name: '', role: 'adult', avatar: '👩', color: MEMBER_COLORS[0], pin: '' },
    { name: '', role: 'adult', avatar: '👨', color: MEMBER_COLORS[1], pin: '' },
    { name: '', role: 'kid', avatar: '👧', color: MEMBER_COLORS[2], pin: '' },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const update = (i: number, patch: Partial<DraftMember>) => setMembers(members.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  const submit = async (sample: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const body = sample ? { sample: true } : {
        familyName: familyName.trim(),
        members: members.filter((m) => m.name.trim()).map((m) => ({
          name: m.name.trim(), role: m.role, avatar: m.avatar, color: m.color, ...(m.pin ? { pin: m.pin } : {}),
        })),
      };
      await api('/setup', { method: 'POST', body });
      await qc.invalidateQueries();
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(false);
  };

  return (
    <div className="center-page">
      <div className="welcome">
        <h1>Welcome to Homebase 🏡</h1>
        <p>One place for school, sports, playdates, chores, bills and everything else your family has going on.</p>
        <button className="icon-btn" onClick={() => submit(true)} disabled={busy}>Just looking? Try it with a sample family</button>

        <form className="panel form" style={{ width: '100%', textAlign: 'left' }} onSubmit={(e) => { e.preventDefault(); submit(false); }}>
          <h2>Set up your family</h2>
          <label className="field">Family name<input id="setup-family" value={familyName} onChange={(e) => setFamilyName(e.target.value)} placeholder="The Parkers" required maxLength={60} /></label>
          {members.map((m, i) => (
            <div key={i} className="member-editor" style={pc(m.color)}>
              <span className="avatar" style={{ width: 56, height: 56, fontSize: 30 }}>{m.avatar}</span>
              <div className="stack" style={{ gap: 10 }}>
                <div className="form-grid">
                  <label className="field">Name<input id={`setup-name-${i}`} value={m.name} onChange={(e) => update(i, { name: e.target.value })} maxLength={40} placeholder={m.role === 'adult' ? 'Mom' : 'Emma'} /></label>
                  <label className="field">Role
                    <select id={`setup-role-${i}`} value={m.role} onChange={(e) => update(i, { role: e.target.value as Role })}>
                      <option value="adult">Parent</option><option value="kid">Kid</option>
                    </select>
                  </label>
                  {m.role === 'adult' && (
                    <label className="field">PIN (4–8 digits)
                      <input id={`setup-pin-${i}`} inputMode="numeric" pattern="\d{4,8}" value={m.pin} onChange={(e) => update(i, { pin: e.target.value.replace(/\D/g, '') })} maxLength={8} required={!!m.name.trim()} />
                    </label>
                  )}
                </div>
                <div className="emoji-grid">{MEMBER_AVATARS.slice(0, 12).map((a) => <button type="button" key={a} aria-pressed={m.avatar === a} onClick={() => update(i, { avatar: a })}>{a}</button>)}</div>
                <div className="swatches">{MEMBER_COLORS.map((c) => <button type="button" key={c} className="swatch" style={{ background: c }} aria-pressed={m.color === c} aria-label={`Color ${c}`} onClick={() => update(i, { color: c })} />)}</div>
                {members.length > 1 && <button type="button" className="link-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setMembers(members.filter((_, j) => j !== i))}>Remove</button>}
              </div>
            </div>
          ))}
          <button type="button" className="icon-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setMembers([...members, {
            name: '', role: 'kid', avatar: MEMBER_AVATARS[(members.length + 2) % 12], color: MEMBER_COLORS[members.length % MEMBER_COLORS.length], pin: '',
          }])}>+ Add someone</button>
          {error && <div className="error" role="alert">{error}</div>}
          <div className="row-end"><button className="primary" disabled={busy}>Create our Homebase</button></div>
        </form>
      </div>
    </div>
  );
}
