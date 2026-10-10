// Themes. One project renders in any theme with a click. The colour of a named part comes from the drawing that owns it (see drawing/render.ts):
// a colour set by the user or for one scene always wins over the drawing's own.

import type { Palette, Project, ThemeId } from './types';

export interface Theme {
  id: ThemeId;
  name: string;
  palette: Palette;
  /** Faint drawing-paper grid behind everything. */
  grid: boolean;
  /** Shapes are filled with solid colour (flat) instead of drawn as thin outlines (blueprint). */
  filled: boolean;
  /** Line weight and glow strength multipliers. */
  line: number;
  glow: number;
}

export const THEMES: Record<ThemeId, Theme> = {
  blueprint: {
    id: 'blueprint', name: 'Blueprint', grid: true, filled: false, line: 1, glow: 1,
    palette: { bgTop: '#08203d', bgBottom: '#030b18', ink: '#d7ecff', dim: '#5d7fa8', accent: '#38bdf8', accent2: '#7dd3fc', hot: '#ff8a3d', good: '#34d399', panel: '#0e2c4d' },
  },
  flat: {
    id: 'flat', name: 'Bold flat', grid: false, filled: true, line: 1.35, glow: 0,
    palette: { bgTop: '#fff3d6', bgBottom: '#ffe3a3', ink: '#1b1f3a', dim: '#6b6f8d', accent: '#ff4d6d', accent2: '#3a86ff', hot: '#ff8c00', good: '#06b38a', panel: '#ffffff' },
  },
};

export const paletteOf = (project: Pick<Project, 'theme' | 'palette'>): Palette => ({ ...THEMES[project.theme].palette, ...(project.palette ?? {}) });
