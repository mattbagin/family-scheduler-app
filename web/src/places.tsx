import type { ReactNode } from 'react';
import { PLACES, type PlaceKey } from '@shared';

/*
 * The ambient screen's town: one pseudo-3D (isometric, 2:1 tiles) board in a 1000 x 540 viewBox.
 * Nine pads sit in a 3 x 3 grid with a road between them; each pad holds a building at its back and
 * a paved yard in front, where that place's people stand (see ANCHORS). Ground positions are grid
 * coordinates (gx, gy); P() projects them to the screen, with z in pixels up. Colours come from the
 * --tw-* variables in styles.css, so they follow the theme. The moving details (.tw-smoke, .tw-puck,
 * .tw-blink, .tw-flag, .tw-balloon, .tw-ball, .tw-shimmer, .tw-pulse, .tw-car) are CSS animations that
 * the reduced-motion rule switches off. The art is decorative: Ambient.tsx lays names and labels over
 * it as HTML.
 *
 * To redraw a building: change its component below, keeping it inside box(key) and standing on z = 0.
 * To move a place: change its slot in SLOTS (column i runs down-right, row j runs down-left).
 */

export const VIEW = { w: 1000, h: 540 };
const PAD = 3.7; // a pad is PAD x PAD tiles
const GAP = 0.8; // road width between pads
const N = 3 * PAD + 4 * GAP; // the board is N x N tiles
const U = 31; // half a tile's width on screen
const OX = 500;
const OY = 70;
const SLAB = 14; // how thick the board looks
const PAD_Z = 3; // how far a pad stands above the grass
const K = U / 35; // heights were first drawn for U = 35

type Pt = readonly [number, number];
type Rect = readonly [number, number, number, number];
const P = (gx: number, gy: number, z = 0): Pt => [OX + (gx - gy) * U, OY + ((gx + gy) * U) / 2 - z];
const pts = (...ps: Pt[]) => ps.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');

type Lot = Exclude<PlaceKey, 'road'>;
/** Which pad each place is on: [column i, row j]. One table, no layout engine. */
const SLOTS: Record<Lot, Pt> = {
  office: [0, 0], school: [1, 0], daycare: [2, 0],
  clinic: [0, 1], field: [1, 1], rink: [2, 1],
  pool: [0, 2], home: [1, 2], out: [2, 2],
};
/** Each building's footprint [width along gx, depth along gy], tucked into its pad's back corner. */
const SIZES: Record<Lot, Pt> = {
  office: [2.2, 1.9], school: [2.4, 1.9], daycare: [2.2, 1.9], clinic: [2.2, 1.9], field: [2.5, 1.8],
  rink: [2.5, 1.8], pool: [2.5, 1.8], home: [2.4, 1.9], out: [1, 1],
};
const LANES = [GAP / 2, PAD + GAP * 1.5, 2 * PAD + GAP * 2.5, N - GAP / 2];
const ROAD_STAND: Pt = [LANES[0], LANES[2]]; // on the left outer lane, no yard anchor near it

const padOf = (k: Lot): Rect => {
  const x0 = GAP + SLOTS[k][0] * (PAD + GAP);
  const y0 = GAP + SLOTS[k][1] * (PAD + GAP);
  return [x0, y0, x0 + PAD, y0 + PAD];
};
const box = (k: Lot): Rect => {
  const [x0, y0] = padOf(k);
  return [x0 + 0.3, y0 + 0.3, x0 + 0.3 + SIZES[k][0], y0 + 0.3 + SIZES[k][1]];
};

/** Where each place's people stand, in percent of the board: on the pad's yard, near its front corner. */
export const ANCHORS = Object.fromEntries(
  PLACES.map((k) => {
    const [gx, gy] = k === 'road' ? ROAD_STAND : (([, , x1, y1]) => [x1 - 0.65, y1 - 0.65] as const)(padOf(k));
    const [x, y] = P(gx, gy);
    return [k, { x: (x / VIEW.w) * 100, y: (y / VIEW.h) * 100 }];
  }),
) as Record<PlaceKey, { x: number; y: number }>;

/* ---------- drawing helpers ---------- */

const shade = (c: string) => ({ t: `color-mix(in srgb, ${c} 78%, #fff)`, l: c, r: `color-mix(in srgb, ${c} 72%, #1b2140)` });

/** A box on the ground; its left face is lit, its right face is in shade. */
function Box({ b: [x0, y0, x1, y1], z0 = 0, z1, c, top = true }: { b: Rect; z0?: number; z1: number; c: string; top?: boolean }) {
  const s = shade(c);
  return (
    <g className="tw-o">
      <polygon points={pts(P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1))} style={{ fill: s.l }} />
      <polygon points={pts(P(x1, y1, z0), P(x1, y0, z0), P(x1, y0, z1), P(x1, y1, z1))} style={{ fill: s.r }} />
      {top && <polygon points={pts(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1))} style={{ fill: s.t }} />}
    </g>
  );
}

/** A flat shape on a wall: face 'R' is the shaded wall (a runs along gy), 'L' the lit one (a runs along gx). */
function Wall({ face, b, a0, a1, z0, z1, c, cls }: { face: 'L' | 'R'; b: Rect; a0: number; a1: number; z0: number; z1: number; c: string; cls?: string }) {
  const [, , x1, y1] = b;
  const q = face === 'R' ? [P(x1, a1, z0), P(x1, a0, z0), P(x1, a0, z1), P(x1, a1, z1)] : [P(a0, y1, z0), P(a1, y1, z0), P(a1, y1, z1), P(a0, y1, z1)];
  return <polygon className={`tw-o ${cls ?? ''}`} points={pts(...q)} style={{ fill: c }} />;
}

/** A grid of windows over a wall. `blink` is the [col, row] of one window whose light blinks. */
function Windows({ face, b, cols, rows, z0, z1, blink }: { face: 'L' | 'R'; b: Rect; cols: number; rows: number; z0: number; z1: number; blink?: Pt }) {
  const [x0, y0, x1, y1] = b;
  const [lo, hi] = face === 'R' ? [y0, y1] : [x0, x1];
  const cw = (hi - lo) / cols;
  const rh = (z1 - z0) / rows;
  const out: ReactNode[] = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const lit = blink && blink[0] === c && blink[1] === r;
      out.push(<Wall key={`${c}${r}`} face={face} b={b} a0={lo + c * cw + cw * 0.22} a1={lo + (c + 1) * cw - cw * 0.22} z0={z0 + r * rh + rh * 0.2} z1={z0 + (r + 1) * rh - rh * 0.2} c={lit ? 'var(--tw-light)' : 'var(--tw-glass)'} cls={lit ? 'tw-blink' : undefined} />);
    }
  }
  return <>{out}</>;
}

/** A pad of paving a building stands on. */
function Pad({ k }: { k: Lot }) {
  return <Box b={padOf(k)} z1={PAD_Z} c="var(--tw-pad)" />;
}

/* ---------- the buildings ---------- */

function Home() {
  const b = box('home');
  const [x0, y0, x1, y1] = b;
  const xm = (x0 + x1) / 2;
  const ym = (y0 + y1) / 2;
  const h = 40 * K;
  const r = 32 * K;
  const smoke = P(xm + 0.4, y0 + 0.7, h + r + 16 * K);
  return (
    <g>
      <Box b={b} z1={h} c="var(--tw-wall)" top={false} />
      <polygon className="tw-o" points={pts(P(x1, y1, h), P(x0, y1, h), P(xm, y1, h + r))} style={{ fill: 'var(--tw-wall)' }} />
      <Wall face="R" b={b} a0={ym - 0.3} a1={ym + 0.3} z0={0} z1={24 * K} c="var(--tw-door)" />
      <Wall face="R" b={b} a0={y0 + 0.22} a1={y0 + 0.6} z0={16 * K} z1={30 * K} c="var(--tw-glass)" />
      <Wall face="R" b={b} a0={y1 - 0.6} a1={y1 - 0.22} z0={16 * K} z1={30 * K} c="var(--tw-glass)" />
      <Wall face="L" b={b} a0={xm - 0.28} a1={xm + 0.28} z0={12 * K} z1={28 * K} c="var(--tw-glass)" />
      <polygon className="tw-o" points={pts(P(x1 + 0.15, y1 + 0.1, h), P(x1 + 0.15, y0 - 0.1, h), P(xm, y0 - 0.1, h + r), P(xm, y1 + 0.1, h + r))} style={{ fill: 'var(--tw-roof)' }} />
      <Box b={[xm + 0.2, y0 + 0.45, xm + 0.65, y0 + 0.9]} z0={h + 10 * K} z1={h + r + 10 * K} c="var(--tw-brick)" />
      <g className="tw-smoke" style={{ transform: `translate(${smoke[0]}px, ${smoke[1]}px)` }}>
        <circle r="6" /><circle r="6" /><circle r="6" />
      </g>
    </g>
  );
}

function Rink() {
  const b = box('rink');
  const [x0, y0, x1, y1] = b;
  const ym = (y0 + y1) / 2;
  const xm = (x0 + x1) / 2;
  const hb = 11 * K; // boards
  const i = 0.26; // boards' thickness
  const run = x1 - x0 - 2 * i - 0.9;
  const lamp = P(x0 + 0.15, y0 + 0.15, 62 * K);
  const flat = `matrix(${U} ${U / 2} ${-U} ${U / 2} ${OX} ${OY - hb})`;
  const start = P(x0 + i + 0.45, ym, hb + 3);
  return (
    <g>
      <Box b={b} z1={hb} c="var(--tw-boards)" />
      <polygon points={pts(P(x0 + i, y0 + i, hb), P(x1 - i, y0 + i, hb), P(x1 - i, y1 - i, hb), P(x0 + i, y1 - i, hb))} className="tw-o" style={{ fill: 'var(--tw-ice)', strokeWidth: 2 }} />
      <g transform={flat} className="tw-mark">
        <path d={`M${xm} ${y0 + i}V${y1 - i}`} />
        <circle cx={xm} cy={ym} r="0.55" />
      </g>
      <path className="tw-o" d={`M${P(x0 + 0.15, y0 + 0.15, hb).join(' ')}L${lamp.join(' ')}`} />
      <polygon className="tw-o" points={pts([lamp[0] - 13, lamp[1] - 2], [lamp[0] + 13, lamp[1] - 2], [lamp[0] + 9, lamp[1] - 11], [lamp[0] - 9, lamp[1] - 11])} style={{ fill: 'var(--tw-flag)' }} />
      <g transform={`translate(${start.join(' ')})`}>
        <g className="tw-puck" style={{ ['--dx' as string]: `${run * U}px`, ['--dy' as string]: `${(run * U) / 2}px` }}>
          <ellipse rx="8" ry="4" className="tw-o" style={{ fill: 'var(--tw-ink)' }} />
        </g>
      </g>
    </g>
  );
}

function Office() {
  const b = box('office');
  const [x0, y0, x1] = b;
  const h = 92 * K;
  return (
    <g>
      <Box b={b} z1={h} c="var(--tw-p-blue)" />
      <Windows face="R" b={b} cols={3} rows={5} z0={22 * K} z1={h - 6 * K} blink={[1, 2]} />
      <Windows face="L" b={b} cols={3} rows={5} z0={22 * K} z1={h - 6 * K} />
      <Wall face="L" b={b} a0={(x0 + x1) / 2 - 0.3} a1={(x0 + x1) / 2 + 0.3} z0={0} z1={16 * K} c="var(--tw-door)" />
      <Box b={[x0 + 0.5, y0 + 0.5, x0 + 1.1, y0 + 1.1]} z0={h} z1={h + 10 * K} c="var(--tw-wall)" />
      <path className="tw-o" d={`M${P(x1 - 0.4, y0 + 0.4, h).join(' ')}l0 ${-22 * K}`} />
    </g>
  );
}

function School() {
  const b = box('school');
  const [x0, y0, x1, y1] = b;
  const h = 36 * K;
  const t0 = h + 0; // the tower stands on the roof
  const tb: Rect = [x0 + 0.25, y0 + 0.25, x0 + 0.95, y0 + 0.95];
  const th = h + 30 * K;
  const apex = P((tb[0] + tb[2]) / 2, (tb[1] + tb[3]) / 2, th + 22 * K);
  const pole = P(x1 - 0.25, y1 - 0.25, h);
  return (
    <g>
      <Box b={b} z1={h} c="var(--tw-p-red)" />
      <Windows face="R" b={b} cols={3} rows={1} z0={10 * K} z1={h - 6 * K} />
      <Windows face="L" b={b} cols={2} rows={1} z0={10 * K} z1={h - 6 * K} />
      <Wall face="L" b={b} a0={(x0 + x1) / 2 - 0.25} a1={(x0 + x1) / 2 + 0.25} z0={0} z1={14 * K} c="var(--tw-door)" />
      <Box b={tb} z0={t0} z1={th} c="var(--tw-wall)" />
      <polygon className="tw-o" points={pts(P(tb[2], tb[3], th), P(tb[2], tb[1], th), apex)} style={{ fill: 'var(--tw-roof)' }} />
      <polygon className="tw-o" points={pts(P(tb[0], tb[3], th), P(tb[2], tb[3], th), apex)} style={{ fill: 'var(--tw-brick)' }} />
      <path className="tw-o" d={`M${pole.join(' ')}l0 ${-30 * K}`} />
      <g transform={`translate(${pole[0]} ${pole[1] - 30 * K})`}>
        <polygon className="tw-o tw-flag" points="0,0 18,4 0,10" style={{ fill: 'var(--tw-flag)' }} />
      </g>
    </g>
  );
}

function Daycare() {
  const b = box('daycare');
  const [x0, y0, x1, y1] = b;
  const xm = (x0 + x1) / 2;
  const h = 26 * K;
  const r = 14 * K;
  const sand: Rect = [x1 + 0.15, y0 + 0.1, x1 + 0.85, y0 + 0.8];
  const slide = P(x1 + 0.5, y0 + 1.5);
  const balloon = P(x0 + 0.5, y0 + 0.5, h + r);
  return (
    <g>
      <Box b={b} z1={h} c="var(--tw-p-pink)" top={false} />
      <path className="tw-o" d={`M${P(x1, y1, h).join(' ')}Q${P(xm, y1, h + r * 2).join(' ')} ${P(x0, y1, h).join(' ')}Z`} style={{ fill: 'var(--tw-p-pink)' }} />
      <Wall face="R" b={b} a0={(y0 + y1) / 2 - 0.28} a1={(y0 + y1) / 2 + 0.28} z0={0} z1={20 * K} c="var(--tw-p-aqua)" />
      <Wall face="R" b={b} a0={y0 + 0.2} a1={y0 + 0.55} z0={10 * K} z1={20 * K} c="var(--tw-glass)" />
      <Wall face="L" b={b} a0={xm - 0.25} a1={xm + 0.25} z0={8 * K} z1={18 * K} c="var(--tw-glass)" />
      <path className="tw-o" d={`M${P(x1 + 0.15, y1 + 0.1, h).join(' ')}L${P(x1 + 0.15, y0 - 0.1, h).join(' ')}Q${P(xm + 0.4, y0 - 0.1, h + r * 1.7).join(' ')} ${P(xm, y0 - 0.1, h + r * 1.7).join(' ')}L${P(xm, y1 + 0.1, h + r * 1.7).join(' ')}Q${P(xm + 0.4, y1 + 0.1, h + r * 1.7).join(' ')} ${P(x1 + 0.15, y1 + 0.1, h).join(' ')}Z`} style={{ fill: 'var(--tw-p-aqua)' }} />
      <Box b={sand} z1={5 * K} c="var(--tw-sand)" />
      <polygon className="tw-o" points={pts([slide[0] - 4, slide[1] - 14 * K], [slide[0] + 4, slide[1] - 14 * K], [slide[0] + 18, slide[1] + 2], [slide[0] + 8, slide[1] + 4])} style={{ fill: 'var(--tw-flag)' }} />
      <g transform={`translate(${balloon.join(' ')})`}>
        <g className="tw-balloon">
          <path className="tw-o" d="M0 0V-14" />
          <ellipse className="tw-o" cy="-24" rx="8" ry="10" style={{ fill: 'var(--tw-p-red)' }} />
        </g>
      </g>
    </g>
  );
}

function Field() {
  const b = box('field');
  const [x0, y0, x1, y1] = b;
  const xm = (x0 + x1) / 2;
  const ym = (y0 + y1) / 2;
  const flat = `matrix(${U} ${U / 2} ${-U} ${U / 2} ${OX} ${OY})`;
  const goal = (gx: number) => {
    const a = P(gx, ym - 0.45, 0);
    const c = P(gx, ym + 0.45, 0);
    return <path className="tw-o" d={`M${a.join(' ')}l0 ${-14 * K}L${c[0]} ${c[1] - 14 * K}L${c.join(' ')}`} style={{ fill: 'none', strokeWidth: 3 }} />;
  };
  const roll = (x1 - x0 - 0.9) * U;
  const ball = P(x0 + 0.45, ym, 0);
  return (
    <g>
      <polygon className="tw-o" points={pts(P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1))} style={{ fill: 'var(--tw-pitch)' }} />
      <g transform={flat} className="tw-mark tw-white">
        <rect x={x0 + 0.2} y={y0 + 0.2} width={x1 - x0 - 0.4} height={y1 - y0 - 0.4} />
        <path d={`M${xm} ${y0 + 0.2}V${y1 - 0.2}`} />
        <circle cx={xm} cy={ym} r="0.5" />
      </g>
      {goal(x0 + 0.1)}
      {goal(x1 - 0.1)}
      <g transform={`translate(${ball.join(' ')})`}>
        <g className="tw-ball" style={{ ['--dx' as string]: `${roll}px`, ['--dy' as string]: `${roll / 2}px` }}>
          <circle r="5.5" className="tw-o" style={{ fill: '#fff' }} />
        </g>
      </g>
    </g>
  );
}

function Pool() {
  const b = box('pool');
  const [x0, y0, x1, y1] = b;
  const ym = (y0 + y1) / 2;
  const hd = 9 * K;
  const i = 0.3;
  const board: Rect = [x1 - 0.3, ym - 0.2, x1 + 0.6, ym + 0.2];
  const lane = (gy: number) => `M${P(x0 + i, gy, hd).join(' ')}L${P(x1 - i, gy, hd).join(' ')}`;
  return (
    <g>
      <Box b={b} z1={hd} c="var(--tw-wall)" />
      <polygon className="tw-o" points={pts(P(x0 + i, y0 + i, hd), P(x1 - i, y0 + i, hd), P(x1 - i, y1 - i, hd), P(x0 + i, y1 - i, hd))} style={{ fill: 'var(--tw-water)', strokeWidth: 2 }} />
      <path className="tw-shimmer" d={`M${P(x0 + 0.7, y0 + 0.6, hd).join(' ')}l14 7M${P(x0 + 1.5, y1 - 0.6, hd).join(' ')}l14 7M${P(x1 - 1.2, y0 + 0.7, hd).join(' ')}l14 7`} />
      <path className="tw-rope" d={lane(y0 + (y1 - y0) / 3) + lane(y0 + (2 * (y1 - y0)) / 3)} />
      <Box b={board} z0={hd + 4 * K} z1={hd + 7 * K} c="var(--tw-p-yellow)" />
      <path className="tw-o" d={`M${P(x1 - 0.3, ym, hd + 4 * K).join(' ')}L${P(x1 - 0.3, ym, hd).join(' ')}`} />
    </g>
  );
}

function Clinic() {
  const b = box('clinic');
  const [x0, y0, x1, y1] = b;
  const xm = (x0 + x1) / 2;
  const ym = (y0 + y1) / 2;
  const h = 54 * K;
  const cz = h - 22 * K; // the cross's centre height, on the lit wall
  return (
    <g>
      <Box b={b} z1={h} c="var(--tw-white)" />
      <Windows face="R" b={b} cols={2} rows={2} z0={20 * K} z1={h - 4 * K} />
      <Wall face="R" b={b} a0={ym - 0.3} a1={ym + 0.3} z0={0} z1={16 * K} c="var(--tw-p-teal)" />
      <Windows face="L" b={b} cols={2} rows={1} z0={4 * K} z1={18 * K} />
      <g className="tw-pulse">
        <Wall face="L" b={b} a0={xm - 0.14} a1={xm + 0.14} z0={cz - 11 * K} z1={cz + 11 * K} c="var(--tw-red)" />
        <Wall face="L" b={b} a0={xm - 0.38} a1={xm + 0.38} z0={cz - 3.5 * K} z1={cz + 3.5 * K} c="var(--tw-red)" />
      </g>
    </g>
  );
}

/** A signpost on the grass showing the emoji of wherever someone is out and about. */
function Out({ emoji }: { emoji: string }) {
  const [x0, y0] = padOf('out');
  const base = P(x0 + 3, y0 + 1.2, 0); // toward the back, clear of the yard
  return (
    <g>
      <ellipse cx={base[0]} cy={base[1]} rx="26" ry="13" style={{ fill: 'var(--tw-grass-dark)' }} />
      <path className="tw-o" d={`M${base[0]} ${base[1]}v-58`} />
      <rect className="tw-o" x={base[0] - 20} y={base[1] - 80} width="40" height="34" rx="8" style={{ fill: 'var(--tw-sign)' }} />
      <text x={base[0]} y={base[1] - 62} textAnchor="middle" dominantBaseline="central" fontSize="24">{emoji}</text>
      <polygon className="tw-o" points={pts([base[0] + 2, base[1] - 40], [base[0] + 36, base[1] - 40], [base[0] + 44, base[1] - 31], [base[0] + 36, base[1] - 22], [base[0] + 2, base[1] - 22])} style={{ fill: 'var(--tw-p-red)' }} />
    </g>
  );
}

/** Picks what stands on a lot. */
function Building({ lot, outIcon }: { lot: Lot; outIcon: string }) {
  switch (lot) {
    case 'home': return <Home />;
    case 'rink': return <Rink />;
    case 'office': return <Office />;
    case 'school': return <School />;
    case 'daycare': return <Daycare />;
    case 'field': return <Field />;
    case 'pool': return <Pool />;
    case 'clinic': return <Clinic />;
    case 'out': return <Out emoji={outIcon} />;
  }
}

/** A little car that drives round the inner lanes. */
function Car() {
  const [a, b] = [LANES[1], LANES[2]];
  const d = `M${[P(a, a), P(b, a), P(b, b), P(a, b)].map((p) => p.join(' ')).join('L')}Z`;
  return (
    <g className="tw-car" style={{ offsetPath: `path("${d}")` }}>
      <ellipse rx="13" ry="6" style={{ fill: 'rgba(0,0,0,.25)' }} cy="4" />
      <rect className="tw-o" x="-12" y="-11" width="24" height="12" rx="5" style={{ fill: 'var(--tw-p-red)' }} />
      <rect className="tw-o" x="-6" y="-17" width="12" height="8" rx="3" style={{ fill: 'var(--tw-glass)' }} />
    </g>
  );
}

/** The whole board: grass, the road, the pads and the ten places. `outIcon` is the emoji `whereNow` passes for `out`. */
export function Town({ outIcon = '📍' }: { outIcon?: string }): ReactNode {
  const flat = `matrix(${U} ${U / 2} ${-U} ${U / 2} ${OX} ${OY})`;
  const lines = LANES.flatMap((l) => [`M${l} ${LANES[0]}V${LANES[3]}`, `M${LANES[0]} ${l}H${LANES[3]}`]).join('');
  const corners = [P(0, 0), P(N, 0), P(N, N), P(0, N)];
  // Far pads first, so nearer ones draw over them.
  const order = (Object.keys(SLOTS) as Lot[]).sort((a, b) => padOf(a)[2] + padOf(a)[3] - padOf(b)[2] - padOf(b)[3]);
  return (
    <svg className="town" viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} aria-hidden="true" focusable="false">
      <polygon className="tw-o" points={pts(corners[3], corners[2], [corners[2][0], corners[2][1] + SLAB], [corners[3][0], corners[3][1] + SLAB])} style={{ fill: 'var(--tw-soil-l)' }} />
      <polygon className="tw-o" points={pts(corners[2], corners[1], [corners[1][0], corners[1][1] + SLAB], [corners[2][0], corners[2][1] + SLAB])} style={{ fill: 'var(--tw-soil-r)' }} />
      <polygon className="tw-o" points={pts(...corners)} style={{ fill: 'var(--tw-grass)' }} />
      <g transform={flat} fill="none" strokeLinejoin="round" strokeLinecap="round">
        <path d={lines} stroke="var(--tw-ink)" strokeWidth={GAP + 0.25} />
        <path d={lines} stroke="var(--tw-road)" strokeWidth={GAP - 0.05} />
        <path d={lines} stroke="var(--tw-line)" strokeWidth="2" strokeDasharray="6 8" vectorEffect="non-scaling-stroke" />
      </g>
      {order.map((k) => (
        <g key={k} data-lot={k}>
          <Pad k={k} />
          <g transform={`translate(0 ${-PAD_Z})`}><Building lot={k} outIcon={outIcon} /></g>
        </g>
      ))}
      <Car />
    </svg>
  );
}
