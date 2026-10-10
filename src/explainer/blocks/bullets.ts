import type { BulletsScene } from '../types';
import type { Env } from '../draw/env';
import { easeOut, fitFontSize, font, glow, rgba, wrapLines } from '../draw/primitives';
import { resolveAt } from '../timing';

/** When each item appears, in milliseconds from the start of the scene. Items without a cue come one after another. */
export function bulletTimes(scene: BulletsScene, env: Pick<Env, 'startMs' | 'len' | 'words'>): number[] {
  return scene.items.map((_, i) => {
    const at = resolveAt(scene.itemAt?.[i], { startMs: env.startMs, endMs: env.startMs + env.len }, env.words);
    return at !== null && Number.isFinite(at) ? at : 700 + i * 1100;
  });
}

/** A short list that reveals item by item: the newest is bright, the earlier ones settle back. */
export function drawBullets(env: Env, scene: BulletsScene) {
  const { ctx, f, palette, theme, t } = env;
  const times = bulletTimes(scene, env);
  const x0 = f.safe.x + (f.landscape ? 0.04 : 0) * f.w, w = f.safe.w * (f.landscape ? 0.78 : 0.92);
  let y = f.safe.y + 0.04 * f.h;
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  if (scene.title) {
    const size = fitFontSize(ctx, scene.title, w, f.u * 0.075, f.u * 0.04, 2, 800);
    ctx.fillStyle = palette.accent2;
    const k = easeOut(t / 500);
    ctx.save(); ctx.globalAlpha *= k;
    wrapLines(ctx, scene.title, w).forEach((ln, i) => ctx.fillText(ln, x0, y + size / 2 + i * size * 1.15));
    ctx.restore();
    y += size * 1.15 * wrapLines(ctx, scene.title, w).length + 0.04 * f.u;
  }
  const bodyTop = y, bodyH = f.safe.y + f.safe.h - bodyTop;
  const rowH = Math.min(bodyH / scene.items.length, f.u * 0.2);
  const newest = times.reduce((best, tm, i) => (t >= tm ? i : best), -1);
  scene.items.forEach((item, i) => {
    const k = easeOut((t - times[i]) / 520);
    if (k <= 0) return;
    const cy = bodyTop + i * rowH + rowH / 2 + (1 - k) * 0.03 * f.u;
    const current = i === newest;
    ctx.save();
    ctx.globalAlpha *= (current ? 1 : 0.62) * k;
    const markR = 0.017 * f.u;
    ctx.fillStyle = current ? palette.accent : palette.dim;
    if (current && theme.glow > 0) glow(ctx, palette.accent, 18 * theme.glow, () => { ctx.beginPath(); ctx.arc(x0 + markR, cy, markR, 0, Math.PI * 2); ctx.fill(); });
    else { ctx.beginPath(); ctx.arc(x0 + markR, cy, markR, 0, Math.PI * 2); ctx.fill(); }
    const size = fitFontSize(ctx, item, w - markR * 4, f.u * 0.06, f.u * 0.032, 2, current ? 700 : 600);
    ctx.fillStyle = rgba(palette.ink, 1);
    ctx.font = font(size, current ? 700 : 600);
    wrapLines(ctx, item, w - markR * 4).forEach((ln, li, all) => ctx.fillText(ln, x0 + markR * 3.2, cy + (li - (all.length - 1) / 2) * size * 1.2));
    ctx.restore();
  });
}
