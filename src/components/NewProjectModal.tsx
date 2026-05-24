import { useState } from 'react';
import {
  X, FileText, Globe, Server, Rocket, Layers, Database, Zap,
  GitBranch, Shield, RefreshCw, ChevronLeft, Terminal, Anchor,
  KeyRound, ArrowRight,
} from 'lucide-react';
import { createProject, createProjectFromTemplate } from '../lib/api';
import { PROJECT_TEMPLATES } from '../lib/templates';
import type { ProjectTemplate } from '../lib/types';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Globe, Server, Rocket, Layers, Database, Zap, GitBranch, Shield, RefreshCw,
};

type PreviewTab = 'commands' | 'ports' | 'env';

function TemplatePreview({ template, onConfirm, onBack }: {
  template: ProjectTemplate;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<PreviewTab>('commands');

  const tabs: { key: PreviewTab; label: string; icon: React.ComponentType<{ className?: string }>; count: number }[] = [
    { key: 'commands', label: 'Commands', icon: Terminal, count: template.commands.length },
    { key: 'ports', label: 'Ports', icon: Anchor, count: template.ports.length },
    { key: 'env', label: 'Env keys', icon: KeyRound, count: template.env_keys.length },
  ];

  const Icon = ICON_MAP[template.icon] || FileText;

  return (
    <div className="flex flex-col">
      {/* Template header */}
      <div className="p-5 border-b border-slate-800">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center flex-shrink-0">
            <Icon className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-sm text-slate-100 font-medium">{template.name}</h4>
            <p className="text-xs text-slate-400 mt-0.5">{template.description}</p>
          </div>
        </div>

        {/* Stat pills */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {template.commands.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 text-[11px] text-slate-300">
              <Terminal className="w-3 h-3 text-emerald-400" />
              {template.commands.length} command{template.commands.length !== 1 ? 's' : ''}
            </span>
          )}
          {template.ports.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 text-[11px] text-slate-300">
              <Anchor className="w-3 h-3 text-sky-400" />
              {template.ports.length} port{template.ports.length !== 1 ? 's' : ''}
            </span>
          )}
          {template.env_keys.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 text-[11px] text-slate-300">
              <KeyRound className="w-3 h-3 text-amber-400" />
              {template.env_keys.length} env key{template.env_keys.length !== 1 ? 's' : ''}
            </span>
          )}
          {template.docker.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 text-[11px] text-slate-300">
              <Layers className="w-3 h-3 text-purple-400" />
              Docker
            </span>
          )}
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 text-[11px] text-slate-300">
            {template.package_manager}
          </span>
          {template.hosting_platform && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 text-[11px] text-slate-300">
              {template.hosting_platform}
            </span>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-slate-800 px-5">
        {tabs.map(t => {
          const TabIcon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-emerald-500 text-emerald-400'
                  : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}
            >
              <TabIcon className="w-3.5 h-3.5" />
              {t.label}
              <span className={`ml-0.5 px-1.5 py-0.5 rounded text-[10px] ${
                tab === t.key ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-500'
              }`}>
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="p-5 max-h-[280px] overflow-y-auto">
        {tab === 'commands' && (
          template.commands.length === 0 ? (
            <p className="text-xs text-slate-500">No commands configured.</p>
          ) : (
            <div className="space-y-1.5">
              {template.commands.map((c, i) => (
                <div key={i} className="flex items-start gap-2 px-2.5 py-2 rounded bg-slate-800/50">
                  <span className={`mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide flex-shrink-0 ${
                    c.kind === 'dev' ? 'bg-emerald-500/20 text-emerald-300' :
                    c.kind === 'build' ? 'bg-blue-500/20 text-blue-300' :
                    c.kind === 'test' ? 'bg-purple-500/20 text-purple-300' :
                    c.kind === 'migrate' ? 'bg-amber-500/20 text-amber-300' :
                    c.kind === 'reset' ? 'bg-rose-500/20 text-rose-300' :
                    'bg-slate-700 text-slate-400'
                  }`}>
                    {c.kind}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-slate-200 font-medium">{c.name}</div>
                    <code className="text-[11px] text-slate-400 font-mono block mt-0.5 truncate">{c.command}</code>
                    {c.notes && <div className="text-[10px] text-slate-500 mt-0.5">{c.notes}</div>}
                  </div>
                  {c.expected_port && (
                    <span className="text-[10px] text-sky-400 flex-shrink-0 mt-0.5">:{c.expected_port}</span>
                  )}
                </div>
              ))}
            </div>
          )
        )}

        {tab === 'ports' && (
          template.ports.length === 0 ? (
            <p className="text-xs text-slate-500">No ports configured.</p>
          ) : (
            <div className="space-y-1.5">
              {template.ports.map((p, i) => (
                <div key={i} className="flex items-center gap-3 px-2.5 py-2 rounded bg-slate-800/50">
                  <span className="text-sm font-mono font-medium text-sky-400 w-12 text-right flex-shrink-0">{p.port}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-slate-200">{p.label}</div>
                    {p.notes && <div className="text-[10px] text-slate-500">{p.notes}</div>}
                  </div>
                  <span className="text-[10px] text-slate-500 uppercase tracking-wide flex-shrink-0">{p.protocol}</span>
                </div>
              ))}
            </div>
          )
        )}

        {tab === 'env' && (
          template.env_keys.length === 0 ? (
            <p className="text-xs text-slate-500">No environment keys configured.</p>
          ) : (
            <div className="space-y-1.5">
              {template.env_keys.map((k, i) => (
                <div key={i} className="flex items-start gap-2 px-2.5 py-2 rounded bg-slate-800/50">
                  <span className={`mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    k.required ? 'bg-amber-400' : 'bg-slate-600'
                  }`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <code className="text-xs text-slate-200 font-mono">{k.key_name}</code>
                      {k.required && <span className="text-[10px] text-amber-400">required</span>}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{k.purpose}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-slate-500">{k.classification}</span>
                      <span className="text-[10px] text-slate-600">&middot;</span>
                      <span className="text-[10px] text-slate-500">{k.env_scope}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between px-5 py-3 border-t border-slate-800">
        <button
          onClick={onBack}
          className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
        >
          Back to templates
        </button>
        <button
          onClick={onConfirm}
          className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-medium rounded text-sm transition-colors"
        >
          Use this template
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (slug: string) => void }) {
  const [step, setStep] = useState<'pick' | 'preview' | 'form'>('pick');
  const [selectedTemplate, setSelectedTemplate] = useState<ProjectTemplate | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [repo, setRepo] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  function autoSlug(v: string) {
    return v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function pickTemplate(t: ProjectTemplate | null) {
    setSelectedTemplate(t);
    if (t) {
      setStep('preview');
    } else {
      setStep('form');
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      const finalSlug = slug || autoSlug(name);
      if (selectedTemplate) {
        await createProjectFromTemplate(selectedTemplate, { name, slug: finalSlug, repo_path: repo });
      } else {
        await createProject({ name, slug: finalSlug, repo_path: repo });
      }
      onCreated(finalSlug);
    } catch (e: any) {
      setErr(e.message || 'Failed');
    } finally {
      setLoading(false);
    }
  }

  const modalWidth = step === 'preview' ? 'max-w-2xl' : 'max-w-lg';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className={`bg-slate-900 border border-slate-800 rounded-lg w-full ${modalWidth} transition-all`}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            {step !== 'pick' && (
              <button onClick={() => { setStep('pick'); setErr(''); }} className="text-slate-500 hover:text-slate-300 -ml-1">
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <h3 className="text-slate-100 font-medium">
              {step === 'pick' ? 'New project' : step === 'preview' ? 'Template preview' : selectedTemplate ? `New project — ${selectedTemplate.name}` : 'New project — Blank'}
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
        </div>

        {step === 'pick' ? (
          /* ── Template Picker ─────────────────────────────────── */
          <div className="p-5 space-y-3">
            <p className="text-xs text-slate-500 mb-3">Start from a template or create a blank project</p>

            {/* Blank option */}
            <button
              onClick={() => pickTemplate(null)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-slate-800 hover:border-slate-700 hover:bg-slate-800/50 transition-colors text-left group"
            >
              <div className="w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center flex-shrink-0 group-hover:bg-slate-700">
                <FileText className="w-4 h-4 text-slate-400" />
              </div>
              <div className="min-w-0">
                <div className="text-sm text-slate-200 font-medium">Blank project</div>
                <div className="text-xs text-slate-500 truncate">Empty project — configure everything manually</div>
              </div>
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3 py-1">
              <div className="flex-1 border-t border-slate-800" />
              <span className="text-[10px] text-slate-600 uppercase tracking-wider">Templates</span>
              <div className="flex-1 border-t border-slate-800" />
            </div>

            {/* Template grid */}
            <div className="grid grid-cols-2 gap-2 max-h-[320px] overflow-y-auto pr-1">
              {PROJECT_TEMPLATES.map(t => {
                const Icon = ICON_MAP[t.icon] || FileText;
                return (
                  <button
                    key={t.id}
                    onClick={() => pickTemplate(t)}
                    className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg border border-slate-800 hover:border-slate-700 hover:bg-slate-800/50 transition-colors text-left group"
                  >
                    <div className="w-7 h-7 rounded bg-slate-800 flex items-center justify-center flex-shrink-0 mt-0.5 group-hover:bg-slate-700">
                      <Icon className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs text-slate-200 font-medium leading-tight">{t.name}</div>
                      <div className="text-[11px] text-slate-500 leading-snug mt-0.5 line-clamp-2">{t.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : step === 'preview' && selectedTemplate ? (
          /* ── Template Preview ───────────────────────────────── */
          <TemplatePreview
            template={selectedTemplate}
            onConfirm={() => setStep('form')}
            onBack={() => { setStep('pick'); setErr(''); }}
          />
        ) : (
          /* ── Project Form ───────────────────────────────────── */
          <form onSubmit={submit} className="p-5 space-y-4">
            {/* Template summary badge */}
            {selectedTemplate && (
              <div className="flex items-center gap-2 px-3 py-2 rounded bg-emerald-500/10 border border-emerald-500/20">
                {(() => { const Icon = ICON_MAP[selectedTemplate.icon] || FileText; return <Icon className="w-3.5 h-3.5 text-emerald-400" />; })()}
                <span className="text-xs text-emerald-300">
                  {selectedTemplate.name}: {selectedTemplate.commands.length} commands, {selectedTemplate.ports.length} ports, {selectedTemplate.env_keys.length} env keys
                </span>
              </div>
            )}

            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Name</label>
              <input
                required
                autoFocus
                value={name}
                onChange={e => { setName(e.target.value); if (!slug) setSlug(autoSlug(e.target.value)); }}
                className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 text-sm focus:border-emerald-500 focus:outline-none"
                placeholder="Capsule Pro"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Slug</label>
              <input
                required
                value={slug}
                onChange={e => setSlug(autoSlug(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 text-sm font-mono focus:border-emerald-500 focus:outline-none"
                placeholder="capsule-pro"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Repo path</label>
              <input
                value={repo}
                onChange={e => setRepo(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 text-sm font-mono focus:border-emerald-500 focus:outline-none"
                placeholder="/Users/me/code/capsule-pro"
              />
            </div>
            {err && <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded px-3 py-2">{err}</div>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
              <button disabled={loading} className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-medium rounded text-sm">
                {loading ? 'Creating…' : 'Create'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
