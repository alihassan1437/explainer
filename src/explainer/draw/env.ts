import type { Palette, Project, WordTime } from '../types';
import type { Theme } from '../theme';
import type { FrameLayout } from './layout';

/** Everything a block needs to draw one frame of its scene. */
export interface Env {
  ctx: CanvasRenderingContext2D;
  project: Project;
  theme: Theme;
  palette: Palette;
  f: FrameLayout;
  /** Milliseconds since the scene started, and the scene's length. */
  t: number;
  len: number;
  /** Where the scene starts on the video's clock, and the video clock now. */
  startMs: number;
  globalMs: number;
  words?: WordTime[];
}
