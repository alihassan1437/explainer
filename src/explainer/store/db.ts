// Project storage: IndexedDB, so narrated videos (with their WAV audio) persist
// in the browser. Everything stays on the user's device.

import type { Project, WordTime } from '../types';
import { layoutTimeline } from '../timing';

export interface ProjectDoc {
  id: string;
  title: string;
  updatedAt: number;
  script: string;
  voice: string;
  musicUrl: string;
  musicVol: number;
  whooshOn: boolean;
  /** The scenes, theme and aspect, plus narration words when there is one. */
  project: Project;
  /** data: URL of the narration WAV, when generated. */
  narrationAudio: string | null;
  narrationVoice: string | null;
  /** Small JPEG data URL of a representative frame, for the dashboard. */
  thumb: string | null;
}

export type DocMeta = Pick<ProjectDoc, 'id' | 'title' | 'updatedAt' | 'thumb'> & {
  durationMs: number;
  words: number;
};

const DB_NAME = 'explainer';
const STORE = 'projects';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open the project store.'));
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    db =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('The project store failed.'));
        t.oncomplete = () => db.close();
      }),
  );
}

export const putDoc = (doc: ProjectDoc): Promise<void> => tx('readwrite', s => s.put(doc)).then(() => {});
export const getDoc = (id: string): Promise<ProjectDoc | null> =>
  tx('readonly', s => s.get(id)).then(r => (r as ProjectDoc | undefined) ?? null);
export const deleteDoc = (id: string): Promise<void> => tx('readwrite', s => s.delete(id)).then(() => {});
export async function listDocs(): Promise<DocMeta[]> {
  const docs = (await tx('readonly', s => s.getAll())) as ProjectDoc[];
  return docs
    .map(d => {
      const words = d.project.narration?.words ?? [];
      return {
      id: d.id,
      title: d.title,
      updatedAt: d.updatedAt,
      thumb: d.thumb,
      durationMs: words.length ? words.reduce((m, w: WordTime) => Math.max(m, w.endMs), 0) : layoutTimeline(d.project).totalMs,
      words: words.length,
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
