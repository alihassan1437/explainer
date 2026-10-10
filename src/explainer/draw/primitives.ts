// Small drawing and math helpers. Everything here is deterministic: the same inputs always give the same output.

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const easeOut = (k: number) => 1 - Math.pow(1 - clamp(k), 3);
export const easeInOut = (k: number) => { const x = clamp(k); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
export const smoothstep = (a: number, b: number, x: number) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };
/** Wraps an angle in radians into -PI..PI. */
export const wrapPi = (a: number) => { const t = (a + Math.PI) % (2 * Math.PI); return (t < 0 ? t + 2 * Math.PI : t) - Math.PI; };
export const rad = (deg: number) => (deg * Math.PI) / 180;

// ---- seeded randomness (never Math.random: a frame must be the same every time it is drawn) ----

function hashString(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A generator of numbers in 0..1 that always gives the same sequence for the same seed. */
export function rng(seed: string | number): () => number {
  let a = typeof seed === 'number' ? seed >>> 0 : hashString(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A number in 0..1 for a whole number, with no state: the same input always gives the same output. Used by drawings (`rand(n)`) and the engine. */
export function hash01(n: number): number {
  let x = Math.floor(n) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** One number in 0..1 for a seed. */
export const unit = (seed: string) => rng(seed)();

// ---- colour ----

export function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.padEnd(6, '0').slice(0, 6);
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]: [number, number, number]) {
  return '#' + [r, g, b].map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
}

/** Mixes two #rrggbb colours: 0 is all a, 1 is all b. */
export function mix(a: string, b: string, k: number): string {
  const x = parseHex(a), y = parseHex(b), t = clamp(k);
  return toHex([lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)]);
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r},${g},${b},${clamp(alpha).toFixed(3)})`;
}

// ---- text ----

export const FONT = "'Inter', 'Segoe UI', system-ui, -apple-system, Arial, sans-serif";
export const font = (size: number, weight: number | string = 600) => `${weight} ${Math.round(size)}px ${FONT}`;

/** Splits text into lines no wider than maxW at the current font. */
export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && ctx.measureText(next).width > maxW) { lines.push(line); line = w; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** The largest font size (down to minSize) at which the text wraps into at most maxLines lines of maxW. Leaves ctx.font set to it. */
export function fitFontSize(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxSize: number, minSize: number, maxLines: number, weight: number | string = 700): number {
  for (let size = maxSize; size >= minSize; size -= Math.max(1, maxSize * 0.04)) {
    ctx.font = font(size, weight);
    if (wrapLines(ctx, text, maxW).length <= maxLines) return size;
  }
  ctx.font = font(minSize, weight);
  return minSize;
}

/** Draws a path with a glow: the same stroke twice, once soft and wide. */
export function glow(ctx: CanvasRenderingContext2D, color: string, blur: number, draw: () => void) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  draw();
  ctx.restore();
}

export function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.lineTo(x + w - k, y); ctx.quadraticCurveTo(x + w, y, x + w, y + k);
  ctx.lineTo(x + w, y + h - k); ctx.quadraticCurveTo(x + w, y + h, x + w - k, y + h);
  ctx.lineTo(x + k, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - k);
  ctx.lineTo(x, y + k); ctx.quadraticCurveTo(x, y, x + k, y);
  ctx.closePath();
}
