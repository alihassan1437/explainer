// Checks and tidies scene JSON written by a person or an agent. It never throws: it returns a usable project and a list of issues, so the
// player always has something to draw and an agent can read exactly what to fix.

import type { Aspect, At, Issue, Project, Scene, ThemeId } from './types';
import { MAX_SCENE_MS, MIN_SCENE_MS, cleanAt } from './timing';
import { compileDrawing, validName } from './drawing/compile';

export const LIMITS = { scenes: 60, title: 80, subtitle: 120, bullets: 7, bullet: 90, sceneTitle: 60 } as const;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function cleanColors(raw: unknown, add: (level: Issue['level'], message: string) => void, where: string): Record<string, string> | undefined {
  if (raw === undefined) return undefined;
  if (!isObj(raw)) { add('warning', `${where}: "parts" must be an object of part names to colours, so it is ignored.`); return undefined; }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!validName(k)) add('warning', `${where}: "${k}" is not a valid part name, so it is ignored.`);
    else if (typeof v !== 'string' || !HEX.test(v)) add('warning', `${where}: the colour for "${k}" must look like #ff6a00.`);
    else out[k] = v;
  }
  return out;
}

export function normalizeProject(raw: unknown): { project: Project; issues: Issue[] } {
  const issues: Issue[] = [];
  const add = (level: Issue['level'], message: string, sceneIndex?: number) => issues.push({ level, message, sceneIndex });
  const input = isObj(raw) ? raw : {};
  if (!isObj(raw)) add('error', 'The project must be an object with a "scenes" list.');

  const aspect: Aspect = input.aspect === '9:16' ? '9:16' : '16:9';
  if (input.aspect !== undefined && input.aspect !== '16:9' && input.aspect !== '9:16') add('warning', 'aspect must be "16:9" or "9:16"; 16:9 is used.');
  const theme: ThemeId = input.theme === 'flat' ? 'flat' : 'blueprint';
  if (input.theme !== undefined && input.theme !== 'blueprint' && input.theme !== 'flat') add('warning', 'theme must be "blueprint" or "flat"; blueprint is used.');

  const scenes: Scene[] = [];
  const list = Array.isArray(input.scenes) ? input.scenes : [];
  if (!list.length) add('error', 'There are no scenes yet.');
  if (list.length > LIMITS.scenes) add('warning', `Only the first ${LIMITS.scenes} scenes are used.`);

  list.slice(0, LIMITS.scenes).forEach((s, i) => {
    const where = `Scene ${i + 1}`;
    const w = (level: Issue['level'], message: string) => add(level, `${where}: ${message}`, i);
    if (!isObj(s)) { w('error', 'is not an object, so it is skipped.'); return; }
    let lengthMs: number | undefined;
    if (s.lengthMs !== undefined) {
      if (typeof s.lengthMs !== 'number' || !Number.isFinite(s.lengthMs)) w('warning', 'lengthMs must be a number of milliseconds, so the default length is used.');
      else { lengthMs = Math.min(MAX_SCENE_MS, Math.max(MIN_SCENE_MS, s.lengthMs)); if (lengthMs !== s.lengthMs) w('warning', `lengthMs was moved to ${lengthMs} (allowed ${MIN_SCENE_MS} to ${MAX_SCENE_MS}).`); }
    }
    const len = lengthMs === undefined ? {} : { lengthMs };

    if (s.block === 'title') {
      const t = text(s.text, LIMITS.title + 1);
      if (!t) { w('error', 'a title needs "text", so the scene is skipped.'); return; }
      if (t.length > LIMITS.title) w('warning', `the title is longer than ${LIMITS.title} characters and is cut. Shorter titles read faster.`);
      const subtitle = text(s.subtitle, LIMITS.subtitle);
      scenes.push({ block: 'title', text: t.slice(0, LIMITS.title), ...(subtitle ? { subtitle } : {}), ...len });
    } else if (s.block === 'bullets') {
      const items = (Array.isArray(s.items) ? s.items : []).map(x => text(x, LIMITS.bullet + 1)).filter(Boolean);
      if (!items.length) { w('error', 'a list needs "items", so the scene is skipped.'); return; }
      if (items.length > LIMITS.bullets) w('warning', `a list shows at most ${LIMITS.bullets} items; the rest are dropped. Split it into two scenes.`);
      const kept = items.slice(0, LIMITS.bullets).map(x => { if (x.length > LIMITS.bullet) w('warning', `an item is longer than ${LIMITS.bullet} characters and is cut.`); return x.slice(0, LIMITS.bullet); });
      const itemAt = Array.isArray(s.itemAt) ? s.itemAt.slice(0, kept.length).map(cleanAt) : undefined;
      if (itemAt && itemAt.some(a => a === undefined)) w('warning', 'itemAt has an entry that is not a time, a word or a fraction; those items use the default timing.');
      const title = text(s.title, LIMITS.sceneTitle);
      scenes.push({ block: 'bullets', ...(title ? { title } : {}), items: kept, ...(itemAt ? { itemAt: itemAt.map(a => a ?? NaN) as At[] } : {}), ...len });
    } else if (s.block === 'drawing') {
      const r = compileDrawing(s, i + 1);
      issues.push(...r.issues);
      if (!r.compiled.shapes.length) { w('error', 'no shape could be used, so the scene is skipped.'); return; }
      const { lengthMs: _own, ...rest } = r.compiled.scene;
      scenes.push({ ...rest, ...len });
    } else {
      w('error', `the block "${String(s.block)}" does not exist. Available: title, bullets, drawing.`);
    }
  });

  const palette: Record<string, string> = {};
  if (isObj(input.palette)) for (const [k, v] of Object.entries(input.palette)) { if (typeof v === 'string' && HEX.test(v)) palette[k] = v; else add('warning', `palette.${k} must look like #38bdf8, so it is ignored.`); }
  const parts = cleanColors(input.parts, (l, m) => add(l, m), 'project');

  let narration: Project['narration'];
  if (isObj(input.narration) && Array.isArray(input.narration.words)) {
    const words = input.narration.words.filter((x): x is { text: string; startMs: number; endMs: number } => isObj(x) && typeof x.text === 'string' && typeof x.startMs === 'number' && typeof x.endMs === 'number');
    narration = { text: text(input.narration.text, 20000), words };
  }

  return {
    project: { aspect, theme, ...(Object.keys(palette).length ? { palette } : {}), ...(parts && Object.keys(parts).length ? { parts: parts as never } : {}), scenes, ...(narration ? { narration } : {}) },
    issues,
  };
}
