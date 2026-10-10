// Helpers for making project documents and their dashboard thumbnails.

import type { Project } from '../types';
import { drawFrame } from '../draw/frame';
import { layoutTimeline } from '../timing';
import { newId, type ProjectDoc } from './db';
import { DEFAULT_VOICE } from '../voices';

export function blankProject(title: string): Project {
  return {
    aspect: '16:9',
    theme: 'blueprint',
    scenes: [{ block: 'title', text: title || 'Untitled video', lengthMs: 3000 }],
  };
}

export function newDoc(title: string, project: Project, script: string): ProjectDoc {
  return {
    id: newId(),
    title: title || 'Untitled video',
    updatedAt: Date.now(),
    script,
    voice: DEFAULT_VOICE,
    musicUrl: '',
    musicVol: 0.5,
    whooshOn: true,
    project,
    narrationAudio: null,
    narrationVoice: null,
    thumb: null,
  };
}

/** A small JPEG of a representative frame, for the dashboard card. Never throws. */
export function makeThumb(project: Project, w = 320, h = 180): string | null {
  try {
    const { totalMs } = layoutTimeline(project);
    if (!totalMs) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    drawFrame(ctx, project, Math.min(1500, totalMs * 0.25), w, h);
    return canvas.toDataURL('image/jpeg', 0.72);
  } catch {
    return null;
  }
}

export function timeAgo(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}
