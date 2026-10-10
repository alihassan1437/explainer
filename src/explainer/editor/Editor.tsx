"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Pause, Play, RotateCcw } from 'lucide-react';
import type { Project, Scene, ThemeId } from '../types';
import { drawFrame } from '../draw/frame';
import { fitScenesToNarration, layoutTimeline, sceneAt, sceneLengthMs } from '../timing';
import { THEMES } from '../theme';
import { DEFAULT_VOICE } from '../voices';
import { ScriptPanel } from './ScriptPanel';
import { SceneStrip } from './SceneStrip';
import { Inspector } from './Inspector';
import { playWhoosh, uiAudioContext } from './whoosh';
import { downloadExport, exportVideo } from './export';
import type { ProjectDoc } from '../store/db';

export const btn = 'inline-flex items-center justify-center h-8 px-3 rounded-lg text-sm font-medium border transition-colors';
export const btnOn = 'border-sky-400/60 bg-sky-400/15 text-sky-100';
export const btnOff = 'border-white/10 text-slate-400 hover:bg-white/5';
export const field = 'w-full rounded-lg border border-white/10 bg-white/[.03] px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600';
export const label = 'mb-1 block text-[11px] font-semibold uppercase tracking-widest text-slate-500';

/** The Explainer editor: script on the left, preview in the middle, scene inspector on the right. Reports every change to its owner, which saves it. */
export default function Editor({ initialDoc, onDocChange, saveState }: {
  initialDoc: ProjectDoc;
  onDocChange: (doc: ProjectDoc) => void;
  saveState: 'saved' | 'saving';
}) {
  const docId = useRef(initialDoc.id).current;
  const [title, setTitle] = useState(initialDoc.title);
  const [project, setProject] = useState<Project>(initialDoc.project);
  const [t, setT] = useState(1500);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState(0);
  const [width, setWidth] = useState(0);
  // Narration.
  const [script, setScript] = useState(initialDoc.script);
  const [voice, setVoice] = useState(initialDoc.voice || DEFAULT_VOICE);
  const [narrVoice, setNarrVoice] = useState<string | null>(initialDoc.narrationVoice);
  const [ttsKey, setTtsKey] = useState(() => (typeof window === 'undefined' ? '' : window.localStorage.getItem('explainer-tts-key') ?? ''));
  const [generating, setGenerating] = useState(false);
  const [narrError, setNarrError] = useState('');
  const [narrInfo, setNarrInfo] = useState('');
  // Sound.
  const [musicUrl, setMusicUrl] = useState(initialDoc.musicUrl);
  const [musicVol, setMusicVol] = useState(initialDoc.musicVol);
  const [whooshOn, setWhooshOn] = useState(initialDoc.whooshOn);
  // Export.
  const [exporting, setExporting] = useState<null | { done: number; total: number }>(null);
  const [exportError, setExportError] = useState('');
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const cancelExport = useRef(false);

  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tRef = useRef(1500);
  const playingRef = useRef(false);
  const musicVolRef = useRef(musicVol);
  const whooshOnRef = useRef(whooshOn);
  const lastSceneRef = useRef(-1);
  const narrationAudio = useRef<HTMLAudioElement | null>(null);
  const musicAudio = useRef<HTMLAudioElement | null>(null);
  musicVolRef.current = musicVol;
  whooshOnRef.current = whooshOn;

  const setTime = (v: number): void => { tRef.current = v; setT(v); };
  const timeline = useMemo(() => layoutTimeline(project), [project]);
  const total = timeline.totalMs;
  const ratio = project.aspect === '16:9' ? 16 / 9 : 9 / 16;
  const setTheme = (theme: ThemeId): void => setProject(p => ({ ...p, theme }));
  const setAspect = (aspect: Project['aspect']): void => setProject(p => ({ ...p, aspect }));
  const setCaptions = (on: boolean): void => setProject(p => ({ ...p, captions: on }));

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
    const ac = uiAudioContext();
    if (ac) playWhoosh(ac);
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
  // Restore a saved narration's audio once, and report every change to the owner.
  const restoredNarr = useRef(false);
  useEffect(() => {
    if (restoredNarr.current) return;
    restoredNarr.current = true;
    if (initialDoc.narrationAudio) {
      const a = new Audio();
      a.src = initialDoc.narrationAudio; a.preload = 'auto';
      narrationAudio.current = a;
      const words = initialDoc.project.narration?.words ?? [];
      if (words.length) {
        const dur = words.reduce((m, w) => Math.max(m, w.endMs), 0);
        setNarrInfo(`${words.length} words · ${(dur / 1000).toFixed(1)}s${initialDoc.narrationVoice ? ` · ${initialDoc.narrationVoice}` : ''}`);
      }
    }
    if (initialDoc.musicUrl) setMusic(initialDoc.musicUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onDocChangeRef = useRef(onDocChange);
  onDocChangeRef.current = onDocChange;
  const firstReport = useRef(true);
  useEffect(() => {
    if (firstReport.current) { firstReport.current = false; return; }
    onDocChangeRef.current({
      id: docId,
      title: title || 'Untitled video',
      updatedAt: Date.now(),
      script, voice, musicUrl, musicVol, whooshOn,
      project,
      narrationAudio: narrationAudio.current?.src || null,
      narrationVoice: narrVoice,
      thumb: null, // the owner re-renders it on save
    });
  }, [docId, title, script, voice, musicUrl, musicVol, whooshOn, project, narrVoice]);

  const parkAtStart = (proj: Project): void => {
    const v = Math.min(1500, layoutTimeline(proj).totalMs * 0.25);
    setTime(v); setSelected(0); lastSceneRef.current = -1;
    syncAudioTo(v);
  };
  const updateScene = (i: number, patch: Partial<Scene>): void =>
    setProject(p => ({ ...p, scenes: p.scenes.map((s, k) => (k === i ? ({ ...s, ...patch } as Scene) : s)) }));
  const replaceScene = (i: number, scene: Scene): void => {
    doPause();
    setProject(p => ({ ...p, scenes: p.scenes.map((s, k) => (k === i ? scene : s)) }));
  };
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
      setNarrVoice(data.voice ?? voice);
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

  // --- export ------------------------------------------------------------------
  const startExport = async (): Promise<void> => {
    if (exporting) return;
    doPause();
    setExportError(''); setExportUrl(null);
    setExporting({ done: 0, total: 1 });
    cancelExport.current = false;
    try {
      const result = await exportVideo({
        project,
        narrationDataUrl: narrationAudio.current?.src || null,
        musicUrl: musicUrl || null,
        musicVol, whooshOn,
        onProgress: (done, total) => setExporting({ done, total }),
        isCancelled: () => cancelExport.current,
      });
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      const url = downloadExport(result, `explainer-${stamp}`);
      setExportUrl(url);
    } catch (e) {
      if (!(e instanceof Error && e.message === 'cancelled')) {
        setExportError(e instanceof Error ? e.message : 'The export failed.');
      }
    } finally {
      setExporting(null);
    }
  };
  const closeExportModal = (): void => { setExportUrl(null); setExportError(''); };

  const sceneLen = (s: Scene): number => sceneLengthMs(s);

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      {/* top bar */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-white/10 px-4">
        <Link href="/" className="text-sm text-slate-400 hover:text-slate-200" title="All videos">←</Link>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Untitled video"
          className="w-56 bg-transparent text-sm font-bold tracking-tight text-slate-100 placeholder:text-slate-600 focus:outline-none" />
        <span className="text-xs text-slate-600">{saveState === 'saving' ? 'Saving…' : 'Saved'}</span>
        <span className="ml-auto text-xs text-slate-500">{(total / 1000).toFixed(1)}s</span>
        <button type="button" onClick={() => void startExport()}
          className={`${btn} border-sky-400/40 bg-sky-400/10 font-semibold text-sky-200 hover:bg-sky-400/20`}>
          Export MP4
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
          onUpdateScene={updateScene} onReplaceScene={replaceScene} onAddScene={addScene} onDeleteScene={deleteScene}
          onSetTheme={setTheme} onSetAspect={setAspect} onSetCaptions={setCaptions}
          onSetPart={setPart}
          musicUrl={musicUrl} setMusic={setMusic} musicVol={musicVol} setMusicVol={setMusicVol}
          whooshOn={whooshOn} setWhooshOn={setWhooshOn}
        />
      </div>

      {/* export modal */}
      {(exporting || exportUrl || exportError) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-[320px] rounded-xl border border-white/10 bg-slate-900 p-5">
            <h3 className="mb-3 text-sm font-semibold">Export video</h3>
            {exporting && (
              <>
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-sky-400 transition-all"
                    style={{ width: `${Math.min(100, (exporting.done / Math.max(1, exporting.total)) * 100)}%` }} />
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  {(exporting.done / 1000).toFixed(0)}s of {(exporting.total / 1000).toFixed(0)}s — keep this tab visible.
                </p>
                <button type="button" onClick={() => { cancelExport.current = true; }}
                  className={`${btn} mt-4 w-full ${btnOff}`}>Cancel</button>
              </>
            )}
            {exportUrl && (
              <>
                <p className="text-sm text-slate-300">Done — your download has started.</p>
                <a href={exportUrl} download className={`${btn} mt-4 w-full ${btnOn}`}>Download again</a>
                <button type="button" onClick={closeExportModal} className={`${btn} mt-2 w-full ${btnOff}`}>Close</button>
              </>
            )}
            {exportError && (
              <>
                <p className="text-sm text-red-300">{exportError}</p>
                <button type="button" onClick={closeExportModal} className={`${btn} mt-4 w-full ${btnOff}`}>Close</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
