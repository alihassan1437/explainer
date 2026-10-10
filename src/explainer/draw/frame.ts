// The one entry point that draws a frame. It is a pure function of the project, the time and the size: no clock, no randomness, no hidden state.
// Preview, scrubbing, export and agent checks all call this, so they cannot disagree.

import type { Project } from '../types';
import { THEMES, paletteOf } from '../theme';
import { layoutTimeline, sceneAt } from '../timing';
import { clamp, easeOut, font, rgba, roundRectPath, wrapLines } from './primitives';
import { frameLayout } from './layout';
import type { Env } from './env';
import { drawTitle } from '../blocks/title';
import { drawBullets } from '../blocks/bullets';
import { drawDrawing } from '../drawing/render';
import { drawCaptions } from './captions';

const FADE_MS = 280;

/** Draws the video at time `t` (milliseconds) onto a canvas context that is `w` by `h` pixels. */
export function drawFrame(ctx: CanvasRenderingContext2D, project: Project, t: number, w: number, h: number) {
  const theme = THEMES[project.theme];
  const palette = paletteOf(project);
  const f = frameLayout(w, h);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  drawBackground(ctx, w, h, palette, theme.grid, f.u);

  const { items, totalMs } = layoutTimeline(project);
  const now = clamp(t, 0, Math.max(0, totalMs));
  const item = sceneAt(items, now);
  if (item) {
    const len = item.endMs - item.startMs, local = now - item.startMs;
    const fade = Math.min(easeOut(local / FADE_MS), easeOut((len - local) / FADE_MS));
    const env: Env = { ctx, project, theme, palette, f, t: local, len, startMs: item.startMs, globalMs: now, words: project.narration?.words };
    ctx.globalAlpha = clamp(fade);
    const s = item.scene;
    if (s.block === 'title') drawTitle(env, s);
    else if (s.block === 'bullets') drawBullets(env, s);
    else {
      drawSceneTitle(env, s.title);
      drawDrawing(env, s);
    }
    if (project.captions !== false) drawCaptions(ctx, project, palette, f, now);
  }
  ctx.restore();
}

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number, p: ReturnType<typeof paletteOf>, grid: boolean, u: number) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, p.bgTop); g.addColorStop(1, p.bgBottom);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  if (!grid) return;
  const step = u / 16;
  ctx.strokeStyle = rgba('#7db4ff', 0.06); ctx.lineWidth = Math.max(1, u / 900);
  ctx.beginPath();
  for (let x = 0; x <= w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (let y = 0; y <= h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();
}

function drawSceneTitle(env: Env, title: string | undefined) {
  if (!title) return;
  const { ctx, f, palette } = env;
  ctx.save();
  ctx.font = font(0.05 * f.u, 800);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillStyle = palette.accent2;
  const lines = wrapLines(ctx, title, f.head.w);
  ctx.fillText(lines[0], f.head.x, f.head.y + f.head.h / 2);
  roundRectPath(ctx, f.head.x, f.head.y + f.head.h * 0.96, 0.08 * f.u, 0.006 * f.u, 0.003 * f.u);
  ctx.fillStyle = palette.accent; ctx.fill();
  ctx.restore();
}
