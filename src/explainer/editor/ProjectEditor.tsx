"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Editor from './Editor';
import { getDoc, putDoc, type ProjectDoc } from '../store/db';
import { makeThumb } from '../store/project';

/** Loads a project, renders the editor, and debounced-saves every change. */
export default function ProjectEditor({ id }: { id: string }) {
  const [doc, setDoc] = useState<ProjectDoc | null>(null);
  const [missing, setMissing] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<ProjectDoc | null>(null);
  const lastThumb = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    getDoc(id).then(d => {
      if (!live) return;
      if (d) { lastThumb.current = d.thumb; setDoc(d); }
      else setMissing(true);
    }).catch(() => { if (live) setMissing(true); });
    return () => { live = false; };
  }, [id]);

  const flush = useCallback(() => {
    const next = pending.current;
    pending.current = null;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (!next) return;
    const thumb = makeThumb(next.project) ?? lastThumb.current;
    lastThumb.current = thumb;
    putDoc({ ...next, thumb }).then(
      () => setSaveState('saved'),
      () => setSaveState('saved'),
    );
  }, []);

  // Save anything still pending when leaving.
  useEffect(() => () => flush(), [flush]);

  const onDocChange = useCallback((next: ProjectDoc) => {
    pending.current = next;
    setSaveState('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 900);
  }, [flush]);

  if (missing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
        <div className="text-center">
          <p className="text-sm text-slate-400">This video does not exist.</p>
          <Link href="/" className="mt-3 inline-block text-sm text-sky-300 hover:text-sky-200">← All videos</Link>
        </div>
      </div>
    );
  }
  if (!doc) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    );
  }
  return <Editor key={doc.id} initialDoc={doc} onDocChange={onDocChange} saveState={saveState} />;
}
