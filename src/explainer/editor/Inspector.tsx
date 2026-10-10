import React, { useMemo } from 'react';
import type { Project, Scene, ThemeId } from '../types';
import { THEMES, paletteOf } from '../theme';
import { compiledFor } from '../drawing/compile';
import { evalDrawing } from '../drawing/render';
import { btn, btnOff, btnOn, field, label } from './Editor';

interface Props {
  project: Project;
  selected: number;
  sceneLen: (s: Scene) => number;
  onUpdateScene: (i: number, patch: Partial<Scene>) => void;
  onAddScene: (block: Scene['block']) => void;
  onDeleteScene: (i: number) => void;
  onSetTheme: (t: ThemeId) => void;
  onSetAspect: (a: Project['aspect']) => void;
  onSetPart: (name: string, value: string) => void;
  musicUrl: string; setMusic: (u: string) => void;
  musicVol: number; setMusicVol: (v: number) => void;
  whooshOn: boolean; setWhooshOn: (v: boolean) => void;
}

/** The named parts of a scene and the colour each has now. */
function partsOf(project: Project, scene: Scene | undefined): { name: string; color: string }[] {
  if (!scene || scene.block !== 'drawing') return [];
  const compiled = compiledFor(scene);
  const r = evalDrawing(compiled, { t: 0, len: 1000, startMs: 0, project, theme: THEMES[project.theme], palette: paletteOf(project), portrait: false });
  return Object.keys(compiled.parts).map(name => ({ name, color: r.partColors[name] }));
}

const humanize = (name: string): string => {
  const s = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const blockName = (s: Scene): string => (s.block === 'title' ? 'Title' : s.block === 'bullets' ? 'List' : 'Drawing');

export function Inspector(p: Props) {
  const scene = p.project.scenes[p.selected];
  const parts = useMemo(() => partsOf(p.project, scene), [p.project, scene]);

  return (
    <aside className="w-[280px] shrink-0 space-y-4 overflow-y-auto border-l border-white/10 p-3">
      {/* scene */}
      <section>
        <div className="mb-1 flex items-center justify-between">
          <span className={label}>Scene {p.selected + 1} · {scene ? blockName(scene) : ''}</span>
          {p.project.scenes.length > 1 && scene && (
            <button type="button" onClick={() => p.onDeleteScene(p.selected)}
              className="text-[11px] text-red-300/80 hover:text-red-300 hover:underline">Delete</button>
          )}
        </div>
        {scene?.block === 'title' && (
          <div className="space-y-2">
            <input value={scene.text} onChange={e => p.onUpdateScene(p.selected, { text: e.target.value })}
              className={field} placeholder="Title" />
            <input value={scene.subtitle ?? ''} onChange={e => p.onUpdateScene(p.selected, { subtitle: e.target.value })}
              className={field} placeholder="Subtitle (optional)" />
          </div>
        )}
        {scene?.block === 'bullets' && (
          <div className="space-y-2">
            <input value={scene.title ?? ''} onChange={e => p.onUpdateScene(p.selected, { title: e.target.value })}
              className={field} placeholder="Heading (optional)" />
            <textarea value={scene.items.join('\n')} rows={4}
              onChange={e => p.onUpdateScene(p.selected, { items: e.target.value.split('\n').filter(x => x.trim()) })}
              className={`${field} resize-none`} placeholder={'One point per line'} />
          </div>
        )}
        {scene?.block === 'drawing' && (
          <div className="space-y-2">
            <input value={scene.title ?? ''} onChange={e => p.onUpdateScene(p.selected, { title: e.target.value })}
              className={field} placeholder="Heading (optional)" />
            <p className="text-[11px] leading-snug text-slate-600">The drawing itself is written as data — by the script's author, or by an agent.</p>
          </div>
        )}
        {scene && (
          <label className="mt-2 flex items-center gap-2 text-xs text-slate-400">
            Length
            <input type="number" min={0.8} step={0.5}
              value={+(p.sceneLen(scene) / 1000).toFixed(1)}
              onChange={e => p.onUpdateScene(p.selected, { lengthMs: Math.max(800, Math.round(Number(e.target.value) * 1000) || 800) })}
              className={`${field} w-20 text-right`} />
            <span className="text-slate-600">s</span>
          </label>
        )}
        <div className="mt-2 flex gap-1">
          {(['title', 'bullets', 'drawing'] as const).map(b => (
            <button key={b} type="button" onClick={() => p.onAddScene(b)}
              className={`${btn} flex-1 whitespace-nowrap px-1 text-xs ${btnOff}`} title={`Add a ${b} scene`}>
              + {b === 'title' ? 'Title' : b === 'bullets' ? 'List' : 'Drawing'}
            </button>
          ))}
        </div>
      </section>

      {/* look */}
      <section>
        <span className={label}>Look</span>
        <div className="flex gap-1">
          {(Object.keys(THEMES) as ThemeId[]).map(id => (
            <button key={id} type="button" onClick={() => p.onSetTheme(id)}
              className={`${btn} flex-1 ${p.project.theme === id ? btnOn : btnOff}`}>{THEMES[id].name}</button>
          ))}
        </div>
        <div className="mt-1 flex gap-1">
          {(['16:9', '9:16'] as const).map(a => (
            <button key={a} type="button" onClick={() => p.onSetAspect(a)}
              className={`${btn} flex-1 ${p.project.aspect === a ? btnOn : btnOff}`}>{a}</button>
          ))}
        </div>
      </section>

      {/* parts */}
      <section>
        <div className="mb-1 flex items-center justify-between">
          <span className={label}>Parts in this scene</span>
          {p.project.parts && Object.keys(p.project.parts).length > 0 && (
            <button type="button" onClick={() => p.onSetPart('__reset__', '')}
              className="text-[11px] text-sky-300 hover:underline">Reset</button>
          )}
        </div>
        {parts.length ? (
          <ul className="space-y-1">
            {parts.map(part => (
              <li key={part.name} className="flex items-center justify-between gap-3 rounded-lg border border-white/[.07] bg-white/[.02] px-2.5 py-1">
                <label htmlFor={`part-${part.name}`} className="truncate text-[13px] text-slate-300">{humanize(part.name)}</label>
                <input id={`part-${part.name}`} type="color"
                  value={/^#[0-9a-f]{6}$/i.test(part.color) ? part.color : '#ffffff'}
                  onChange={e => p.onSetPart(part.name, e.target.value)}
                  className="h-6 w-9 shrink-0 cursor-pointer rounded border border-white/15 bg-transparent" />
              </li>
            ))}
          </ul>
        ) : <p className="text-[11px] text-slate-600">No named parts. Drawing scenes can expose parts to recolour.</p>}
      </section>

      {/* sound */}
      <section>
        <span className={label}>Sound</span>
        <input type="url" value={p.musicUrl} onChange={e => p.setMusic(e.target.value)}
          placeholder="Music URL (mp3)…" className={field} />
        <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
          Volume
          <input type="range" min={0} max={1} step={0.05} value={p.musicVol}
            onChange={e => p.setMusicVol(Number(e.target.value))} className="h-2 flex-1 accent-sky-400" />
        </label>
        <label className="mt-2 flex cursor-pointer items-center gap-2 text-[13px] text-slate-300">
          <input type="checkbox" checked={p.whooshOn} onChange={e => p.setWhooshOn(e.target.checked)} className="accent-sky-400" />
          Whoosh between scenes
        </label>
        <p className="mt-1 text-[11px] text-slate-600">Music ducks under the narration while it speaks.</p>
      </section>
    </aside>
  );
}
