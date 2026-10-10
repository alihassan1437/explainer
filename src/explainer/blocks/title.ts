import type { TitleScene } from '../types';
import type { Env } from '../draw/env';
import { easeOut, fitFontSize, font, glow, rgba, smoothstep, wrapLines } from '../draw/primitives';

/** A headline that arrives word by word, with an accent line drawn under it and an optional subtitle. */
export function drawTitle(env: Env, scene: TitleScene) {
  const { ctx, f, palette, theme, t } = env;
  const maxW = f.safe.w * (f.landscape ? 0.82 : 0.9);
  const size = fitFontSize(ctx, scene.text, maxW, f.u * (f.landscape ? 0.15 : 0.13), f.u * 0.05, f.landscape ? 2 : 4, 800);
  ctx.font = font(size, 800);
  const lines = wrapLines(ctx, scene.text, maxW);
  const lineH = size * 1.14;
  const total = lines.length * lineH;
  const top = f.h * 0.46 - total / 2;
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const space = ctx.measureText(' ').width;
  let index = 0;
  lines.forEach((line, li) => {
    const words = line.split(' ');
    const widths = words.map(w => ctx.measureText(w).width);
    const lineW = widths.reduce((a, b) => a + b, 0) + space * (words.length - 1);
    let x = f.w / 2 - lineW / 2;
    words.forEach((w, wi) => {
      const k = easeOut((t - 150 - index * 130) / 520);
      index++;
      if (k > 0) {
        ctx.save();
        ctx.globalAlpha *= k;
        ctx.fillStyle = palette.ink;
        const y = top + li * lineH + lineH / 2 + (1 - k) * 0.05 * f.u;
        if (theme.glow > 0 && li === lines.length - 1 && wi === words.length - 1) glow(ctx, palette.accent, 24 * theme.glow * k, () => { ctx.fillStyle = palette.accent2; ctx.fillText(w, x, y); });
        else ctx.fillText(w, x, y);
        ctx.restore();
      }
      x += widths[wi] + space;
    });
  });
  // the accent line grows from the middle once the words are in
  const lineK = easeOut((t - 150 - index * 130 - 200) / 600);
  if (lineK > 0) {
    const y = top + total + 0.03 * f.u, half = Math.min(f.safe.w * 0.28, f.u * 0.32) * lineK;
    ctx.strokeStyle = palette.accent; ctx.lineWidth = Math.max(2, 0.008 * f.u); ctx.lineCap = 'round';
    glow(ctx, palette.accent, 16 * theme.glow, () => { ctx.beginPath(); ctx.moveTo(f.w / 2 - half, y); ctx.lineTo(f.w / 2 + half, y); ctx.stroke(); });
  }
  if (scene.subtitle) {
    const k = smoothstep(150 + index * 130 + 500, 150 + index * 130 + 1100, t);
    if (k > 0) {
      ctx.save(); ctx.globalAlpha *= k; ctx.textAlign = 'center';
      const sub = fitFontSize(ctx, scene.subtitle, maxW, f.u * 0.05, f.u * 0.03, 2, 500);
      ctx.fillStyle = rgba(palette.ink, 0.78);
      wrapLines(ctx, scene.subtitle, maxW).forEach((ln, i) => ctx.fillText(ln, f.w / 2, top + total + 0.09 * f.u + i * sub * 1.3 + (1 - k) * 0.02 * f.u));
      ctx.restore();
    }
  }
}
