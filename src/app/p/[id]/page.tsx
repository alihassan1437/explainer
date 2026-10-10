import ProjectEditor from '@/explainer/editor/ProjectEditor';

/** One video's editor. */
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectEditor id={id} />;
}
