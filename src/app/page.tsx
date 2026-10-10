import Editor from '@/explainer/editor/Editor';
import { SAMPLES } from '@/explainer/sample';

/** The Explainer editor. */
export default function ExplainerPage() {
  return <Editor samples={SAMPLES} />;
}
