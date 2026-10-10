"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import type { Project, Scene, ThemeId } from '../types';
import { drawFrame } from '../draw/frame';
import { layoutTimeline, sceneAt } from '../timing';
import { THEMES, paletteOf } from '../theme';
import { compiledFor } from '../drawing/compile';
import { evalDrawing } from '../drawing/render';

const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
/** "connectingRod" becomes "Connecting rod". */
const humanize = (name: string) => { const s = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); };

/** The named parts of a scene and the colour each has now (what the user can change). */
function partsOf(project: Project, scene: Scene | undefined): { name: string; color: string }[] {
  if (!scene) return [];
  if (scene.block === 'drawing') {
    const compiled = compiledFor(scene);
    const r = evalDrawing(compiled, { t: 0, len: 1000, startMs: 0, project, theme: THEMES[project.theme], palette: paletteOf(project), portrait: false });
    return Object.keys(compiled.parts).map(name => ({ name, color: r.partColors[name] }));
  }
  return [];
}
const sceneLabel = (s: Scene) => (s.block === 'drawing' ? (s.title ?? 'Drawing') : s.block === 'title' ? 'Title' : 'List');

export interface SampleChoice { id: string; label: string; project: Project }

/** The preview: a canvas, play and scrubbing, a theme switch, and colour pickers for the named parts of whatever scene is showing. */
export default function ExplainerPlayer({ samples }: { samples: SampleChoice[] }) {
  const [sampleId, setSampleId] = useState(samples[0].id);
  const [project, setProject] = useState<Project>(samples[0].project);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [width, setWidth] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const timeline = useMemo(() => layoutTimeline(project), [project]);
  const total = timeline.totalMs;
  const ratio = project.aspect === '16:9' ? 16 / 9 : 9 / 16;
  const current = sceneAt(timeline.items, t)?.scene;
  const parts = useMemo(() => partsOf(project, current), [project, current]);

  // The canvas follows the width of its box.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.floor(el.clientWidth)));
    ro.observe(el);
    setWidth(Math.floor(el.clientWidth));
    return () => ro.disconnect();
  }, []);

  // Time only moves here; every picture comes from drawFrame.
  useEffect(() => {
    if (!playing) return;
    let last = performance.now(), frame = 0;
    const tick = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      setT(prev => {
        const next = prev + dt;
        if (next >= total) { setPlaying(false); return total; }
        return next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, total]);

  const draw = useCallback(() => {
    const c = canvas.current;
    if (!c || width < 10) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(width * dpr), h = Math.round((width / ratio) * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const ctx = c.getContext('2d');
    if (ctx) drawFrame(ctx, project, t, w, h);
  }, [project, t, width, ratio]);
  useEffect(draw, [draw]);

  const choose = (id: string) => {
    const s = samples.find(x => x.id === id);
    if (!s) return;
    setSampleId(id); setProject(s.project); setT(0); setPlaying(false);
  };
  const setPart = (name: string, value: string) => setProject(p => ({ ...p, parts: { ...p.parts, [name]: value } }));
  const setTheme = (theme: ThemeId) => setProject(p => ({ ...p, theme }));
  const button = 'inline-flex items-center justify-center h-9 px-3 rounded-lg text-sm font-medium border transition-colors';
  const on = 'border-sky-400/60 bg-sky-400/15 text-sky-100', off = 'border-white/10 text-slate-400 hover:bg-white/5';

  return (
    <div className="grid lg:grid-cols-[1fr_280px] gap-5">
      <div>
        <div className="mb-3 flex flex-wrap gap-2">
          {samples.map(s => <button key={s.id} type="button" onClick={() => choose(s.id)} aria-pressed={sampleId === s.id} className={`${button} ${sampleId === s.id ? on : off}`}>{s.label}</button>)}
        </div>
        <div ref={wrap} className={`mx-auto w-full overflow-hidden rounded-xl border border-white/10 bg-black ${project.aspect === '9:16' ? 'max-w-[380px]' : ''}`} style={{ aspectRatio: String(ratio) }}>
          <canvas ref={canvas} className="block h-full w-full" aria-label="Explainer preview" />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button type="button" onClick={() => { if (t >= total) setT(0); setPlaying(p => !p); }} className={`${button} border-sky-400/40 bg-sky-400/10 text-sky-200 hover:bg-sky-400/20`} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button type="button" onClick={() => { setPlaying(false); setT(0); }} className={`${button} border-white/15 text-slate-300 hover:bg-white/5`} aria-label="Back to the start"><RotateCcw className="h-4 w-4" /></button>
          <input type="range" min={0} max={total} step={10} value={Math.min(t, total)} onChange={e => { setPlaying(false); setT(Number(e.target.value)); }} className="h-2 flex-1 accent-sky-400" aria-label="Scrub the video" />
          <span className="w-[88px] text-right font-mono text-xs text-slate-400">{fmt(t)} / {fmt(total)}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {timeline.items.map(it => (
            <button key={it.index} type="button" onClick={() => { setPlaying(false); setT(it.startMs + 1500); }} className={`${button} ${t >= it.startMs && t < it.endMs ? on : off}`}>
              {it.index + 1}. {sceneLabel(it.scene)}
            </button>
          ))}
        </div>
      </div>

      <aside className="space-y-5">
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Look</h2>
          <div className="flex gap-2">
            {(Object.keys(THEMES) as ThemeId[]).map(id => <button key={id} type="button" onClick={() => setTheme(id)} aria-pressed={project.theme === id} className={`${button} flex-1 ${project.theme === id ? on : off}`}>{THEMES[id].name}</button>)}
          </div>
          <div className="mt-2 flex gap-2">
            {(['16:9', '9:16'] as const).map(a => <button key={a} type="button" onClick={() => setProject(p => ({ ...p, aspect: a }))} aria-pressed={project.aspect === a} className={`${button} flex-1 ${project.aspect === a ? on : off}`}>{a}</button>)}
          </div>
        </section>
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Parts in this scene</h2>
            <button type="button" onClick={() => setProject(p => ({ ...p, parts: undefined }))} className="text-xs text-sky-300 hover:underline">Reset colours</button>
          </div>
          {parts.length ? (
            <ul className="space-y-1.5">
              {parts.map(part => (
                <li key={part.name} className="flex items-center justify-between gap-3 rounded-lg border border-white/[.07] bg-white/[.02] px-3 py-1.5">
                  <label htmlFor={`part-${part.name}`} className="text-sm text-slate-300">{humanize(part.name)}</label>
                  <input id={`part-${part.name}`} type="color" value={/^#[0-9a-f]{6}$/i.test(part.color) ? part.color : '#ffffff'} onChange={e => setPart(part.name, e.target.value)} className="h-7 w-10 cursor-pointer rounded border border-white/15 bg-transparent" />
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-500">This scene has no named parts. Go to a drawing scene to recolour its parts.</p>}
        </section>
      </aside>
    </div>
  );
}
