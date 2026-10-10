import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { Member } from '@shared';
import { api, errorText } from '../api.ts';
import { useFamily } from '../context.tsx';
import { Avatar, pc, Sheet } from '../ui.tsx';

/** Big-button PIN entry for touch screens; also accepts the keyboard. */
export function PinPad({ member, onSubmit }: { member: Member; onSubmit: (pin: string) => Promise<string | null> }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (value = pin) => {
    if (value.length < 4 || busy) return;
    setBusy(true);
    const err = await onSubmit(value);
    setBusy(false);
    if (err) {
      setError(err);
      setShake(true);
      setPin('');
      setTimeout(() => setShake(false), 400);
    }
  };
  const press = (d: string) => {
    setError(null);
    setPin((p) => (p.length < 8 ? p + d : p));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
      else if (e.key === 'Enter') submit();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  return (
    <div className={`pinpad ${shake ? 'shake' : ''}`} style={pc(member.color)}>
      <Avatar m={member} className="xl" />
      <b style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-title)' }}>{member.name}, enter your PIN</b>
      <div className="pin-dots" role="status" aria-label={`${pin.length} digits entered`}>
        {Array.from({ length: Math.max(4, pin.length) }, (_, i) => <i key={i} className={i < pin.length ? 'on' : ''} />)}
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} onClick={() => press(d)}>{d}</button>)}
        <button onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Delete digit">⌫</button>
        <button onClick={() => press('0')}>0</button>
        <button onClick={() => submit()} disabled={pin.length < 4 || busy} aria-label="Done" style={{ background: 'var(--btn)', color: 'var(--btn-ink)' }}>✓</button>
      </div>
    </div>
  );
}

/** Asks a parent for their PIN to unlock editing on the hub or a kid's device for 10 minutes. */
export function UnlockSheet({ onDone }: { onDone: (ok: boolean) => void }) {
  const f = useFamily();
  const qc = useQueryClient();
  const adults = f.members.filter((m) => m.role === 'adult' && m.hasPin);
  const [who, setWho] = useState<Member | null>(adults.length === 1 ? adults[0] : null);
  return (
    <Sheet title="A parent needs to unlock this" sub="Editing stays unlocked for 10 minutes." onClose={() => onDone(false)}>
      {!who ? (
        <div className="toggles" style={{ justifyContent: 'center' }}>
          {adults.map((m) => (
            <button key={m.id} className="profile" style={pc(m.color)} onClick={() => setWho(m)}>
              <Avatar m={m} />{m.name}
            </button>
          ))}
        </div>
      ) : (
        <PinPad
          member={who}
          onSubmit={async (pin) => {
            try {
              await api('/unlock', { method: 'POST', body: { memberId: who.id, pin } });
              await qc.invalidateQueries({ queryKey: ['bootstrap'] });
              onDone(true);
              return null;
            } catch (e) {
              return errorText(e);
            }
          }}
        />
      )}
    </Sheet>
  );
}
