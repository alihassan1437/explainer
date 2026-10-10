import React from 'react';
import { VOICES } from '../voices';
import { btn, field, label } from './Editor';

interface Props {
  script: string; setScript: (s: string) => void;
  voice: string; setVoice: (v: string) => void;
  ttsKey: string; saveKey: (k: string) => void;
  generating: boolean; narrError: string; narrInfo: string;
  onNarrate: () => void; onFit: () => void;
}

/** The script: what is said. Narration, captions and word cues all follow it. */
export function ScriptPanel(p: Props) {
  const words = p.script.trim() ? p.script.trim().split(/\s+/).length : 0;
  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-r border-white/10 p-3">
      <span className={label}>Script</span>
      <textarea
        value={p.script}
        onChange={e => p.setScript(e.target.value)}
        className="min-h-0 flex-1 resize-none rounded-lg border border-white/10 bg-white/[.03] p-3 text-sm leading-relaxed text-slate-200 placeholder:text-slate-600"
        placeholder="Write what is said…"
      />
      <div className="mt-1 flex justify-between text-[11px] text-slate-500">
        <span>{words} words</span>
        <span>{p.script.length} chars</span>
      </div>

      <div className="mt-3">
        <span className={label}>Voice</span>
        <select value={p.voice} onChange={e => p.setVoice(e.target.value)} className={`${field} bg-slate-900`}>
          {VOICES.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </div>

      <div className="mt-2">
        <span className={label}>Google TTS key</span>
        <div className="flex gap-1">
          <input
            type="password"
            value={p.ttsKey}
            onChange={e => p.saveKey(e.target.value)}
            placeholder="AIza… (saved in this browser)"
            autoComplete="off"
            className={field}
          />
          {p.ttsKey && (
            <button type="button" onClick={() => p.saveKey('')} title="Forget the key"
              className={`${btn} shrink-0 border-white/10 px-2 text-slate-500 hover:text-slate-300`}>×</button>
          )}
        </div>
      </div>

      <button
        type="button" onClick={p.onNarrate} disabled={p.generating || !p.script.trim()}
        className={`${btn} mt-3 h-9 border-sky-400/40 bg-sky-400/10 font-semibold text-sky-200 hover:bg-sky-400/20 disabled:opacity-40`}>
        {p.generating ? 'Reading aloud…' : 'Narrate'}
      </button>
      {p.narrError && <p className="mt-2 text-xs leading-snug text-red-300">{p.narrError}</p>}
      {p.narrInfo && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-[11px] text-slate-400">{p.narrInfo}</p>
          <button type="button" onClick={p.onFit} className="shrink-0 text-[11px] text-sky-300 hover:underline">
            Fit scenes
          </button>
        </div>
      )}
      <p className="mt-2 text-[11px] leading-snug text-slate-600">
        Word cues like {'{ word: "piston" }'} and the captions follow the narration on their own.
      </p>
    </aside>
  );
}
