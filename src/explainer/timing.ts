// When things happen: scene lengths, the timeline, and turning a cue (a time, a spoken word or a fraction) into a moment.

import type { At, Project, Scene, TimedScene, WordTime } from './types';

export const MIN_SCENE_MS = 800;
export const MAX_SCENE_MS = 600_000;

/** How long a scene lasts when it does not say. */
export function sceneLengthMs(scene: Scene): number {
  const asked = typeof scene.lengthMs === 'number' && Number.isFinite(scene.lengthMs) ? scene.lengthMs : null;
  if (asked !== null) return Math.min(MAX_SCENE_MS, Math.max(MIN_SCENE_MS, asked));
  if (scene.block === 'title') return 3000;
  if (scene.block === 'bullets') return 1400 + scene.items.length * 1200;
  return 20_000;   // a drawing
}

export function layoutTimeline(project: Pick<Project, 'scenes'>): { items: TimedScene[]; totalMs: number } {
  let cursor = 0;
  const items = project.scenes.map((scene, index) => {
    const startMs = cursor;
    cursor += sceneLengthMs(scene);
    return { scene, index, startMs, endMs: cursor };
  });
  return { items, totalMs: cursor };
}

/** The scene on screen at a time (the last one for any time past the end). */
export function sceneAt(items: TimedScene[], t: number): TimedScene | null {
  if (!items.length) return null;
  for (const it of items) if (t < it.endMs) return it;
  return items[items.length - 1];
}

/** Reads a cue's "at" from JSON: a time in ms, { word, occurrence? } or { frac }; undefined when it is none of them. */
export function cleanAt(v: unknown): At | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, v);
  const o = v as Record<string, unknown> | null;
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    if (typeof o.word === 'string' && o.word.trim()) return { word: o.word.trim().slice(0, 40), ...(typeof o.occurrence === 'number' && o.occurrence >= 1 ? { occurrence: Math.floor(o.occurrence) } : {}) };
    if (typeof o.frac === 'number' && Number.isFinite(o.frac)) return { frac: Math.min(1, Math.max(0, o.frac)) };
  }
  return undefined;
}

/** Lower case, with the punctuation around a word removed, so "Piston," matches "piston". */
export const normalizeWord = (s: string) => s.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/**
 * Turns a cue into milliseconds from the start of its scene, or null when it cannot be placed (a word that is not spoken in this scene,
 * or a spoken-word cue in a video with no narration).
 */
export function resolveAt(at: At | undefined, scene: { startMs: number; endMs: number }, words: WordTime[] | undefined): number | null {
  if (at === undefined) return null;
  if (typeof at === 'number') return Number.isFinite(at) ? at : null;
  if ('frac' in at) return Number.isFinite(at.frac) ? Math.max(0, Math.min(1, at.frac)) * (scene.endMs - scene.startMs) : null;
  if (!words?.length) return null;
  const target = normalizeWord(at.word);
  const n = Math.max(1, Math.floor(at.occurrence ?? 1));
  let seen = 0;
  for (const w of words) {
    if (w.startMs < scene.startMs || w.startMs >= scene.endMs) continue;
    if (normalizeWord(w.text) === target && ++seen === n) return w.startMs - scene.startMs;
  }
  return null;
}

/**
 * Scales every scene's length so the whole video lasts as long as the
 * narration (keeping the scenes' proportions, with a floor per scene).
 * Word cues then resolve inside scenes by time, as usual.
 */
export function fitScenesToNarration(project: Project): Project {
  const words = project.narration?.words;
  if (!words?.length) return project;
  const narrationMs = words.reduce((m, w) => Math.max(m, w.endMs), 0);
  const { totalMs } = layoutTimeline(project);
  if (!totalMs || narrationMs <= 0) return project;
  const k = narrationMs / totalMs;
  const scenes = project.scenes.map(s => ({
    ...s,
    lengthMs: Math.max(MIN_SCENE_MS, Math.round(sceneLengthMs(s) * k)),
  }));
  return { ...project, scenes };
}
