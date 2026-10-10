// Word-by-word captions, drawn by the renderer (not overlaid by the page),
// so preview, scrubbing and export always agree. The current word is lit;
// the words around it are dimmed. Pure: a frame is a function of the time.

import type { Palette, Project, WordTime } from '../types';
import type { FrameLayout } from './layout';
import { clamp, font, rgba } from './primitives';

export interface CaptionWord { text: string; active: boolean }

/**
 * The words to show at `t`: the current sentence (up to a boundary or a
 * length cap), with the spoken word marked. Empty when nothing is spoken.
 */
export function captionWindow(words: WordTime[], t: number): { items: CaptionWord[]; alpha: number } {
  if (!words.length) return { items: [], alpha: 0 };
  let idx = -1;
  for (let i = 0; i < words.length; i++) {
    if (t >= words[i].startMs && t < words[i].endMs) { idx = i; break; }
  }
  if (idx === -1) {
    // Just after the last word: hold the final caption briefly, fading out.
    const last = words[words.length - 1];
    if (t >= last.endMs && t < last.endMs + 700) {
      const w = captionWindow(words, last.endMs - 1);
      return { items: w.items, alpha: 1 - (t - last.endMs) / 700 };
    }
    return { items: [], alpha: 0 };
  }
  // Walk out to sentence boundaries, capped at 16 words.
  let from = idx, to = idx;
  while (from > 0 && idx - from < 15 && !/[.!?…]$/.test(words[from - 1].text)) from--;
  while (to < words.length - 1 && to - idx < 15 && !/[.!?…]$/.test(words[to].text)) to++;
  const items = words.slice(from, to + 1).map((w, k) => ({ text: w.text, active: from + k === idx }));
  const fadeIn = clamp((t - words[idx].startMs) / 120);
  return { items, alpha: Math.min(1, fadeIn + 0.25) };
}

/** Draws the caption for this moment, centred in the strip below the safe area. */
export function drawCaptions(
  ctx: CanvasRenderingContext2D,
  project: Project,
  palette: Palette,
  f: FrameLayout,
  t: number
): void {
  const narration = project.narration;
  if (!narration?.words.length) return;
  const { items, alpha } = captionWindow(narration.words, t);
  if (!items.length || alpha <= 0) return;

  const size = 0.034 * f.u;
  ctx.save();
  ctx.globalAlpha = clamp(alpha);
  ctx.font = font(size, 600);
  ctx.textBaseline = 'middle';

  // Wrap into centred lines.
  const maxW = f.safe.w * 0.92;
  const space = ctx.measureText(' ').width;
  const lines: CaptionWord[][] = [[]];
  let lineW = 0;
  for (const item of items) {
    const w = ctx.measureText(item.text).width;
    if (lineW + w > maxW && lines[lines.length - 1].length) { lines.push([]); lineW = 0; }
    lines[lines.length - 1].push(item);
    lineW += w + space;
  }
  const stripTop = f.safe.y + f.safe.h;
  const stripH = f.h - stripTop - 0.015 * f.h;
  const lineH = size * 1.45;
  const totalH = lines.length * lineH;
  let y = stripTop + (stripH - totalH) / 2 + lineH / 2;

  for (const line of lines) {
    const widths = line.map(item => ctx.measureText(item.text).width);
    const total = widths.reduce((a, b) => a + b, 0) + space * (line.length - 1);
    let x = f.safe.x + (f.safe.w - total) / 2;
    line.forEach((item, i) => {
      // A soft dark pill behind the lit word so it reads on any background.
      if (item.active) {
        ctx.fillStyle = rgba(palette.accent, 0.9);
        const pad = size * 0.28;
        const bx = x - pad, bw = widths[i] + pad * 2, bh = size * 1.5;
        ctx.beginPath();
        if (typeof (ctx as unknown as { roundRect?: unknown }).roundRect === 'function') {
          (ctx as unknown as { roundRect: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect(bx, y - bh / 2, bw, bh, bh / 2);
        } else {
          ctx.rect(bx, y - bh / 2, bw, bh);
        }
        ctx.fill();
      }
      ctx.fillStyle = item.active ? palette.bgBottom : rgba(palette.ink, 0.92);
      ctx.textAlign = 'left';
      ctx.fillText(item.text, x, y);
      x += widths[i] + space;
    });
    y += lineH;
  }
  ctx.restore();
}
