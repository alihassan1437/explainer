// The four-stroke engine as ordinary code. It is NOT part of the app: it exists only so a test can prove that the engine written as data
// (src/explainer/examples/engine.ts) computes exactly the same numbers. Nothing in src imports this file.

import { clamp, easeInOut, hash01, lerp, mix, rad, smoothstep, wrapPi } from '../../src/explainer/draw/primitives';
import { paletteOf } from '../../src/explainer/theme';

export const G = { R: 0.55, L: 1.9, bore: 0.97, pistonHalf: 0.9, pinToTop: 0.2, pinToBottom: 0.3, lobe: 0.18, lobeWidth: 0.366, camR: 0.28, valveX: 0.5 } as const;
export const HEAD_Y = G.R + G.L + G.pinToTop + 0.2;
export const CAM_Y = HEAD_Y + 1.25;
const DUCT_Y = HEAD_Y + 0.2;

const lift = (camAngle: number) => G.lobe * Math.exp(-Math.pow(wrapPi(camAngle) / G.lobeWidth, 2));

export function engineState(totalDeg: number) {
  const cycleDeg = ((totalDeg % 720) + 720) % 720;
  const cycleIndex = Math.floor(totalDeg / 720);
  const theta = rad(cycleDeg % 360);
  const pistonPinY = G.R * Math.cos(theta) + Math.sqrt(G.L * G.L - Math.pow(G.R * Math.sin(theta), 2));
  const stroke = Math.min(3, Math.floor(cycleDeg / 180)) as 0 | 1 | 2 | 3;
  const camIn = rad((cycleDeg - 90) / 2), camEx = rad((cycleDeg - 630) / 2);
  const spark = smoothstep(350, 358, cycleDeg) * (1 - smoothstep(366, 374, cycleDeg));
  const flame = cycleDeg >= 360 && cycleDeg < 540 ? Math.exp(-(cycleDeg - 360) / 55) * smoothstep(360, 366, cycleDeg) : 0;
  return {
    cycleDeg, cycleIndex, theta, pistonPinY, pistonTopY: pistonPinY + G.pinToTop,
    crankPin: [G.R * Math.sin(theta), G.R * Math.cos(theta)] as [number, number],
    stroke, strokeProgress: (cycleDeg % 180) / 180, camIn, camEx, liftIn: lift(camIn), liftEx: lift(camEx), spark, flame,
  };
}
export type EngineState = ReturnType<typeof engineState>;

export interface Gas { u: number; v: number; enter: number; exit: number; w1: number; w2: number; p1: number; p2: number }
export function gasFor(cycleIndex: number): Gas[] {
  return Array.from({ length: 38 }, (_, i): Gas => {
    const b = cycleIndex * 1000 + i * 8;
    return {
      u: (hash01(b) * 2 - 1) * 0.84, v: 0.06 + hash01(b + 1) * 0.88,
      enter: 40 + (i / 38) * 90 + hash01(b + 2) * 4, exit: 585 + (i / 38) * 90 + hash01(b + 3) * 4,
      w1: 3 + hash01(b + 4) * 5, w2: 3 + hash01(b + 5) * 5, p1: hash01(b + 6) * 6.28, p2: hash01(b + 7) * 6.28,
    };
  });
}

const along = (pts: [number, number][], shares: [number, number, number], k: number): [number, number] => {
  const a = shares[0], b = shares[0] + shares[1];
  if (k < a) return [lerp(pts[0][0], pts[1][0], k / a), lerp(pts[0][1], pts[1][1], k / a)];
  if (k < b) return [lerp(pts[1][0], pts[2][0], (k - a) / shares[1]), lerp(pts[1][1], pts[2][1], (k - a) / shares[1])];
  return [lerp(pts[2][0], pts[3][0], (k - b) / shares[2]), lerp(pts[2][1], pts[3][1], (k - b) / shares[2])];
};

export function gasParticle(g: Gas, s: EngineState, seconds: number): { x: number; y: number; alpha: number; burn: number } {
  const h = HEAD_Y - s.pistonTopY;
  const heat = s.cycleDeg < 360 ? 0.5 + 0.9 * smoothstep(180, 360, s.cycleDeg) : s.cycleDeg < 540 ? 2 : 1.1;
  const jx = Math.sin(seconds * g.w1 + g.p1) * 0.045 * heat, jy = Math.sin(seconds * g.w2 + g.p2) * 0.04 * heat;
  const home: [number, number] = [clamp(g.u + jx, -0.86, 0.86), s.pistonTopY + clamp(g.v + jy / Math.max(h, 0.2), 0.04, 0.96) * h];
  const burn = s.cycleDeg < 360 ? 0 : clamp(1 - (s.cycleDeg - 360) / 260);
  if (s.cycleDeg < g.enter) return { x: home[0], y: home[1], alpha: 0, burn: 0 };
  if (s.cycleDeg < g.enter + 38) {
    const k = easeInOut((s.cycleDeg - g.enter) / 38);
    const [x, y] = along([[-1.85, DUCT_Y], [-G.valveX, DUCT_Y], [-G.valveX, HEAD_Y - 0.05], home], [0.45, 0.2, 0.35], k);
    return { x, y, alpha: smoothstep(0, 0.2, k), burn: 0 };
  }
  if (s.cycleDeg < g.exit) return { x: home[0], y: home[1], alpha: 1, burn };
  if (s.cycleDeg < g.exit + 42) {
    const k = easeInOut((s.cycleDeg - g.exit) / 42);
    const [x, y] = along([home, [G.valveX, HEAD_Y - 0.05], [G.valveX, DUCT_Y], [1.9, DUCT_Y]], [0.3, 0.15, 0.55], k);
    return { x, y, alpha: 1 - smoothstep(0.75, 1, k), burn: 0 };
  }
  return { x: home[0], y: home[1], alpha: 0, burn: 0 };
}

export const ENGINE_PARTS = ['cylinder', 'head', 'piston', 'connectingRod', 'crankshaft', 'intakeValve', 'exhaustValve', 'camshaft', 'sparkPlug', 'spark', 'mixture', 'flame', 'exhaust'] as const;

/** The colours the theme gave each engine part (the data version must give the same). */
export function partColors(themeId: 'blueprint' | 'flat'): Record<(typeof ENGINE_PARTS)[number], string> {
  const p = paletteOf({ theme: themeId });
  if (themeId === 'flat') {
    return { cylinder: p.dim, head: '#4a4e72', piston: p.accent, connectingRod: p.ink, crankshaft: '#3a3f66', intakeValve: p.good, exhaustValve: '#e63946', camshaft: '#8d93b8', sparkPlug: '#f4b400', spark: '#ffe066', mixture: p.accent2, flame: p.hot, exhaust: '#7b7f9e' };
  }
  return { cylinder: p.dim, head: p.dim, piston: p.accent, connectingRod: p.ink, crankshaft: p.ink, intakeValve: p.good, exhaustValve: '#fb7185', camshaft: '#8fb3dd', sparkPlug: '#fde047', spark: '#fff6b0', mixture: p.accent2, flame: p.hot, exhaust: '#9aa8bd' };
}

export { mix };
