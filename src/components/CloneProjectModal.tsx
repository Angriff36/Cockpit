import { useState } from 'react';
import { X, Copy, ChevronDown, ChevronUp } from 'lucide-react';
import type { Project } from '../lib/types';
import { cloneProject } from '../lib/api';
import type { CloneOptions } from '../lib/api';

const CLONE_GROUPS = [
  { key: 'commands', label: 'Commands' },
  { key: 'ports', label: 'Ports' },
  { key: 'urls', label: 'URLs' },
  { key: 'deployments', label: 'Deployment targets' },
  { key: 'env_keys', label: 'Environment keys' },
  { key: 'infisical_refs', label: 'Infisical refs' },
  { key: 'docker', label: 'Docker configs' },
  { key: 'launch_groups', label: 'Launch groups' },
  { key: 'notes', label: 'Notes' },
  { key: 'ssh_configs', label: 'SSH configs' },
  { key: 'danger_zone_commands', label: 'Danger zone commands' },
  { key: 'agent_context_overrides', label: 'Agent context overrides' },
] as const;

type IncludeKey = (typeof CLONE_GROUPS)[number]['key'];

function autoSlug(v: string) {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function CloneProjectModal({
  sourceProject,
  onClose,
  onCloned,
}: {
  sourceProject: Project;
  onClose: () => void;
  onCloned: (slug: string) => void;
}) {
  const [name, setName] = useState(`${sourceProject.name} (copy)`);
  const [slug, setSlug] = useState(autoSlug(`${sourceProject.name}-copy`));
  const [repoPath, setRepoPath] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [include, setInclude] = useState<Record<IncludeKey, boolean>>(() => {
    const m: Record<string, boolean> = {};
    for (const g of CLONE_GROUPS) m[g.key] = true;
    return m as Record<IncludeKey, boolean>;
  });

  function toggleGroup(key: IncludeKey) {
    setInclude(prev => ({ ...prev, [key]: !prev[key] }));
  }

  function toggleAll(on: boolean) {
    const m: Record<string, boolean> = {};
    for (const g of CLONE_GROUPS) m[g.key] = on;
    setInclude(m as Record<IncludeKey, boolean>);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      const finalSlug = slug || autoSlug(name);
      const opts: CloneOptions = {
        name,
        slug: finalSlug,
        repoPath: repoPath || undefined,
        include,
      };
      await cloneProject(sourceProject.slug, opts);
      onCloned(finalSlug);
    } catch (e: any) {
      setErr(e.message || 'Clone failed');
    } finally {
      setLoading(false);
    }
  }

  const allOn = CLONE_GROUPS.every(g => include[g.key]);
  const allOff = CLONE_GROUPS.every(g => !include[g.key]);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-lg w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Copy className="w-4 h-4 text-slate-400" />
            <h3 className="text-slate-100 font-medium">Clone project</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4 overflow-y-auto">
          {/* Source info */}
          <div className="bg-slate-950 border border-slate-800 rounded px-3 py-2">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Cloning from</span>
            <div className="text-sm text-slate-200 font-medium mt-0.5">{sourceProject.name}</div>
            <span className="text-[11px] text-slate-500 font-mono">{sourceProject.slug}</span>
          </div>

          {/* New name */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">New name</label>
            <input
              required
              value={name}
              onChange={e => { setName(e.target.value); if (slug === autoSlug(name)) setSlug(autoSlug(e.target.value)); }}
              className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 text-sm focus:border-emerald-500 focus:outline-none"
              placeholder="My New Service"
            />
          </div>

          {/* Slug */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Slug</label>
            <input
              required
              value={slug}
              onChange={e => setSlug(autoSlug(e.target.value))}
              className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 text-sm font-mono focus:border-emerald-500 focus:outline-none"
              placeholder="my-new-service"
            />
          </div>

          {/* Repo path */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Repo path <span className="text-slate-600">(optional)</span></label>
            <input
              value={repoPath}
              onChange={e => setRepoPath(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 text-sm font-mono focus:border-emerald-500 focus:outline-none"
              placeholder="/Users/me/code/my-new-service"
            />
          </div>

          {/* Advanced: entity toggles */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-300 transition-colors"
            >
              {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              Configuration to clone
            </button>
            {showAdvanced && (
              <div className="mt-2 space-y-1.5 bg-slate-950 border border-slate-800 rounded p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500">Include</span>
                  <button
                    type="button"
                    onClick={() => toggleAll(!allOn)}
                    className="text-[10px] text-emerald-400 hover:text-emerald-300 transition-colors"
                  >
                    {allOn ? 'Deselect all' : allOff ? 'Select all' : 'Select all'}
                  </button>
                </div>
                {CLONE_GROUPS.map(g => (
                  <label key={g.key} className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={include[g.key]}
                      onChange={() => toggleGroup(g.key)}
                      className="w-3.5 h-3.5 rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-0 focus:ring-offset-0"
                    />
                    <span className="text-xs text-slate-300 group-hover:text-slate-100 transition-colors">{g.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {err && <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded px-3 py-2">{err}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">
              Cancel
            </button>
            <button disabled={loading} className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-medium rounded text-sm flex items-center gap-1.5">
              {loading ? (
                <>Cloning…</>
              ) : (
                <><Copy className="w-3.5 h-3.5" /> Clone</>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
