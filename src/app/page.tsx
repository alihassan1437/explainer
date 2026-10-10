import ExplainerPlayer from '@/explainer/player/ExplainerPlayer';
import { SAMPLES } from '@/explainer/sample';

/** Preview of the Explainer: samples drawn from data, with a theme switch and part colours. */
export default function ExplainerPreviewPage() {
  return (
    <main className="min-h-screen-safe bg-slate-950 px-5 py-8 text-slate-100">
      <div className="mx-auto max-w-6xl">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[.2em] text-sky-400">Preview · work in progress</p>
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Explainer</h1>
        <ExplainerPlayer samples={SAMPLES} />
      </div>
    </main>
  );
}
