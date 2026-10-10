import React, { useEffect, useRef } from 'react';
import type { Project, TimedScene } from '../types';
import { drawFrame } from '../draw/frame';
import { btn, btnOff, btnOn } from './Editor';

interface Props {
  project: Project;
  timeline: { items: TimedScene[]; totalMs: number };
  selected: number;
  onSelect: (i: number) => void;
}

const sceneName = (s: TimedScene['scene']): string =>
  s.block === 'title' ? s.text : s.block === 'bullets' ? (s.title ?? 'List') : (s.title ?? 'Drawing');

/** The scene strip: a thumbnail per scene, click to jump. */
export function SceneStrip({ project, timeline, selected, onSelect }: Props) {
  const refs = useRef<(HTMLCanvasElement | null)[]>([]);
  const portrait = project.aspect === '9:16';
  const tw = portrait ? 54 : 128, th = portrait ? 96 : 72;

  useEffect(() => {
    timeline.items.forEach((it, i) => {
      const c = refs.current[i];
      if (!c) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = tw * dpr; c.height = th * dpr;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      const t = it.startMs + Math.min(1200, (it.endMs - it.startMs) * 0.3);
      drawFrame(ctx, project, t, c.width, c.height);
    });
  }, [project, timeline, tw, th]);

  return (
    <div className="flex shrink-0 gap-2 overflow-x-auto border-t border-white/10 px-3 py-2">
      {timeline.items.map((it, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onSelect(i)}
          className={`${btn} h-auto shrink-0 flex-col items-start gap-1 p-1.5 ${selected === i ? btnOn : btnOff}`}
          title={sceneName(it.scene)}
        >
          <canvas ref={el => { refs.current[i] = el; }} style={{ width: tw, height: th }} className="rounded" />
          <span className="flex w-full items-center justify-between gap-2 px-0.5 text-[11px]">
            <span className="max-w-[92px] truncate">{i + 1}. {sceneName(it.scene)}</span>
            <span className="text-slate-500">{((it.endMs - it.startMs) / 1000).toFixed(1)}s</span>
          </span>
        </button>
      ))}
    </div>
  );
}
