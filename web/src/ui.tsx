import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode,
} from 'react';
import type { Member } from '@shared';

/** Sets --pc, the person color that tints cards, rings and avatars. */
export const pc = (color: string | undefined, extra?: CSSProperties): CSSProperties =>
  ({ '--pc': color ?? 'var(--muted)', ...extra }) as CSSProperties;

export function Face({ m, size }: { m: Member | undefined; size?: number }) {
  if (!m) return null;
  const style = size ? pc(m.color, { width: size, height: size, fontSize: size * 0.55 }) : pc(m.color);
  return <span className="face" style={style} title={m.name} aria-label={m.name}>{m.avatar}</span>;
}

export function Avatar({ m, className = '', badge }: { m: Member; className?: string; badge?: number }) {
  return (
    <span className={`avatar ${className}`} style={pc(m.color)} aria-hidden="true">
      {m.avatar}
      {badge ? <i className="badge num">{badge}</i> : null}
    </span>
  );
}

/* ---------- toasts ---------- */

const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; id: number } | null>(null);
  const show = useCallback((text: string) => setMsg({ text, id: Date.now() }), []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3000);
    return () => clearTimeout(t);
  }, [msg]);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && <div className="toast" role="status" key={msg.id}>{msg.text}</div>}
    </ToastCtx.Provider>
  );
}

/* ---------- sheets (modal stack) ---------- */

interface Sheets {
  open: (node: ReactNode) => void;
  close: () => void;
  replace: (node: ReactNode) => void;
}
const SheetCtx = createContext<Sheets | null>(null);
export function useSheets(): Sheets {
  const s = useContext(SheetCtx);
  if (!s) throw new Error('useSheets outside SheetProvider');
  return s;
}

/** A stack, so an unlock prompt can sit on top of a half-filled form without losing it. */
export function SheetProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<{ id: number; node: ReactNode }[]>([]);
  const nextId = useRef(1);
  const api = useMemo<Sheets>(() => ({
    open: (node) => setStack((s) => [...s, { id: nextId.current++, node }]),
    close: () => setStack((s) => s.slice(0, -1)),
    replace: (node) => setStack((s) => [...s.slice(0, -1), { id: nextId.current++, node }]),
  }), []);
  useEffect(() => {
    if (!stack.length) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && api.close();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [stack.length, api]);
  return (
    <SheetCtx.Provider value={api}>
      {children}
      {stack.map((s, i) => (
        <div key={s.id} style={{ display: i === stack.length - 1 ? undefined : 'none' }}>{s.node}</div>
      ))}
    </SheetCtx.Provider>
  );
}

export function Sheet({ title, icon, sub, wide, onClose, children }: {
  title: ReactNode; icon?: ReactNode; sub?: ReactNode; wide?: boolean; onClose?: () => void; children: ReactNode;
}) {
  const sheets = useSheets();
  const close = onClose ?? sheets.close;
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className={`sheet ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="sheet-top">
          <div className="row" style={{ gap: 14, flexWrap: 'nowrap' }}>
            {icon && <span className="big">{icon}</span>}
            <div>
              <h2>{title}</h2>
              {sub && <div className="note">{sub}</div>}
            </div>
          </div>
          <button className="icon-btn" onClick={close} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Two-step delete: the first tap asks, the second does it. */
export function ConfirmButton({ label, confirmText, onConfirm, className = 'icon-btn danger' }: {
  label: string; confirmText: string; onConfirm: () => void; className?: string;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <button className={className} onClick={() => setAsking(true)}>{label}</button>;
  return (
    <div className="confirm">
      <span>{confirmText}</span>
      <div className="row">
        <button className="primary" onClick={onConfirm}>Yes, {label.toLowerCase()}</button>
        <button className="icon-btn" onClick={() => setAsking(false)}>Keep it</button>
      </div>
    </div>
  );
}

/* ---------- celebration ---------- */

let canvas: HTMLCanvasElement | null = null;
let parts: { x: number; y: number; vx: number; vy: number; r: number; c: string; life: number; rot: number }[] = [];
let raf = 0;

export function burst(x: number, y: number) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'confetti';
    document.body.appendChild(canvas);
  }
  const ctx = canvas.getContext('2d')!;
  canvas.width = innerWidth * devicePixelRatio;
  canvas.height = innerHeight * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  const cols = ['#D9487A', '#2F7DE1', '#F5B35A', '#1F9C62', '#FFD84D', '#8B5CF6'];
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = 3 + Math.random() * 7;
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 5, r: 3 + Math.random() * 4, c: cols[i % cols.length], life: 70 + Math.random() * 30, rot: Math.random() * 6 });
  }
  const loop = () => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter((p) => p.life-- > 0);
    for (const p of parts) {
      p.vy += 0.28; p.vx *= 0.98; p.x += p.vx; p.y += p.vy; p.rot += 0.2;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      ctx.globalAlpha = Math.min(1, p.life / 30);
      ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
      ctx.restore();
    }
    raf = parts.length ? requestAnimationFrame(loop) : 0;
  };
  if (!raf) raf = requestAnimationFrame(loop);
}

export function burstFrom(el: Element | null) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  burst(r.left + r.width / 2, r.top + r.height / 2);
}

/** The big one, for finishing every job: a star, a message, confetti everywhere and a fanfare. */
export function celebrate(message: string) {
  chime([523, 659, 784, 1047]);
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    [0.2, 0.5, 0.8].forEach((x, i) => setTimeout(() => burst(innerWidth * x, innerHeight * 0.45), i * 180));
  }
  const el = document.createElement('div');
  el.className = 'celebrate';
  el.setAttribute('role', 'status');
  const star = document.createElement('span');
  star.textContent = '⭐';
  const text = document.createElement('b');
  text.textContent = message;
  el.append(star, text);
  document.body.append(el);
  setTimeout(() => el.remove(), 2400);
}

let audio: AudioContext | null = null;
export function chime(notes = [660, 880]) {
  try {
    audio ??= new AudioContext();
    notes.forEach((f, i) => {
      const o = audio!.createOscillator();
      const g = audio!.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t = audio!.currentTime + i * 0.16;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      o.connect(g).connect(audio!.destination);
      o.start(t);
      o.stop(t + 0.55);
    });
  } catch {
    /* sound is optional */
  }
}

/** Analog clock showing a given time: lets kids who can't read times match the hands. */
export function ClockFace({ min, color, size = 80 }: { min: number; color: string; size?: number }) {
  const rad = (a: number) => (a * Math.PI) / 180;
  const ha = ((min / 60) % 12) * 30 - 90;
  const ma = (min % 60) * 6 - 90;
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" aria-hidden="true">
      <circle cx="40" cy="40" r="38" fill="var(--surface)" stroke={color} strokeWidth="3" />
      {Array.from({ length: 12 }, (_, i) => {
        const a = rad(i * 30);
        return <line key={i} x1={40 + 33 * Math.cos(a)} y1={40 + 33 * Math.sin(a)} x2={40 + 36 * Math.cos(a)} y2={40 + 36 * Math.sin(a)} stroke="var(--muted)" strokeWidth="2" />;
      })}
      <line x1="40" y1="40" x2={40 + 22 * Math.cos(rad(ha))} y2={40 + 22 * Math.sin(rad(ha))} stroke="var(--ink)" strokeWidth="5" strokeLinecap="round" />
      <line x1="40" y1="40" x2={40 + 31 * Math.cos(rad(ma))} y2={40 + 31 * Math.sin(rad(ma))} stroke={color} strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="40" cy="40" r="3.5" fill="var(--ink)" />
    </svg>
  );
}
