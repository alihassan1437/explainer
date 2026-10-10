"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import type { Project, Scene, ThemeId } from '../types';
import { drawFrame } from '../draw/frame';
import { fitScenesToNarration, layoutTimeline, sceneAt, sceneLengthMs } from '../timing';
import { THEMES } from '../theme';
import { DEFAULT_VOICE } from '../voices';
import { ScriptPanel } from './ScriptPanel';
import { SceneStrip } from './SceneStrip';
import { Inspector } from './Inspector';

const DEMO_SCRIPT = `How does a car engine turn fuel into motion? It all comes down to four strokes, repeating hundreds of times every minute.

First, the intake stroke. The piston moves down, the intake valve opens, and a mix of fuel and air is drawn into the cylinder.

Then compression. Both valves shut. The piston rises and squeezes that mixture into a tiny space.

Then comes the power stroke. The spark plug fires. The mixture explodes, and the blast shoves the piston down. That push is what turns your wheels.

Finally, the exhaust stroke. The exhaust valve opens, the piston rises, and the burnt gas is pushed out. And then it all starts again.`;

export interface SampleChoice { id: string; label: string; project: Project }

export const btn = 'inline-flex items-center justify-center h-8 px-3 rounded-lg text-sm font-medium border transition-colors';
export const btnOn = 'border-sky-400/60 bg-sky-400/15 text-sky-100';
export const btnOff = 'border-white/10 text-slate-400 hover:bg-white/5';
export const field = 'w-full rounded-lg border border-white/10 bg-white/[.03] px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600';
export const label = 'mb-1 block text-[11px] font-semibold uppercase tracking-widest text-slate-500';

/** The Explainer editor: script on the left, preview in the middle, scene inspector on the right. */
export default function Editor({ samples }: { samples: SampleChoice[] }) {
  const [sampleId, setSampleId] = useState(samples[0].id);
  const [project, setProject] = useState<Project>(samples[0].project);
  const [t, setT] = useState(1500);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState(0);
  const [width, setWidth] = useState(0);
  // Narration.
  const [script, setScript] = useState(DEMO_SCRIPT);
  const [voice, setVoice] = useState(DEFAULT_VOICE);
  const [ttsKey, setTtsKey] = useState(() => (typeof window === 'undefined' ? '' : window.localStorage.getItem('explainer-tts-key') ?? ''));
  const [generating, setGenerating] = useState(false);
  const [narrError, setNarrError] = useState('');
  const [narrInfo, setNarrInfo] = useState('');
  // Sound.
  const [musicUrl, setMusicUrl] = useState('');
  const [musicVol, setMusicVol] = useState(0.5);
  const [whooshOn, setWhooshOn] = useState(true);

  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tRef = useRef(1500);
  const playingRef = useRef(false);
  const musicVolRef = useRef(musicVol);
  const whooshOnRef = useRef(whooshOn);
  const lastSceneRef = useRef(-1);
  const narrationAudio = useRef<HTMLAudioElement | null>(null);
  const musicAudio = useRef<HTMLAudioElement | null>(null);
  const whooshCtx = useRef<AudioContext | null>(null);
  musicVolRef.current = musicVol;
  whooshOnRef.current = whooshOn;

  const setTime = (v: number): void => { tRef.current = v; setT(v); };
  const timeline = useMemo(() => layoutTimeline(project), [project]);
  const total = timeline.totalMs;
  const ratio = project.aspect === '16:9' ? 16 / 9 : 9 / 16;
  const setTheme = (theme: ThemeId): void => setProject(p => ({ ...p, theme }));
  const setAspect = (aspect: Project['aspect']): void => setProject(p => ({ ...p, aspect }));

  // --- audio ---------------------------------------------------------------
  const pauseAudio = (): void => { narrationAudio.current?.pause(); musicAudio.current?.pause(); };
  const playAudio = (): void => {
    const a = narrationAudio.current;
    if (a && a.src) { a.currentTime = tRef.current / 1000; a.play().catch(() => {}); }
    const m = musicAudio.current;
    if (m && m.src) m.play().catch(() => {});
  };
  const whoosh = (): void => {
    if (!whooshOnRef.current) return;
    try {
      whooshCtx.current ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const ac = whooshCtx.current;
      if (ac.state === 'suspended') void ac.resume();
      const dur = 0.45;
      const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const src = ac.createBufferSource(); src.buffer = buf;
      const filt = ac.createBiquadFilter(); filt.type = 'bandpass'; filt.Q.value = 1.2;
      filt.frequency.setValueAtTime(400, ac.currentTime);
      filt.frequency.exponentialRampToValueAtTime(3200, ac.currentTime + dur);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.22, ac.currentTime + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
      src.connect(filt); filt.connect(g); g.connect(ac.destination);
      src.start();
    } catch { /* decoration only */ }
  };

  // Time only moves here; every picture comes from drawFrame.
  useEffect(() => {
    playingRef.current = playing;
    if (!playing) return;
    let last = performance.now(), frame = 0;
    const tick = (now: number): void => {
      const dt = Math.min(100, now - last);
      last = now;
      const next = Math.min(total, tRef.current + dt);
      tRef.current = next;
      setT(next);
      if (next >= total) { setPlaying(false); pauseAudio(); }
      else {
        const a = narrationAudio.current;
        if (a && a.src && !a.paused) {
          const diff = a.currentTime * 1000 - next;
          if (Math.abs(diff) > 350) a.currentTime = next / 1000;
        }
        const m = musicAudio.current;
        if (m && m.src) {
          const target = musicVolRef.current * 0.3;
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
  const doPause = (): void => { setPlaying(false); pauseAudio(); };
  const syncAudioTo = (v: number): void => {
    const a = narrationAudio.current;
    if (a && a.src) a.currentTime = v / 1000;
  };
  const doScrub = (v: number): void => { doPause(); setTime(v); syncAudioTo(v); };
  const jumpToScene = (i: number): void => {
    doPause();
    const it = timeline.items[i];
    if (!it) return;
    const v = it.startMs + Math.min(1500, (it.endMs - it.startMs) / 2);
    setTime(v); setSelected(i); lastSceneRef.current = i;
    syncAudioTo(v);
  };

  // --- canvas --------------------------------------------------------------
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.floor(el.clientWidth)));
    ro.observe(el);
    setWidth(Math.floor(el.clientWidth));
    return () => ro.disconnect();
  }, []);
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

  // --- project edits ---------------------------------------------------------
  /** Parks the playhead inside the first scene, past the opening fade, so the canvas shows something. */
  const parkAtStart = (proj: Project): void => {
    const v = Math.min(1500, layoutTimeline(proj).totalMs * 0.25);
    setTime(v); setSelected(0); lastSceneRef.current = -1;
    syncAudioTo(v);
  };
  const choose = (id: string): void => {
    const s = samples.find(x => x.id === id);
    if (!s) return;
    doPause();
    setSampleId(id);
    setProject(s.project);
    parkAtStart(s.project);
  };
  const updateScene = (i: number, patch: Partial<Scene>): void =>
    setProject(p => ({ ...p, scenes: p.scenes.map((s, k) => (k === i ? ({ ...s, ...patch } as Scene) : s)) }));
  const addScene = (block: Scene['block']): void => {
    const base: Scene = block === 'title'
      ? { block: 'title', text: 'New title', lengthMs: 3000 }
      : block === 'bullets'
        ? { block: 'bullets', items: ['First point'], lengthMs: 4000 }
        : { block: 'drawing', title: 'New drawing', stage: { w: 100, h: 100 }, shapes: [], lengthMs: 8000 };
    setProject(p => ({ ...p, scenes: [...p.scenes, base] }));
    setSelected(project.scenes.length);
    jumpToScene(project.scenes.length);
  };
  const deleteScene = (i: number): void => {
    if (project.scenes.length <= 1) return;
    doPause();
    const scenes = project.scenes.filter((_, k) => k !== i);
    const next = { ...project, scenes };
    setProject(next);
    parkAtStart(next);
  };
  const setPart = (name: string, value: string): void =>
    setProject(p => name === '__reset__' ? { ...p, parts: undefined } : { ...p, parts: { ...p.parts, [name]: value } });

  // --- narration ---------------------------------------------------------------
  const saveKey = (k: string): void => {
    setTtsKey(k);
    try {
      if (k) window.localStorage.setItem('explainer-tts-key', k);
      else window.localStorage.removeItem('explainer-tts-key');
    } catch { /* private mode */ }
  };
  const generateNarration = async (): Promise<void> => {
    if (!script.trim() || generating) return;
    setGenerating(true); setNarrError(''); setNarrInfo('');
    try {
      const res = await fetch('/api/narration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: script, voice, key: ttsKey || undefined }),
      });
      const data = (await res.json()) as {
        ok: boolean; error?: string; audio?: string;
        words?: { text: string; startMs: number; endMs: number }[];
        durationMs?: number; voice?: string;
      };
      if (!data.ok || !data.audio || !data.words) throw new Error(data.error || 'The narration could not be made.');
      const a = narrationAudio.current ?? new Audio();
      narrationAudio.current = a;
      a.src = data.audio; a.preload = 'auto';
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
    const next = fitScenesToNarration(project);
    setProject(next);
    parkAtStart(next);
  };
  const setMusic = (url: string): void => {
    setMusicUrl(url);
    const m = musicAudio.current ?? new Audio();
    musicAudio.current = m;
    m.loop = true; m.volume = musicVol;
    if (url) m.src = url;
    else { m.pause(); m.removeAttribute('src'); }
  };

  const sceneLen = (s: Scene): number => sceneLengthMs(s);

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      {/* top bar */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-white/10 px-4">
        <span className="text-sm font-bold tracking-tight">Explainer</span>
        <nav className="flex gap-1">
          {samples.map(s => (
            <button key={s.id} type="button" onClick={() => choose(s.id)}
              className={`${btn} ${sampleId === s.id ? btnOn : btnOff}`}>{s.label}</button>
          ))}
        </nav>
        <span className="ml-auto text-xs text-slate-500">{(total / 1000).toFixed(1)}s</span>
        <button type="button" disabled title="Video export is coming next"
          className={`${btn} cursor-not-allowed border-white/10 text-slate-600`}>
          Export MP4 · soon
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* script */}
        <ScriptPanel
          script={script} setScript={setScript}
          voice={voice} setVoice={setVoice}
          ttsKey={ttsKey} saveKey={saveKey}
          generating={generating} narrError={narrError} narrInfo={narrInfo}
          onNarrate={() => void generateNarration()} onFit={fitScenes}
        />

        {/* preview */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div ref={wrap} className="flex min-h-0 flex-1 items-center justify-center bg-black p-3">
            <div className="max-h-full overflow-hidden rounded-lg border border-white/10" style={{ aspectRatio: String(ratio), maxWidth: '100%', height: '100%' }}>
              <canvas ref={canvas} className="block h-full w-full" aria-label="Explainer preview" />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 border-t border-white/10 px-3 py-2">
            <button type="button" onClick={() => { if (playing) doPause(); else doPlay(); }}
              className={`${btn} border-sky-400/40 bg-sky-400/10 text-sky-200 hover:bg-sky-400/20`}
              aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <button type="button" onClick={() => { doPause(); setTime(0); lastSceneRef.current = -1; syncAudioTo(0); }}
              className={`${btn} border-white/15 text-slate-300 hover:bg-white/5`} aria-label="Back to the start">
              <RotateCcw className="h-4 w-4" />
            </button>
            <input type="range" min={0} max={total} step={10} value={Math.min(t, total)}
              onChange={e => doScrub(Number(e.target.value))}
              className="h-2 flex-1 accent-sky-400" aria-label="Scrub the video" />
            <span className="w-[92px] text-right font-mono text-xs text-slate-400">
              {(t / 1000).toFixed(1)} / {(total / 1000).toFixed(1)}s
            </span>
          </div>
          <SceneStrip project={project} timeline={timeline} selected={selected} onSelect={jumpToScene} />
        </main>

        {/* inspector */}
        <Inspector
          project={project} selected={selected} sceneLen={sceneLen}
          onUpdateScene={updateScene} onAddScene={addScene} onDeleteScene={deleteScene}
          onSetTheme={setTheme} onSetAspect={setAspect}
          onSetPart={setPart}
          musicUrl={musicUrl} setMusic={setMusic} musicVol={musicVol} setMusicVol={setMusicVol}
          whooshOn={whooshOn} setWhooshOn={setWhooshOn}
        />
      </div>
    </div>
  );
}
