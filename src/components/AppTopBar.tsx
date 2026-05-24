import { ProjectSelector } from './ProjectSelector';
import type { Project } from '../lib/types';

type Props = {
  projects: Project[];
  activeSlug: string | null;
  onSelectProject: (slug: string) => void;
  onDashboard: () => void;
  onNew: () => void;
};

export function AppTopBar({ projects, activeSlug, onSelectProject, onDashboard, onNew }: Props) {
  return (
    <header className="shrink-0 flex items-center gap-4 px-6 py-3 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
      <ProjectSelector
        projects={projects}
        activeSlug={activeSlug}
        onSelect={onSelectProject}
        onDashboard={onDashboard}
        onNew={onNew}
      />
    </header>
  );
}
