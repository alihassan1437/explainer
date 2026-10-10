"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import type { Project, Scene, ThemeId } from '../types';
import { drawFrame } from '../draw/frame';
import { fitScenesToNarration, layoutTimeline, sceneAt } from '../timing';
import { THEMES, paletteOf } from '../theme';
import { compiledFor } from '../drawing/compile';
import { evalDrawing } from '../drawing/render';
import { DEFAULT_VOICE, VOICES } from '../voices';

const DEMO_SCRIPT = `How does a car engine turn fuel into motion? It all comes down to four strokes, repeating hundreds of times every minute.

First, the intake stroke. The piston moves down, the intake valve opens, and a mix of fuel and air is drawn into the cylinder.

Then compression. Both valves shut. The piston rises and squeezes that mixture into a tiny space.

Then comes the power stroke. The spark plug fires. The mixture explodes, and the blast shoves the piston down. That push is what turns your wheels.

Finally, the exhaust stroke. The exhaust valve opens, the piston rises, and the burnt gas is pushed out. And then it all starts again.`;

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
  // Narration (phase 3).
  const [script, setScript] = useState(DEMO_SCRIPT);
  const [voice, setVoice] = useState(DEFAULT_VOICE);
  const [generating, setGenerating] = useState(false);
  const [narrError, setNarrError] = useState('');
  const [narrInfo, setNarrInfo] = useState('');
  const [musicUrl, setMusicUrl] = useState('');
  const [musicVol, setMusicVol] = useState(0.5);
  const [whooshOn, setWhooshOn] = useState(true);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tRef = useRef(0);
  const playingRef = useRef(false);
  const lastSceneRef = useRef(-1);
  const narrationAudio = useRef<HTMLAudioElement | null>(null);
  const musicAudio = useRef<HTMLAudioElement | null>(null);
  const whooshCtx = useRef<AudioContext | null>(null);
  const setTime = (v: number): void => { tRef.current = v; setT(v); };
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
  // The narration audio follows the same clock, with drift correction.
  const pauseAudio = (): void => {
    narrationAudio.current?.pause();
    musicAudio.current?.pause();
  };
  const playAudio = (): void => {
    const a = narrationAudio.current;
    if (a && a.src) {
      a.currentTime = tRef.current / 1000;
      a.play().catch(() => {});
    }
    const m = musicAudio.current;
    if (m && m.src) m.play().catch(() => {});
  };
  const whoosh = (): void => {
    if (!whooshOn) return;
    try {
      whooshCtx.current ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const ac = whooshCtx.current;
      if (ac.state === 'suspended') void ac.resume();
      const dur = 0.45;
      const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const src = ac.createBufferSource();
      src.buffer = buf;
      const filt = ac.createBiquadFilter();
      filt.type = 'bandpass'; filt.Q.value = 1.2;
      filt.frequency.setValueAtTime(400, ac.currentTime);
      filt.frequency.exponentialRampToValueAtTime(3200, ac.currentTime + dur);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.22, ac.currentTime + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
      src.connect(filt); filt.connect(g); g.connect(ac.destination);
      src.start();
    } catch {
      // Sound effects are decoration; never break playback.
    }
  };
  useEffect(() => {
    playingRef.current = playing;
    if (!playing) return;
    let last = performance.now(), frame = 0;
    const tick = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      const next = Math.min(total, tRef.current + dt);
      tRef.current = next;
      setT(next);
      if (next >= total) {
        setPlaying(false);
        pauseAudio();
      } else {
        const a = narrationAudio.current;
        if (a && a.src && !a.paused) {
          const diff = a.currentTime * 1000 - next;
          if (Math.abs(diff) > 350) a.currentTime = next / 1000;
        }
        const m = musicAudio.current;
        if (m && m.src) {
          const target = musicVol * 0.3;
          m.volume += (target - m.volume) * 0.08;
        }
        const idx = sceneAt(timeline.items, next)?.index ?? -1;
        if (idx !== lastSceneRef.current) {
          if (lastSceneRef.current !== -1) whoosh();
          lastSceneRef.current = idx;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, total]);

  const doPlay = (): void => {
    if (tRef.current >= total) { setTime(0); lastSceneRef.current = -1; }
    playAudio();
    setPlaying(true);
  };
  const doPause = (): void => {
    setPlaying(false);
    pauseAudio();
  };
  const doScrub = (v: number): void => {
    doPause();
    setTime(v);
    const a = narrationAudio.current;
    if (a && a.src) a.currentTime = v / 1000;
  };

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
    doPause();
    setSampleId(id); setProject(s.project); setTime(0); lastSceneRef.current = -1;
    const a = narrationAudio.current;
    if (a && a.src) a.currentTime = 0;
  };
  const setPart = (name: string, value: string) => setProject(p => ({ ...p, parts: { ...p.parts, [name]: value } }));
  const setTheme = (theme: ThemeId) => setProject(p => ({ ...p, theme }));

  const generateNarration = async (): Promise<void> => {
    if (!script.trim() || generating) return;
    setGenerating(true);
    setNarrError('');
    setNarrInfo('');
    try {
      const res = await fetch('/api/narration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: script, voice }),
      });
      const data = (await res.json()) as {
        ok: boolean; error?: string; audio?: string;
        words?: { text: string; startMs: number; endMs: number }[];
        durationMs?: number; voice?: string;
      };
      if (!data.ok || !data.audio || !data.words) throw new Error(data.error || 'The narration could not be made.');
      const a = narrationAudio.current ?? new Audio();
      narrationAudio.current = a;
      a.src = data.audio;
      a.preload = 'auto';
      setProject(p => ({ ...p, narration: { text: script, words: data.words ?? [] } }));
      setNarrInfo(`${data.words.length} words · ${((data.durationMs ?? 0) / 1000).toFixed(1)}s · ${data.voice}`);
    } catch (e) {
      setNarrError(e instanceof Error ? e.message : 'The narration could not be made.');
    } finally {
      setGenerating(false);
    }
  };

  const fitScenes = (): void => {
    doPause();
    setProject(p => fitScenesToNarration(p));
    setTime(0);
    lastSceneRef.current = -1;
    const a = narrationAudio.current;
    if (a && a.src) a.currentTime = 0;
  };

  const setMusic = (url: string): void => {
    setMusicUrl(url);
    const m = musicAudio.current ?? new Audio();
    musicAudio.current = m;
    m.loop = true;
    m.volume = musicVol;
    if (url) m.src = url;
    else { m.pause(); m.removeAttribute('src'); }
  };
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
          <button type="button" onClick={() => { if (playing) doPause(); else doPlay(); }} className={`${button} border-sky-400/40 bg-sky-400/10 text-sky-200 hover:bg-sky-400/20`} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button type="button" onClick={() => { doPause(); setTime(0); lastSceneRef.current = -1; const a = narrationAudio.current; if (a && a.src) a.currentTime = 0; }} className={`${button} border-white/15 text-slate-300 hover:bg-white/5`} aria-label="Back to the start"><RotateCcw className="h-4 w-4" /></button>
          <input type="range" min={0} max={total} step={10} value={Math.min(t, total)} onChange={e => doScrub(Number(e.target.value))} className="h-2 flex-1 accent-sky-400" aria-label="Scrub the video" />
          <span className="w-[88px] text-right font-mono text-xs text-slate-400">{fmt(t)} / {fmt(total)}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {timeline.items.map(it => (
            <button key={it.index} type="button" onClick={() => { doPause(); const v = it.startMs + 1500; setTime(v); lastSceneRef.current = it.index; const a = narrationAudio.current; if (a && a.src) a.currentTime = v / 1000; }} className={`${button} ${t >= it.startMs && t < it.endMs ? on : off}`}>
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
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Narration</h2>
          <textarea
            value={script}
            onChange={e => setScript(e.target.value)}
            rows={6}
            className="w-full rounded-lg border border-white/10 bg-white/[.03] p-3 text-sm text-slate-200 placeholder:text-slate-600"
            placeholder="Write the script. One narration covers the whole video."
          />
          <div className="mt-2 flex gap-2">
            <select value={voice} onChange={e => setVoice(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-900 px-2 py-2 text-sm text-slate-200">
              {VOICES.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <button
              type="button"
              onClick={() => void generateNarration()}
              disabled={generating || !script.trim()}
              className={`${button} border-sky-400/40 bg-sky-400/10 text-sky-200 hover:bg-sky-400/20 disabled:opacity-40`}
            >
              {generating ? 'Reading…' : 'Narrate'}
            </button>
          </div>
          {narrError && <p className="mt-2 text-sm text-red-300">{narrError}</p>}
          {narrInfo && (
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-xs text-slate-400">{narrInfo}</p>
              <button type="button" onClick={fitScenes} className="shrink-0 text-xs text-sky-300 hover:underline">
                Fit scenes to narration
              </button>
            </div>
          )}
          <p className="mt-2 text-xs text-slate-500">Word cues ({'{ word: "piston" }'}) and captions follow the narration automatically.</p>
        </section>
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Sound</h2>
          <input
            type="url"
            value={musicUrl}
            onChange={e => setMusic(e.target.value)}
            placeholder="Music URL (mp3)…"
            className="w-full rounded-lg border border-white/10 bg-white/[.03] px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600"
          />
          <label className="mt-2 flex items-center gap-2 text-xs text-slate-400">
            Volume
            <input type="range" min={0} max={1} step={0.05} value={musicVol} onChange={e => setMusicVol(Number(e.target.value))} className="h-2 flex-1 accent-sky-400" />
          </label>
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={whooshOn} onChange={e => setWhooshOn(e.target.checked)} className="accent-sky-400" />
            Whoosh between scenes
          </label>
          <p className="mt-1 text-xs text-slate-500">Music ducks under the narration while it speaks.</p>
        </section>
      </aside>
    </div>
  );
}
