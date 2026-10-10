// Semantic layout: where things go in a frame, for both 16:9 and 9:16. Scenes never carry pixel positions; they ask for a region.
// All sizes come from `u`, the frame's shorter side, so one script looks right in both shapes.

export interface Rect { x: number; y: number; w: number; h: number }

export interface FrameLayout {
  w: number; h: number; u: number; landscape: boolean;
  /** Inside the margins, with room kept at the bottom for captions. */
  safe: Rect;
  /** Where a headline sits. */
  head: Rect;
  /** The big area for a drawing or mechanism. */
  stage: Rect;
  /** The side (landscape) or bottom (portrait) panel for explanations. */
  panel: Rect;
}

export function frameLayout(w: number, h: number): FrameLayout {
  const u = Math.min(w, h);
  const landscape = w >= h;
  const m = 0.055 * u;
  const captions = landscape ? 0.1 * h : 0.1 * h;
  const safe: Rect = { x: m, y: m, w: w - 2 * m, h: h - 2 * m - captions };
  if (landscape) {
    const head: Rect = { x: safe.x, y: safe.y, w: safe.w, h: 0.1 * h };
    const panelW = 0.3 * safe.w;
    const stage: Rect = { x: safe.x, y: safe.y + head.h, w: safe.w - panelW - 0.03 * w, h: safe.h - head.h };
    const panel: Rect = { x: safe.x + safe.w - panelW, y: stage.y, w: panelW, h: stage.h };
    return { w, h, u, landscape, safe, head, stage, panel };
  }
  const head: Rect = { x: safe.x, y: safe.y, w: safe.w, h: 0.07 * h };
  const stageH = 0.5 * safe.h;
  const stage: Rect = { x: safe.x, y: safe.y + head.h, w: safe.w, h: stageH };
  const panel: Rect = { x: safe.x, y: stage.y + stage.h + 0.015 * h, w: safe.w, h: safe.h - head.h - stage.h - 0.015 * h };
  return { w, h, u, landscape, safe, head, stage, panel };
}
