// What an agent writes to draw its own component: a `drawing` scene. Numbers can be written as a plain number or as an expression (see
// ../expr). Nothing here is code: it is data that the renderer reads.

import type { At } from '../types';

/** A number, or an expression that computes one from time and named values. */
export type Num = number | string;

/**
 * A colour: "#ff6a00", a palette slot ("ink", "dim", "accent", "accent2", "hot", "good", "bgTop", "bgBottom", "panel"), the name of one of the
 * drawing's parts, "part" (the shape's own part), a blend of two colours, or a different colour for each theme.
 */
export type ColorSpec = string | { mix: [ColorSpec, ColorSpec]; by: Num } | { byTheme: { blueprint: ColorSpec; flat: ColorSpec } };

export interface ShapeCommon {
  /** The named part this shape belongs to. A part has one colour that the theme, the user or the agent can change, and one label. */
  part?: string;
  /** A name for the shape, for tests and tools. */
  id?: string;
  /** Drawn only while this is not 0. */
  when?: Num;
  /** Draw this many copies (up to 200). Inside, `i` is the copy number from 0 and `n` is how many there are. */
  repeat?: number;
  /** Named values worked out for each copy, in order; later ones may use earlier ones. */
  let?: Record<string, Num>;
  /** "none", "body" (the part's colour, or a dark cut-out in blueprint), or a colour. Closed shapes with a part default to "body". */
  fill?: ColorSpec | 'none' | 'body';
  /** "none" or a colour. Defaults to the part's colour. */
  stroke?: ColorSpec | 'none';
  /** 0 to 1. */
  alpha?: Num;
  /** Line thickness as a multiple of the normal line (1). */
  width?: Num;
  /** 0 to 1: emphasis, which thickens the line and adds a glow. Highlight cues add to it. */
  emph?: Num;
  /** [on, off] in line widths. */
  dash?: [number, number];
}

export interface LineShape extends ShapeCommon { type: 'line'; x1: Num; y1: Num; x2: Num; y2: Num }
export interface RectShape extends ShapeCommon { type: 'rect'; x0: Num; y0: Num; x1: Num; y1: Num; radius?: Num }
export interface CircleShape extends ShapeCommon { type: 'circle'; x: Num; y: Num; r: Num }
export interface PolyShape extends ShapeCommon { type: 'poly'; points: [Num, Num][]; close?: boolean }
/** A curve drawn point by point: `x` and `y` are worked out for j = 0 up to n; u is j / n (0 to 1). */
export interface CurveShape extends ShapeCommon { type: 'curve'; n: number; x: Num; y: Num; close?: boolean }
export interface TextShape extends ShapeCommon { type: 'text'; x: Num; y: Num; text: string; size: Num; align?: 'left' | 'center' | 'right'; weight?: number }
/** A soft radial glow filling a rectangle. */
export interface RadialShape extends ShapeCommon { type: 'radial'; rect: [Num, Num, Num, Num]; color: ColorSpec }
export type Shape = LineShape | RectShape | CircleShape | PolyShape | CurveShape | TextShape | RadialShape;

export interface PartLabel {
  text: string;
  /** Where the words sit and where the leader line points, in the drawing's own units (numbers or expressions). */
  at: [Num, Num];
  to: [Num, Num];
  /** "left": the words start at "at" and run to the right (for labels on the right of the drawing). "right": the words end at "at" (for labels on the left). */
  align?: 'left' | 'right';
}
export interface DrawingPart { color?: ColorSpec; label?: PartLabel }

export interface PanelItem { title: string; text: string; /** Lit while not 0. */ active: Num; /** 0 to 1 bar under the lit item. */ progress?: Num; color?: ColorSpec }
export interface DrawingPanel { title?: string; /** A number shown after the title, such as the cycle count. */ counter?: Num; items: PanelItem[] }

/** The area the drawing uses: width and height in its own units, and which point sits at the centre of the stage. y points up. */
export interface DrawingStage { w: number; h: number; cx?: number; cy?: number }

export interface DrawingCue { at: At; do: 'highlight'; part: string; ms?: number }
export interface DrawingEvent { at: At; ms?: number }

export interface DrawingScene {
  block: 'drawing';
  title?: string;
  lengthMs?: number;
  stage: DrawingStage;
  /** Fixed numbers an expression can use. */
  params?: Record<string, number>;
  /** Named values, worked out in order every frame. Built in: t (seconds into the scene), ms, p (0 to 1 through the scene), len (seconds), portrait (1 in a vertical video), flat (1 in the flat theme). */
  vars?: Record<string, Num>;
  parts?: Record<string, DrawingPart>;
  /** Moments that become values: the name goes from 0 up to 1 and back, and name_age counts seconds since it began. */
  events?: Record<string, DrawingEvent>;
  /** Highlights a part for a while (its hl_<part> value is 1 while it is lit). */
  cues?: DrawingCue[];
  shapes: Shape[];
  panel?: DrawingPanel;
  showLabels?: boolean;
  /** Colours chosen for parts by the user, which win over the drawing's own. */
  colors?: Record<string, string>;
}
