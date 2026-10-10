// In-browser video export: the pure renderer draws every frame onto a
// canvas, canvas.captureStream records it, the narration (and music) are
// decoded and mixed in, and MediaRecorder writes an MP4 (WebM fallback).
// Real-time: a 40 s video takes ~40 s to export. Keep the tab visible.

import type { Project } from '../types';
import { drawFrame } from '../draw/frame';
import { layoutTimeline, sceneAt } from '../timing';
import { playWhoosh } from './whoosh';

export interface ExportRequest {
  project: Project;
  /** data: URL of the narration WAV, when there is one. */
  narrationDataUrl: string | null;
  /** music URL, when set. Skipped silently when it cannot be fetched (CORS). */
  musicUrl: string | null;
  musicVol: number;
  whooshOn: boolean;
  fps?: number;
  onProgress?: (doneMs: number, totalMs: number) => void;
  isCancelled?: () => boolean;
}

export interface ExportResult { blob: Blob; extension: string; mimeType: string }

const MP4 = ['video/mp4;codecs="avc1.42E01E,mp4a.40.2"', 'video/mp4'];
const WEBM = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

function pickMime(): { mimeType: string; extension: string } {
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record video.');
  for (const m of MP4) if (MediaRecorder.isTypeSupported(m)) return { mimeType: m, extension: 'mp4' };
  for (const m of WEBM) if (MediaRecorder.isTypeSupported(m)) return { mimeType: m, extension: 'webm' };
  throw new Error('This browser cannot record video.');
}

async function decode(url: string, ac: AudioContext): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await ac.decodeAudioData(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export async function exportVideo(req: ExportRequest): Promise<ExportResult> {
  const fps = req.fps ?? 30;
  const { mimeType, extension } = pickMime();
  const { items, totalMs } = layoutTimeline(req.project);
  if (!totalMs) throw new Error('There is nothing to export.');

  const portrait = req.project.aspect === '9:16';
  const w = portrait ? 720 : 1280, h = portrait ? 1280 : 720;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('The canvas is not available.');

  // Audio graph: narration + music (+ whooshes) mixed into one stream.
  const ac = new AudioContext();
  if (ac.state === 'suspended') await ac.resume();
  const dest = ac.createMediaStreamDestination();
  let narrSrc: AudioBufferSourceNode | null = null;
  if (req.narrationDataUrl) {
    const buf = await decode(req.narrationDataUrl, ac);
    if (buf) {
      narrSrc = ac.createBufferSource();
      narrSrc.buffer = buf;
      const g = ac.createGain(); g.gain.value = 1;
      narrSrc.connect(g); g.connect(dest);
    }
  }
  let musicSrc: AudioBufferSourceNode | null = null;
  let musicGain: GainNode | null = null;
  if (req.musicUrl) {
    const buf = await decode(req.musicUrl, ac);
    if (buf) {
      musicSrc = ac.createBufferSource();
      musicSrc.buffer = buf; musicSrc.loop = true;
      musicGain = ac.createGain(); musicGain.gain.value = req.musicVol;
      musicSrc.connect(musicGain); musicGain.connect(dest);
    }
  }

  const videoTrack = canvas.captureStream(fps).getVideoTracks()[0];
  const combined = new MediaStream([videoTrack, ...dest.stream.getAudioTracks()]);
  const rec = new MediaRecorder(combined, { mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise<void>((resolve, reject) => {
    rec.onstop = () => resolve();
    rec.onerror = () => reject(new Error('The recording failed.'));
  });

  rec.start(1000);
  const startWall = performance.now();
  narrSrc?.start(0);
  musicSrc?.start(0);
  let lastScene = -1;
  let cancelled = false;

  await new Promise<void>(resolve => {
    const tick = (): void => {
      if (req.isCancelled?.()) { cancelled = true; resolve(); return; }
      const t = performance.now() - startWall;
      if (t >= totalMs) { resolve(); return; }
      drawFrame(ctx, req.project, t, w, h);
      // Music ducks while the narration speaks.
      if (musicGain) {
        const target = req.musicVol * 0.3;
        musicGain.gain.value += (target - musicGain.gain.value) * 0.08;
      }
      const idx = sceneAt(items, t)?.index ?? -1;
      if (idx !== lastScene) {
        if (req.whooshOn && lastScene !== -1) playWhoosh(ac, 0.22, dest);
        lastScene = idx;
      }
      req.onProgress?.(t, totalMs);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // Let the tail (fade-out, last words) land in the file.
  await new Promise(r => setTimeout(r, cancelled ? 0 : 400));
  rec.stop();
  await stopped;
  try { narrSrc?.stop(); musicSrc?.stop(); } catch { /* already stopped */ }
  void ac.close().catch(() => {});
  if (cancelled) throw new Error('cancelled');
  return { blob: new Blob(chunks, { type: mimeType }), extension, mimeType };
}

/** Triggers a download of the exported file. */
export function downloadExport(result: ExportResult, name: string): string {
  const url = URL.createObjectURL(result.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.${result.extension}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return url;
}
