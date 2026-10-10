// Draws an agent's drawing. Two steps, so each can be checked on its own:
//   evalDrawing: works out every shape's numbers and colours for one moment (pure; returns plain data, nothing is drawn)
//   paintDrawing: puts those shapes on the canvas.
// Neither reads the clock, random numbers or anything else outside its inputs, so a frame is always the same.

import { evaluate, safe, type Scope } from '../expr';
import type { Palette, Project, WordTime } from '../types';
import type { Theme } from '../theme';
import { clamp, font, glow, mix, rgba, smoothstep, wrapLines } from '../draw/primitives';
import { resolveAt } from '../timing';
import type { Env } from '../draw/env';
import { DLIMITS, compiledFor, type CColor, type CNum, type CShape, type CompiledDrawing } from './compile';
import type { DrawingScene } from './types';

export interface EvalCtx {
  /** Milliseconds into the scene, and the scene's length. */
  t: number; len: number; startMs: number; words?: WordTime[];
  project: Pick<Project, 'parts'>; theme: Theme; palette: Palette; portrait: boolean;
}

export interface Cmd {
  kind: CShape['type'];
  id?: string; part?: string;
  /** Which copy of a repeated shape this is. */
  copy: number;
  /** Numbers in the drawing's own units: line x1 y1 x2 y2; rect x0 y0 x1 y1 radius; circle x y r; text x y size; radial x0 y0 x1 y1 (its strength is the shape's alpha). */
  p: number[];
  pts?: [number, number][]; close?: boolean;
  text?: string; align?: 'left' | 'center' | 'right'; weight?: number;
  fill: string | null; stroke: string | null;
  alpha: number; width: number; emph: number; dash?: [number, number];
}
export interface LabelCmd { part: string; text: string; ax: number; ay: number; tx: number; ty: number; align: 'left' | 'right'; color: string; emph: number }
export interface PanelCmd { title?: string; counter?: number; items: { title: string; text: string; active: boolean; progress: number; color: string }[] }
export interface Evaluated { cmds: Cmd[]; labels: LabelCmd[]; panel?: PanelCmd; scope: Record<string, number>; partColors: Record<string, string>; overBudget: boolean; used: number }

const envelope = (local: number, dur: number) => (local < 0 || local > dur ? 0 : smoothstep(0, 220, local) * (1 - smoothstep(dur - 500, dur, local)));

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export const bodyOf = (theme: Theme, palette: Palette, color: string) => (theme.filled ? color : rgba(palette.bgBottom, 0.94));
export const outlineOf = (theme: Theme, palette: Palette, color: string) => (theme.filled ? mix(color, palette.ink, 0.65) : color);

export function evalDrawing(c: CompiledDrawing, x: EvalCtx): Evaluated {
  const { theme, palette } = x;
  const scope: Record<string, number> = Object.create(null);
  let used = 0, over = false;
  const ev = (n: CNum | undefined, fallback = 0): number => {
    if (!n) return fallback;
    if (n.v !== undefined) return n.v;
    used += n.e!.cost;
    if (used > DLIMITS.frameCost) { over = true; return fallback; }
    return safe(evaluate(n.e!, scope as Scope));
  };

  // built-in values, params, events, highlights, then the drawing's own vars in order
  scope.t = x.t / 1000; scope.ms = x.t; scope.p = x.len > 0 ? clamp(x.t / x.len) : 0; scope.len = x.len / 1000; scope.portrait = x.portrait ? 1 : 0; scope.flat = theme.filled ? 1 : 0;
  Object.assign(scope, c.params);
  const span = { startMs: x.startMs, endMs: x.startMs + x.len };
  for (const e of c.events) {
    const at = resolveAt(e.at, span, x.words);
    const local = at === null ? -1 : x.t - at;
    scope[e.name] = envelope(local, e.ms);
    scope[`${e.name}_age`] = local < 0 ? 0 : local / 1000;
  }
  const hl: Record<string, number> = {};
  for (const part of Object.keys(c.parts)) hl[part] = 0;
  for (const cue of c.cues) {
    const at = resolveAt(cue.at, span, x.words);
    if (at !== null) hl[cue.part] = Math.max(hl[cue.part] ?? 0, envelope(x.t - at, cue.ms ?? 2400));
  }
  for (const [part, v] of Object.entries(hl)) scope[`hl_${part}`] = v;
  for (const [name, n] of c.vars) scope[name] = ev(n);

  // colours
  const partCache: Record<string, string> = {};
  const scene = c.scene;
  const resolve = (spec: CColor, own: string | null, depth = 0): string => {
    if (spec.k === 'mix') return mix(resolve(spec.a, own, depth + 1), resolve(spec.b, own, depth + 1), ev(spec.by));
    if (spec.k === 'theme') return resolve(theme.id === 'flat' ? spec.f : spec.b, own, depth + 1);
    const s = spec.s;
    if (s.startsWith('#')) return s;
    if (s === 'part') return own ?? palette.ink;
    if (has(palette, s)) return palette[s as keyof Palette];
    return depth < 4 ? partColor(s) : palette.ink;
  };
  const partColor = (name: string): string => {
    if (partCache[name]) return partCache[name];
    const picked = scene.colors?.[name] ?? x.project.parts?.[name];
    const out = picked ?? (has(c.parts, name) ? resolve(c.parts[name].color, null, 1) : palette.ink);
    return (partCache[name] = out);
  };
  const isPartRef = (s: CColor | 'none' | 'body' | undefined) => !!s && s !== 'none' && s !== 'body' && s.k === 's' && (s.s === 'part' || has(c.parts, s.s));

  const cmds: Cmd[] = [];
  for (const sh of c.shapes) {
    if (over) break;
    const copies = sh.repeat ?? 1;
    for (let copy = 0; copy < copies; copy++) {
      if (sh.repeat) { scope.i = copy; scope.n = copies; }
      for (const [name, n] of sh.lets) scope[name] = ev(n);
      if (sh.when && !ev(sh.when)) continue;
      const own = sh.part ? partColor(sh.part) : null;
      const closed = sh.type === 'rect' || sh.type === 'circle' || ((sh.type === 'poly' || sh.type === 'curve') && !!sh.close);
      const alpha = clamp(ev(sh.alpha, 1));
      const emph = clamp(Math.max(ev(sh.emph, 0), sh.part ? hl[sh.part] ?? 0 : 0));
      const base = { kind: sh.type, id: sh.id, part: sh.part, copy, alpha, width: Math.max(0, ev(sh.width, 1)), emph, ...(sh.dash ? { dash: sh.dash } : {}) };

      let stroke: string | null;
      if (sh.stroke === 'none') stroke = null;
      else if (sh.stroke) stroke = isPartRef(sh.stroke) ? outlineOf(theme, palette, resolve(sh.stroke, own)) : resolve(sh.stroke, own);
      else stroke = own ? outlineOf(theme, palette, own) : palette.ink;
      let fill: string | null;
      if (sh.fill === 'none') fill = null;
      else if (sh.fill === 'body') fill = bodyOf(theme, palette, own ?? palette.ink);
      else if (sh.fill) fill = resolve(sh.fill, own);
      else fill = closed && own ? bodyOf(theme, palette, own) : null;

      if (sh.type === 'line') cmds.push({ ...base, p: [ev(sh.n.x1), ev(sh.n.y1), ev(sh.n.x2), ev(sh.n.y2)], fill: null, stroke });
      else if (sh.type === 'rect') cmds.push({ ...base, p: [ev(sh.n.x0), ev(sh.n.y0), ev(sh.n.x1), ev(sh.n.y1), ev(sh.n.radius)], fill, stroke });
      else if (sh.type === 'circle') cmds.push({ ...base, p: [ev(sh.n.x), ev(sh.n.y), Math.max(0, ev(sh.n.r))], fill, stroke });
      else if (sh.type === 'poly') cmds.push({ ...base, p: [], pts: (sh.pts ?? []).map(([a, b]) => [ev(a), ev(b)] as [number, number]), close: sh.close !== false, fill, stroke });
      else if (sh.type === 'curve') {
        const pts: [number, number][] = [];
        const nn = sh.curveN ?? 1;
        for (let j = 0; j <= nn; j++) { scope.j = j; scope.u = j / nn; pts.push([ev(sh.n.x), ev(sh.n.y)]); }
        delete scope.j; delete scope.u;
        cmds.push({ ...base, p: [], pts, close: !!sh.close, fill, stroke });
      } else if (sh.type === 'text') {
        const textFill = sh.fill && sh.fill !== 'none' && sh.fill !== 'body' ? resolve(sh.fill, own) : own ? outlineOf(theme, palette, own) : palette.ink;
        cmds.push({ ...base, p: [ev(sh.n.x), ev(sh.n.y), Math.max(0.01, ev(sh.n.size))], text: sh.text, align: sh.align, weight: sh.weight, fill: textFill, stroke: null });
      } else if (sh.type === 'radial') {
        const r = sh.rect ?? [];
        cmds.push({ ...base, p: [ev(r[0]), ev(r[1]), ev(r[2]), ev(r[3])], fill: sh.color ? resolve(sh.color, own) : palette.accent, stroke: null });
      }
    }
    delete scope.i; delete scope.n;
    for (const [name] of sh.lets) delete scope[name];
  }

  const labels: LabelCmd[] = [];
  if (scene.showLabels !== false) {
    for (const [part, def] of Object.entries(c.parts)) {
      if (!def.label) continue;
      labels.push({ part, text: def.label.text, ax: ev(def.label.at[0]), ay: ev(def.label.at[1]), tx: ev(def.label.to[0]), ty: ev(def.label.to[1]), align: def.label.align, color: outlineOf(theme, palette, partColor(part)), emph: hl[part] ?? 0 });
    }
  }

  let panel: PanelCmd | undefined;
  if (c.panel) {
    panel = {
      ...(c.panel.title ? { title: c.panel.title } : {}), ...(c.panel.counter ? { counter: ev(c.panel.counter) } : {}),
      items: c.panel.items.map(it => ({ title: it.title, text: it.text, active: ev(it.active) !== 0, progress: clamp(ev(it.progress)), color: it.color ? resolve(it.color, null) : palette.accent })),
    };
  }
  return { cmds, labels, ...(panel ? { panel } : {}), scope, partColors: Object.fromEntries(Object.keys(c.parts).map(p => [p, partColor(p)])), overBudget: over, used };
}

// ---- painting ----

export function paintDrawing(env: Env, c: CompiledDrawing, r: Evaluated) {
  const { ctx, theme, palette, f } = env;
  const stage = c.scene.stage;
  const k = Math.min(f.stage.w / stage.w, f.stage.h / stage.h);
  const cx = f.stage.x + f.stage.w / 2, cy = f.stage.y + f.stage.h / 2;
  const X = (x: number) => cx + (x - (stage.cx ?? 0)) * k, Y = (y: number) => cy - (y - (stage.cy ?? 0)) * k;
  const lw = 0.034 * k * theme.line;

  ctx.save();
  for (const m of r.cmds) {
    ctx.save();
    if (m.kind !== 'radial') ctx.globalAlpha *= m.alpha;
    if (m.kind === 'radial') {
      const x0 = X(m.p[0]), x1 = X(m.p[2]), y1 = Y(m.p[1]), y0 = Y(m.p[3]);
      ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
      const g = ctx.createRadialGradient((x0 + x1) / 2, (y0 + y1) / 2, 0, (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) * 0.75);
      g.addColorStop(0, rgba(m.fill ?? palette.hot, 0.85 * m.alpha)); g.addColorStop(1, rgba(m.fill ?? palette.hot, 0.18 * m.alpha));
      ctx.fillStyle = g; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.restore();
      continue;
    }
    if (m.kind === 'text') {
      ctx.font = font(m.p[2] * k, m.weight ?? 600);
      ctx.textAlign = m.align ?? 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = m.fill ?? palette.ink;
      ctx.fillText(m.text ?? '', X(m.p[0]), Y(m.p[1]));
      ctx.restore();
      continue;
    }
    const path = () => {
      ctx.beginPath();
      if (m.kind === 'line') { ctx.moveTo(X(m.p[0]), Y(m.p[1])); ctx.lineTo(X(m.p[2]), Y(m.p[3])); }
      else if (m.kind === 'rect') {
        const x0 = X(Math.min(m.p[0], m.p[2])), x1 = X(Math.max(m.p[0], m.p[2])), y0 = Y(Math.max(m.p[1], m.p[3])), y1 = Y(Math.min(m.p[1], m.p[3]));
        const rad = Math.min(m.p[4] * k, (x1 - x0) / 2, (y1 - y0) / 2);
        if (rad > 0.5) { ctx.moveTo(x0 + rad, y0); ctx.arcTo(x1, y0, x1, y1, rad); ctx.arcTo(x1, y1, x0, y1, rad); ctx.arcTo(x0, y1, x0, y0, rad); ctx.arcTo(x0, y0, x1, y0, rad); ctx.closePath(); }
        else ctx.rect(x0, y0, x1 - x0, y1 - y0);
      } else if (m.kind === 'circle') ctx.arc(X(m.p[0]), Y(m.p[1]), m.p[2] * k, 0, Math.PI * 2);
      else (m.pts ?? []).forEach(([x, y], i) => { if (i) ctx.lineTo(X(x), Y(y)); else ctx.moveTo(X(x), Y(y)); });
      if ((m.kind === 'poly' || m.kind === 'curve') && m.close) ctx.closePath();
    };
    if (m.fill) { path(); ctx.fillStyle = m.fill; ctx.fill(); }
    if (m.stroke) {
      ctx.strokeStyle = m.stroke; ctx.lineWidth = lw * m.width * (1 + 0.8 * m.emph); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      if (m.dash) ctx.setLineDash([lw * m.dash[0], lw * m.dash[1]]);
      const draw = () => { path(); ctx.stroke(); };
      if (m.emph > 0.02 && theme.glow > 0) glow(ctx, m.stroke, 22 * m.emph * theme.glow, draw); else draw();
    }
    ctx.restore();
  }

  for (const l of r.labels) {
    const [tx, ty, lx, ly] = [X(l.tx), Y(l.ty), X(l.ax), Y(l.ay)];
    ctx.strokeStyle = rgba(l.color, 0.55 + 0.4 * l.emph); ctx.lineWidth = lw * 0.55;
    ctx.beginPath(); ctx.moveTo(lx + (l.align === 'left' ? -0.06 * k : 0.06 * k), ly); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.fillStyle = l.color; ctx.beginPath(); ctx.arc(tx, ty, 0.035 * k, 0, Math.PI * 2); ctx.fill();
    ctx.font = font(0.19 * k, l.emph > 0.1 ? 800 : 600); ctx.textAlign = l.align === 'left' ? 'left' : 'right'; ctx.textBaseline = 'middle';
    if (theme.glow > 0 && l.emph > 0.05) glow(ctx, l.color, 14 * l.emph, () => ctx.fillText(l.text, lx, ly)); else ctx.fillText(l.text, lx, ly);
  }
  ctx.restore();

  if (r.panel) paintPanel(env, r.panel);
}

/** A list of explanations beside (or under) the drawing: the one that is lit is explained, the rest are dimmed. */
function paintPanel(env: Env, panel: PanelCmd) {
  const { ctx, theme, palette, f } = env;
  const rc = f.panel, u = f.u, head = 0.045 * u;
  ctx.save();
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.font = font(0.026 * u, 700); ctx.fillStyle = palette.dim;
  ctx.fillText(`${(panel.title ?? '').toUpperCase()}${panel.counter !== undefined ? `  ·  ${Math.round(panel.counter)}` : ''}`, rc.x, rc.y + head / 2);
  const rowH = (rc.h - head) / Math.max(1, panel.items.length);
  panel.items.forEach((it, i) => {
    const y = rc.y + head + i * rowH;
    ctx.save();
    if (it.active) {
      ctx.fillStyle = rgba(it.color, theme.filled ? 0.16 : 0.1); ctx.fillRect(rc.x, y + rowH * 0.04, rc.w, rowH * 0.92);
      ctx.fillStyle = it.color; ctx.fillRect(rc.x, y + rowH * 0.04, 0.007 * u, rowH * 0.92);
      ctx.fillRect(rc.x, y + rowH * 0.96 - 0.006 * u, rc.w * it.progress, 0.006 * u);
    }
    ctx.globalAlpha *= it.active ? 1 : 0.5;
    ctx.fillStyle = it.active ? it.color : palette.ink; ctx.font = font(0.03 * u, 800);
    ctx.fillText(`${i + 1}  ${it.title.toUpperCase()}`, rc.x + 0.022 * u, y + (it.active ? 0.036 * u : rowH / 2));
    if (it.active) {
      ctx.fillStyle = palette.ink; ctx.font = font(0.0235 * u, 500);
      wrapLines(ctx, it.text, rc.w - 0.045 * u).slice(0, 4).forEach((ln, li) => ctx.fillText(ln, rc.x + 0.022 * u, y + 0.036 * u + (li + 1) * 0.034 * u));
    }
    ctx.restore();
  });
  ctx.restore();
}

/** What the frame calls: evaluate this moment of a drawing, then paint it. */
export function drawDrawing(env: Env, scene: DrawingScene) {
  const compiled = compiledFor(scene);
  const result = evalDrawing(compiled, { t: env.t, len: env.len, startMs: env.startMs, words: env.words, project: env.project, theme: env.theme, palette: env.palette, portrait: !env.f.landscape });
  paintDrawing(env, compiled, result);
}
