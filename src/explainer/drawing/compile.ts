// Checks an agent's drawing and prepares it to be drawn: every expression is parsed and every name is checked once, here, so drawing a frame
// can never fail halfway. Problems come back as plain sentences that say where and what, so the agent can fix them. A shape with a problem is
// left out (and reported) while the rest still draws, so a preview is always something to look at.

import { compile, RESERVED, type Expr } from '../expr';
import type { At, Issue } from '../types';
import { cleanAt } from '../timing';
import type { ColorSpec, DrawingCue, DrawingScene, Num } from './types';

export const DLIMITS = {
  shapes: 90, repeat: 200, vars: 60, lets: 30, params: 40, parts: 24, points: 32, curveN: 200, panelItems: 6, text: 80, events: 12, cues: 40,
  /** The most expression work one frame may need (counted in expression parts). Drawing stops past it. */
  frameCost: 220_000,
} as const;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
export const PALETTE_SLOTS = ['bgTop', 'bgBottom', 'ink', 'dim', 'accent', 'accent2', 'hot', 'good', 'panel'] as const;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
/** Names that mean something special to JavaScript objects; a drawing may not use them for its own names. */
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype', 'hasOwnProperty', 'toString', 'valueOf', 'isPrototypeOf']);
export const validName = (name: string) => IDENT.test(name) && !FORBIDDEN.has(name);
const BUILTIN = ['t', 'ms', 'p', 'len', 'portrait', 'flat'] as const;
const PER_COPY = ['i', 'n'] as const;
/** Inside a curve: the point number j (0 up to n) and u, how far along the curve it is (0 to 1). */
const PER_POINT = ['j', 'u'] as const;

type R = Record<string, unknown>;
const isObj = (v: unknown): v is R => !!v && typeof v === 'object' && !Array.isArray(v);

/** A number written as a number, or as an expression. */
export interface CNum { v?: number; e?: Expr }
export type CColor = { k: 's'; s: string } | { k: 'mix'; a: CColor; b: CColor; by: CNum } | { k: 'theme'; b: CColor; f: CColor };

export interface CShape {
  type: 'line' | 'rect' | 'circle' | 'poly' | 'curve' | 'text' | 'radial';
  index: number;
  id?: string; part?: string;
  when?: CNum; repeat?: number;
  lets: [string, CNum][];
  n: Record<string, CNum>;
  pts?: [CNum, CNum][]; rect?: CNum[]; close?: boolean; curveN?: number;
  text?: string; align?: 'left' | 'center' | 'right'; weight?: number;
  color?: CColor;
  fill?: CColor | 'none' | 'body'; stroke?: CColor | 'none';
  alpha?: CNum; width?: CNum; emph?: CNum; dash?: [number, number];
}
export interface CLabel { text: string; at: [CNum, CNum]; to: [CNum, CNum]; align: 'left' | 'right' }
export interface CPanel { title?: string; counter?: CNum; items: { title: string; text: string; active: CNum; progress?: CNum; color?: CColor }[] }

export interface CompiledDrawing {
  scene: DrawingScene;
  params: Record<string, number>;
  vars: [string, CNum][];
  events: { name: string; at: At; ms: number }[];
  cues: DrawingCue[];
  parts: Record<string, { color: CColor; label?: CLabel }>;
  shapes: CShape[];
  panel?: CPanel;
  /** About how much expression work one frame needs. */
  cost: number;
}

export function compileDrawing(raw: unknown, sceneNo: number): { compiled: CompiledDrawing; issues: Issue[] } {
  const issues: Issue[] = [];
  const at = `Scene ${sceneNo}`;
  const add = (level: Issue['level'], message: string) => issues.push({ level, sceneIndex: sceneNo - 1, message: `${at}: ${message}` });
  const input: R = isObj(raw) ? raw : {};
  let cost = 0;

  // ---- the stage ----
  const st = isObj(input.stage) ? input.stage : {};
  const sw = typeof st.w === 'number' && st.w > 0 && st.w <= 100 ? st.w : 8, sh = typeof st.h === 'number' && st.h > 0 && st.h <= 100 ? st.h : 6;
  if (!isObj(input.stage) || typeof st.w !== 'number' || typeof st.h !== 'number') add('warning', 'stage needs w and h (the size of the drawing in its own units, for example { "w": 8, "h": 6 }); 8 by 6 is used.');
  const stage = { w: sw, h: sh, cx: typeof st.cx === 'number' ? st.cx : 0, cy: typeof st.cy === 'number' ? st.cy : 0 };

  // ---- names an expression may use ----
  const known = new Set<string>([...BUILTIN]);
  const claim = (name: string, what: string): boolean => {
    if (!validName(name)) { add('error', `${what} "${name}" is not a valid name (letters, digits and _, starting with a letter).`); return false; }
    if (RESERVED.has(name.toLowerCase()) || (BUILTIN as readonly string[]).includes(name) || (PER_COPY as readonly string[]).includes(name) || (PER_POINT as readonly string[]).includes(name)) { add('error', `${what} "${name}" is a built-in name; choose another.`); return false; }
    if (known.has(name)) { add('error', `${what} "${name}" is already used.`); return false; }
    known.add(name);
    return true;
  };

  const params: Record<string, number> = {};
  if (input.params !== undefined && !isObj(input.params)) add('warning', '"params" must be an object of names to numbers.');
  for (const [k, v] of Object.entries(isObj(input.params) ? input.params : {}).slice(0, DLIMITS.params)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) { add('error', `params.${k} must be a number.`); continue; }
    if (claim(k, 'The param')) params[k] = v;
  }

  const num = (v: unknown, scope: ReadonlySet<string>, where: string): CNum | undefined => {
    if (typeof v === 'number') { if (Number.isFinite(v)) return { v }; add('error', `${where} is not a finite number.`); return undefined; }
    if (typeof v === 'string') {
      const r = compile(v, scope);
      if ('error' in r) { add('error', `${where}: the expression "${v.length > 60 ? v.slice(0, 60) + '…' : v}" ${r.error}.`); return undefined; }
      cost += r.expr.cost;
      return { e: r.expr };
    }
    add('error', `${where} must be a number or an expression written as a string.`);
    return undefined;
  };

  // ---- parts (their colours may use palette slots, hex and blends, but not other parts) ----
  const partNames = new Set<string>();
  const rawParts = isObj(input.parts) ? input.parts : {};
  const entries = Object.entries(rawParts).slice(0, DLIMITS.parts);
  if (Object.keys(rawParts).length > DLIMITS.parts) add('warning', `Only the first ${DLIMITS.parts} parts are used.`);
  for (const [name] of entries) if (validName(name)) partNames.add(name); else add('error', `The part "${name}" is not a valid name (letters, digits and _, starting with a letter).`);

  const color = (v: unknown, scope: ReadonlySet<string>, where: string, parts: ReadonlySet<string> | null, depth = 0): CColor | undefined => {
    if (depth > 4) { add('error', `${where} is nested too deeply.`); return undefined; }
    if (typeof v === 'string') {
      if (HEX.test(v) || (PALETTE_SLOTS as readonly string[]).includes(v) || v === 'part' && parts !== null || (parts?.has(v) ?? false)) return { k: 's', s: v };
      add('error', `${where}: "${v}" is not a colour. Use a hex like #ff6a00, a palette name (${PALETTE_SLOTS.join(', ')})${parts ? ', "part", or the name of one of the parts' : ''}.`);
      return undefined;
    }
    if (isObj(v) && Array.isArray(v.mix) && v.mix.length === 2) {
      const a = color(v.mix[0], scope, where, parts, depth + 1), b = color(v.mix[1], scope, where, parts, depth + 1), by = num(v.by, scope, `${where} (by)`);
      return a && b && by ? { k: 'mix', a, b, by } : undefined;
    }
    if (isObj(v) && isObj(v.byTheme)) {
      const b = color(v.byTheme.blueprint, scope, where, parts, depth + 1), f = color(v.byTheme.flat, scope, where, parts, depth + 1);
      return b && f ? { k: 'theme', b, f } : undefined;
    }
    add('error', `${where} must be a colour: a hex, a palette name, { "mix": [a, b], "by": 0.5 } or { "byTheme": { "blueprint": a, "flat": b } }.`);
    return undefined;
  };

  // ---- values worked out every frame, in order ----
  const vars: [string, CNum][] = [];
  const rawVars = isObj(input.vars) ? input.vars : {};
  if (Object.keys(rawVars).length > DLIMITS.vars) add('warning', `Only the first ${DLIMITS.vars} vars are used.`);

  // events and highlights give values too, so they are known before the vars that may use them
  const events: CompiledDrawing['events'] = [];
  const rawEvents = isObj(input.events) ? input.events : {};
  for (const [name, ev] of Object.entries(rawEvents).slice(0, DLIMITS.events)) {
    const when = isObj(ev) ? cleanAt(ev.at) : undefined;
    if (when === undefined) { add('error', `The event "${name}" needs "at" (a time in ms, { "word": "..." } or { "frac": 0.5 }).`); continue; }
    if (!claim(name, 'The event') || !claim(`${name}_age`, 'The event')) continue;
    events.push({ name, at: when, ms: isObj(ev) && typeof ev.ms === 'number' && ev.ms > 0 ? Math.min(60000, ev.ms) : 2400 });
  }
  for (const p of partNames) known.add(`hl_${p}`);

  for (const [name, expr] of Object.entries(rawVars).slice(0, DLIMITS.vars)) {
    const c = num(expr, known, `vars.${name}`);
    if (c && claim(name, 'The var')) vars.push([name, c]);
  }

  // part colours and labels (labels may use any value)
  const parts: CompiledDrawing['parts'] = {};
  for (const [name, p] of entries) {
    if (!partNames.has(name)) continue;
    const spec = isObj(p) ? p : {};
    const c = spec.color === undefined ? ({ k: 's', s: 'ink' } as CColor) : color(spec.color, known, `parts.${name}.color`, null);
    const part: { color: CColor; label?: CLabel } = { color: c ?? { k: 's', s: 'ink' } };
    if (isObj(spec.label)) {
      const l = spec.label, a = Array.isArray(l.at) ? l.at : [], t = Array.isArray(l.to) ? l.to : [];
      const ax = num(a[0], known, `parts.${name}.label.at[0]`), ay = num(a[1], known, `parts.${name}.label.at[1]`), tx = num(t[0], known, `parts.${name}.label.to[0]`), ty = num(t[1], known, `parts.${name}.label.to[1]`);
      if (typeof l.text === 'string' && l.text.trim() && ax && ay && tx && ty) part.label = { text: l.text.trim().slice(0, 40), at: [ax, ay], to: [tx, ty], align: l.align === 'right' ? 'right' : 'left' };
      else if (!(typeof l.text === 'string' && l.text.trim())) add('error', `parts.${name}.label needs "text".`);
    }
    parts[name] = part;
  }

  // ---- highlight cues ----
  const cues: DrawingCue[] = [];
  for (const c of (Array.isArray(input.cues) ? input.cues : []).slice(0, DLIMITS.cues)) {
    const when = isObj(c) ? cleanAt(c.at) : undefined;
    if (!isObj(c) || c.do !== 'highlight' || typeof c.part !== 'string' || !partNames.has(c.part) || when === undefined) { add('warning', `A cue must be { "at": ..., "do": "highlight", "part": <one of ${[...partNames].join(', ') || 'your parts'}> }, so it is skipped.`); continue; }
    cues.push({ at: when, do: 'highlight', part: c.part, ...(typeof c.ms === 'number' && c.ms > 0 ? { ms: Math.min(10000, c.ms) } : {}) });
  }

  // ---- shapes ----
  const shapes: CShape[] = [];
  const rawShapes = Array.isArray(input.shapes) ? input.shapes : [];
  if (!rawShapes.length) add('error', 'There are no shapes. Add "shapes": [ ... ] with at least one shape.');
  if (rawShapes.length > DLIMITS.shapes) add('warning', `Only the first ${DLIMITS.shapes} shapes are used. Use "repeat" for many similar shapes.`);
  const NUMS: Record<string, string[]> = { line: ['x1', 'y1', 'x2', 'y2'], rect: ['x0', 'y0', 'x1', 'y1'], circle: ['x', 'y', 'r'], poly: [], curve: ['x', 'y'], text: ['x', 'y', 'size'], radial: [] };

  rawShapes.slice(0, DLIMITS.shapes).forEach((s, index) => {
    const label = `shape ${index + 1}${isObj(s) && typeof s.id === 'string' ? ` ("${s.id}")` : ''}`;
    if (!isObj(s) || typeof s.type !== 'string' || !Object.prototype.hasOwnProperty.call(NUMS, s.type)) { add('error', `${label} must have a type: ${Object.keys(NUMS).join(', ')}.`); return; }
    const type = s.type as CShape['type'];
    const errorsBefore = issues.filter(i => i.level === 'error').length;
    const shape: CShape = { type, index, lets: [], n: {} };
    if (typeof s.id === 'string') shape.id = s.id.slice(0, 40);
    if (s.part !== undefined) { if (typeof s.part === 'string' && partNames.has(s.part)) shape.part = s.part; else add('error', `${label} uses the part "${String(s.part)}", which is not in "parts".`); }

    let repeat = 1;
    if (s.repeat !== undefined) {
      if (typeof s.repeat === 'number' && Number.isInteger(s.repeat) && s.repeat >= 1 && s.repeat <= DLIMITS.repeat) { repeat = s.repeat; shape.repeat = repeat; }
      else add('error', `${label}: repeat must be a whole number from 1 to ${DLIMITS.repeat}.`);
    }
    const scope = new Set(known);
    if (shape.repeat) for (const k of PER_COPY) scope.add(k);
    if (s.let !== undefined) {
      if (!isObj(s.let)) add('error', `${label}: "let" must be an object of names to expressions.`);
      else for (const [name, expr] of Object.entries(s.let).slice(0, DLIMITS.lets)) {
        const c = num(expr, scope, `${label} let.${name}`);
        if (!validName(name) || RESERVED.has(name.toLowerCase()) || scope.has(name) || (PER_POINT as readonly string[]).includes(name)) { add('error', `${label}: the name "${name}" in "let" is not allowed or is already used.`); continue; }
        if (c) { shape.lets.push([name, c]); scope.add(name); }
      }
    }
    const before = cost;
    if (s.when !== undefined) shape.when = num(s.when, scope, `${label} when`);
    const pointScope = new Set(scope);
    if (type === 'curve') for (const k of PER_POINT) pointScope.add(k);
    for (const f of NUMS[type]) {
      const c = num(s[f], type === 'curve' ? pointScope : scope, `${label} ${f}`);
      if (c) shape.n[f] = c; else if (s[f] === undefined) add('error', `${label} (${type}) needs "${f}".`);
    }
    if (type === 'rect' && s.radius !== undefined) { const c = num(s.radius, scope, `${label} radius`); if (c) shape.n.radius = c; }
    if (type === 'poly') {
      const pts = Array.isArray(s.points) ? s.points.slice(0, DLIMITS.points) : [];
      if (pts.length < 2) add('error', `${label} (poly) needs "points": [[x, y], [x, y], ...] with at least two points.`);
      shape.pts = [];
      pts.forEach((p, k) => {
        const px = num(Array.isArray(p) ? p[0] : undefined, scope, `${label} points[${k}][0]`), py = num(Array.isArray(p) ? p[1] : undefined, scope, `${label} points[${k}][1]`);
        if (px && py) shape.pts!.push([px, py]);
      });
      if (s.close !== undefined) shape.close = s.close !== false; else shape.close = true;
    }
    if (type === 'curve') {
      if (typeof s.n === 'number' && Number.isInteger(s.n) && s.n >= 1 && s.n <= DLIMITS.curveN) shape.curveN = s.n;
      else add('error', `${label} (curve) needs "n", a whole number from 1 to ${DLIMITS.curveN} (the curve is drawn for i = 0 up to n).`);
      shape.close = s.close === true;
    }
    if (type === 'text') {
      if (typeof s.text === 'string' && s.text.trim()) shape.text = s.text.trim().slice(0, DLIMITS.text); else add('error', `${label} (text) needs "text".`);
      shape.align = s.align === 'left' || s.align === 'right' ? s.align : 'center';
      if (typeof s.weight === 'number') shape.weight = Math.max(300, Math.min(900, s.weight));
    }
    if (type === 'radial') {
      const r = Array.isArray(s.rect) ? s.rect : [];
      const four = [0, 1, 2, 3].map(k => num(r[k], scope, `${label} rect[${k}]`));
      if (four.every(Boolean) && r.length === 4) shape.rect = four as CNum[]; else if (r.length !== 4) add('error', `${label} (radial) needs "rect": [x0, y0, x1, y1].`);
      const c = color(s.color, scope, `${label} color`, partNames);
      if (c) shape.color = c; else if (s.color === undefined) add('error', `${label} (radial) needs "color".`);
    }
    // style
    if (s.fill !== undefined) {
      if (s.fill === 'none' || s.fill === 'body') shape.fill = s.fill; else shape.fill = color(s.fill, scope, `${label} fill`, partNames);
    }
    if (s.stroke !== undefined) { if (s.stroke === 'none') shape.stroke = 'none'; else shape.stroke = color(s.stroke, scope, `${label} stroke`, partNames); }
    if (s.alpha !== undefined) shape.alpha = num(s.alpha, scope, `${label} alpha`);
    if (s.width !== undefined) shape.width = num(s.width, scope, `${label} width`);
    if (s.emph !== undefined) shape.emph = num(s.emph, scope, `${label} emph`);
    if (Array.isArray(s.dash) && s.dash.length === 2 && s.dash.every(x => typeof x === 'number' && x > 0)) shape.dash = [s.dash[0] as number, s.dash[1] as number];

    // what this shape costs per frame
    const own = cost - before;
    const copies = type === 'curve' ? repeat * ((shape.curveN ?? 0) + 1) : repeat;
    cost = before + own * copies + shape.lets.reduce((sum, [, c]) => sum + (c.e?.cost ?? 0) * (copies - 1), 0);
    if (issues.filter(i => i.level === 'error').length > errorsBefore) return;   // a shape with a problem is left out
    shapes.push(shape);
  });

  // ---- the side panel ----
  let panel: CPanel | undefined;
  if (isObj(input.panel)) {
    const items = (Array.isArray(input.panel.items) ? input.panel.items : []).slice(0, DLIMITS.panelItems);
    const compiled: CPanel['items'] = [];
    items.forEach((it, k) => {
      if (!isObj(it) || typeof it.title !== 'string' || typeof it.text !== 'string') { add('error', `panel.items[${k}] needs "title" and "text".`); return; }
      const active = num(it.active, known, `panel.items[${k}].active`);
      const progress = it.progress === undefined ? undefined : num(it.progress, known, `panel.items[${k}].progress`);
      const c = it.color === undefined ? undefined : color(it.color, known, `panel.items[${k}].color`, partNames);
      if (active) compiled.push({ title: it.title.slice(0, 40), text: it.text.slice(0, 200), active, ...(progress ? { progress } : {}), ...(c ? { color: c } : {}) });
    });
    const counter = input.panel.counter === undefined ? undefined : num(input.panel.counter, known, 'panel.counter');
    if (compiled.length) panel = { ...(typeof input.panel.title === 'string' ? { title: input.panel.title.slice(0, 50) } : {}), ...(counter ? { counter } : {}), items: compiled };
  }

  if (cost > DLIMITS.frameCost) add('error', `This drawing needs about ${Math.round(cost / 1000)}k expression steps per frame (the limit is ${DLIMITS.frameCost / 1000}k). Lower "repeat" or "n", or move shared work into "vars".`);

  const clean: DrawingScene = {
    block: 'drawing',
    ...(typeof input.title === 'string' && input.title.trim() ? { title: input.title.trim().slice(0, 60) } : {}),
    ...(typeof input.lengthMs === 'number' && Number.isFinite(input.lengthMs) ? { lengthMs: input.lengthMs } : {}),
    stage: { w: stage.w, h: stage.h, cx: stage.cx, cy: stage.cy },
    ...(Object.keys(params).length ? { params } : {}),
    ...(vars.length ? { vars: Object.fromEntries(vars.map(([k]) => [k, (rawVars as Record<string, Num>)[k]])) } : {}),
    ...(partNames.size ? { parts: Object.fromEntries([...partNames].map(k => [k, rawParts[k] as never])) } : {}),
    ...(events.length ? { events: Object.fromEntries(events.map(e => [e.name, { at: e.at, ms: e.ms }])) } : {}),
    ...(cues.length ? { cues } : {}),
    shapes: shapes.map(sh => (rawShapes as R[])[sh.index] as never),
    ...(isObj(input.panel) && panel ? { panel: input.panel as never } : {}),
    ...(input.showLabels === false ? { showLabels: false } : {}),
    ...(isObj(input.colors) ? { colors: Object.fromEntries(Object.entries(input.colors).filter(([k, v]) => partNames.has(k) && typeof v === 'string' && HEX.test(v))) as Record<string, string> } : {}),
  };
  return { compiled: { scene: clean, params, vars, events, cues, parts, shapes, ...(panel ? { panel } : {}), cost }, issues };
}

/** Compiles once per scene object: the player draws 60 times a second and must not parse again each time. */
const cache = new WeakMap<object, CompiledDrawing>();
export function compiledFor(scene: object, sceneNo = 1): CompiledDrawing {
  let c = cache.get(scene);
  if (!c) { c = compileDrawing(scene, sceneNo).compiled; cache.set(scene, c); }
  return c;
}
