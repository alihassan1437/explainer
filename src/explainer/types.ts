import type { DrawingScene } from './drawing/types';

// Types for the Explainer tool: a script becomes a narrated 2D explainer drawn by code. Nothing here depends on the map flyover.

export type Aspect = '16:9' | '9:16';
export type ThemeId = 'blueprint' | 'flat';

/** One spoken word with its time on the narration clock (milliseconds from the start of the video). */
export interface WordTime { text: string; startMs: number; endMs: number }

/**
 * When something happens inside a scene. A number is milliseconds from the start of the scene (for silent videos). `{ word }` is the
 * moment a word is spoken (the nth time it is said inside the scene), so a changed script keeps the picture in sync. `{ frac }` is a
 * fraction of the scene's length.
 */
export type At = number | { word: string; occurrence?: number } | { frac: number };

export interface TitleScene { block: 'title'; text: string; subtitle?: string; lengthMs?: number }
export interface BulletsScene { block: 'bullets'; title?: string; items: string[]; itemAt?: At[]; lengthMs?: number }
export type Scene = TitleScene | BulletsScene | DrawingScene;

export interface Palette { bgTop: string; bgBottom: string; ink: string; dim: string; accent: string; accent2: string; hot: string; good: string; panel: string }

export interface Project {
  aspect: Aspect;
  theme: ThemeId;
  /** Overrides for the theme's palette colours. */
  palette?: Partial<Palette>;
  /** Colour for a named part in every scene (a scene's own colours win over this). Works for the engine's parts and for any drawing's parts. */
  parts?: Record<string, string>;
  scenes: Scene[];
  /** The narration and its word times, when there is one. */
  narration?: { text: string; words: WordTime[] };
}

export interface Issue { level: 'error' | 'warning' | 'info'; sceneIndex?: number; message: string }

/** A scene placed on the timeline. */
export interface TimedScene { scene: Scene; index: number; startMs: number; endMs: number }
