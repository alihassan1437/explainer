"use client";

import React, { useState } from 'react';
import type { DrawingScene } from '../drawing/types';
import type { Issue } from '../types';
import { compileDrawing } from '../drawing/compile';
import { btn, btnOff, btnOn, label } from './Editor';

/** Validates a candidate drawing and returns its issues (parse errors become one). */
export function checkDrawing(text: string): { issues: Issue[]; value: DrawingScene | null } {
  let value: unknown = null;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return { issues: [{ level: 'error', message: `Not valid JSON: ${e instanceof Error ? e.message : String(e)}` }], value: null };
  }
  const { issues } = compileDrawing(value, 1);
  const drawing = value as DrawingScene;
  if (!value || typeof value !== 'object' || (drawing.block !== 'drawing' && !Array.isArray(drawing.shapes))) {
    return { issues: [{ level: 'error', message: 'This is not a drawing: it needs "block": "drawing" (or a shapes array).' }], value: null };
  }
  return { issues, value: drawing };
}

/** A modal for editing a drawing scene's JSON, with the checker's verdict. */
export function DrawingEditor({ scene, onApply, onClose }: {
  scene: DrawingScene;
  onApply: (scene: DrawingScene) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(scene, null, 2));
  const [issues, setIssues] = useState<Issue[] | null>(null);

  const validate = (): Issue[] => {
    const r = checkDrawing(text);
    setIssues(r.issues);
    return r.issues;
  };
  const errors = (issues ?? []).filter(i => i.level === 'error').length;

  const apply = (): void => {
    const r = checkDrawing(text);
    setIssues(r.issues);
    if (r.issues.some(i => i.level === 'error') || !r.value) return;
    onApply(r.value);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div className="flex max-h-full w-[720px] flex-col rounded-xl border border-white/10 bg-slate-900 p-5" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Edit drawing</h3>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-300">✕</button>
        </div>
        <p className="mb-2 text-[11px] text-slate-500">
          The drawing is data — shapes and the formulas that move them. The checker reads it the same way the app does.
        </p>
        <textarea value={text} onChange={e => { setText(e.target.value); setIssues(null); }} spellCheck={false}
          className="min-h-[280px] flex-1 resize-y rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-xs leading-relaxed text-slate-200" />
        {issues && (
          <div className="mt-2 max-h-32 overflow-y-auto rounded-lg border border-white/10 bg-black/30 p-2">
            {issues.length === 0 && <p className="text-xs text-emerald-300">Valid — no errors or warnings.</p>}
            {issues.map((i, k) => (
              <p key={k} className={`text-xs ${i.level === 'error' ? 'text-red-300' : i.level === 'warning' ? 'text-amber-300' : 'text-slate-400'}`}>
                {i.level.toUpperCase()}: {i.message}
              </p>
            ))}
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <span className={label + ' self-center'}>{issues ? `${errors} error(s)` : 'Not checked yet'}</span>
          <span className="flex-1" />
          <button type="button" onClick={validate} className={`${btn} ${btnOff}`}>Validate</button>
          <button type="button" onClick={apply} disabled={issues !== null && errors > 0}
            className={`${btn} ${btnOn} disabled:cursor-not-allowed disabled:opacity-40`}>Apply</button>
        </div>
      </div>
    </div>
  );
}
