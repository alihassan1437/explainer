"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Project } from '../types';
import { drawFrame } from '../draw/frame';
import { layoutTimeline } from '../timing';
import { deleteDoc, getDoc, listDocs, putDoc, type DocMeta } from '../store/db';
import { blankProject, newDoc, timeAgo } from '../store/project';
import { ENGINE_SCRIPT, SAMPLE_ENGINE_DRAWING, SAMPLE_WATER_CYCLE } from '../sample';

/** A live thumbnail drawn from a project. */
function Thumb({ project }: { project: Project }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const { totalMs } = layoutTimeline(project);
    drawFrame(ctx, project, Math.min(1500, totalMs * 0.25), c.width, c.height);
  }, [project]);
  return <canvas ref={ref} width={320} height={180} className="aspect-video w-full bg-slate-900" />;
}

const EXAMPLES: { label: string; blurb: string; project: Project; script: string }[] = [
  { label: 'How a car engine works', blurb: 'The four-stroke engine, written as data', project: SAMPLE_ENGINE_DRAWING, script: ENGINE_SCRIPT },
  { label: 'How the water cycle works', blurb: 'A second proof, same drawing format', project: SAMPLE_WATER_CYCLE, script: '' },
];

const card = 'overflow-hidden rounded-xl border border-white/10 bg-white/[.02] transition-colors hover:border-white/20';
const btn = 'inline-flex items-center justify-center h-8 px-3 rounded-lg text-sm font-medium border transition-colors';
const btnPrimary = 'border-sky-400/40 bg-sky-400/10 font-semibold text-sky-200 hover:bg-sky-400/20';
const btnQuiet = 'border-white/10 text-slate-400 hover:bg-white/5';

export default function Dashboard() {
  const router = useRouter();
  const [docs, setDocs] = useState<DocMeta[] | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    listDocs().then(setDocs).catch(() => setDocs([]));
  }, []);
  useEffect(refresh, [refresh]);

  const openDoc = (id: string): void => router.push(`/p/${id}`);
  const create = async (title: string, project: Project, script: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const doc = newDoc(title, project, script);
      await putDoc(doc);
      router.push(`/p/${doc.id}`);
    } finally {
      setBusy(false);
    }
  };
  const duplicate = async (id: string): Promise<void> => {
    const d = await getDoc(id);
    if (!d) return;
    const copy = { ...newDoc(`${d.title} copy`, d.project, d.script), voice: d.voice, musicUrl: d.musicUrl, musicVol: d.musicVol, whooshOn: d.whooshOn, narrationAudio: d.narrationAudio, narrationVoice: d.narrationVoice, thumb: d.thumb };
    await putDoc(copy);
    refresh();
  };
  const remove = async (id: string, title: string): Promise<void> => {
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
    await deleteDoc(id);
    refresh();
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <header className="mb-8 flex items-center gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Explainer</h1>
            <p className="text-sm text-slate-500">A script becomes a narrated, animated video.</p>
          </div>
          <button type="button" onClick={() => setShowNew(true)} className={`${btn} ${btnPrimary} ml-auto`}>
            ＋ New video
          </button>
        </header>

        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">Start from an example</h2>
        <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {EXAMPLES.map(e => (
            <button key={e.label} type="button" onClick={() => void create(e.label, e.project, e.script)} className={`${card} text-left`}>
              <Thumb project={e.project} />
              <div className="p-4">
                <div className="text-sm font-semibold">{e.label}</div>
                <div className="mt-0.5 text-xs text-slate-500">{e.blurb}</div>
              </div>
            </button>
          ))}
        </div>

        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">Your videos</h2>
        {docs === null ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : docs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 p-10 text-center">
            <p className="text-sm text-slate-400">No videos yet.</p>
            <p className="mt-1 text-xs text-slate-600">Start from an example above, or make a blank one.</p>
            <button type="button" onClick={() => setShowNew(true)} className={`${btn} ${btnQuiet} mt-4`}>New blank video</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {docs.map(d => (
              <div key={d.id} className={card}>
                <button type="button" onClick={() => openDoc(d.id)} className="block w-full text-left">
                  {d.thumb
                    ? <img src={d.thumb} alt="" className="aspect-video w-full bg-slate-900 object-cover" />
                    : <div className="aspect-video w-full bg-slate-900" />}
                </button>
                <div className="flex items-center gap-2 p-3">
                  <div className="min-w-0 flex-1">
                    <button type="button" onClick={() => openDoc(d.id)} className="block w-full truncate text-left text-sm font-semibold hover:text-sky-200">
                      {d.title}
                    </button>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {(d.durationMs / 1000).toFixed(0)}s
                      {d.words > 0 && ` · ${d.words} words`} · {timeAgo(d.updatedAt)}
                    </div>
                  </div>
                  <button type="button" title="Duplicate" onClick={() => void duplicate(d.id)}
                    className={`${btn} ${btnQuiet} h-7 px-2 text-xs`}>⧉</button>
                  <button type="button" title="Delete" onClick={() => void remove(d.id, d.title)}
                    className={`${btn} ${btnQuiet} h-7 px-2 text-xs hover:text-red-300`}>×</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setShowNew(false)}>
          <div className="w-[320px] rounded-xl border border-white/10 bg-slate-900 p-5" onClick={e => e.stopPropagation()}>
            <h3 className="mb-3 text-sm font-semibold">New video</h3>
            <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Video title"
              autoFocus onKeyDown={e => { if (e.key === 'Enter') void create(newTitle.trim() || 'Untitled video', blankProject(newTitle.trim()), ''); }}
              className="w-full rounded-lg border border-white/10 bg-white/[.03] px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600" />
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setShowNew(false)} className={`${btn} ${btnQuiet} flex-1`}>Cancel</button>
              <button type="button" disabled={busy}
                onClick={() => void create(newTitle.trim() || 'Untitled video', blankProject(newTitle.trim()), '')}
                className={`${btn} ${btnPrimary} flex-1`}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
