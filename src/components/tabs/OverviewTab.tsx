import { useState } from 'react';
import { Save, Trash2, Archive, RotateCcw, Download } from 'lucide-react';
import type { ProjectScope } from '../../lib/types';
import { updateProject, deleteProject, archiveProject, restoreProject, permanentlyDeleteProject, downloadArchiveSnapshot } from '../../lib/api';
import { Card, CardHeader, Field, Input, Textarea, Select, Button, Badge } from '../ui';
import { UrlField, UrlInputRow } from '../ExternalLink';

export function OverviewTab({ scope, onChange, onDeleted }: {
  scope: ProjectScope;
  onChange: () => void;
  onDeleted: () => void;
}) {
  const [p, setP] = useState(scope.project);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const isArchived = scope.project.status === 'archived';

  async function save() {
    setSaving(true);
    try {
      await updateProject(p.id, p);
      onChange();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete project "${p.name}"? This removes all project metadata. No files or secrets are touched.`)) return;
    await deleteProject(p.id);
    onDeleted();
  }

  async function handleArchive() {
    if (!confirm(`Archive "${p.name}"?\n\nThis will:\n- Set status to archived\n- Store a snapshot of all project data\n- Hide it from the main dashboard\n\nYou can restore it later.`)) return;
    setArchiving(true);
    try {
      await archiveProject(p.id, p.slug);
      onDeleted(); // Navigate away since it's now hidden
    } catch (err: any) {
      alert(`Archive failed: ${err.message}`);
    } finally {
      setArchiving(false);
    }
  }

  async function handleRestore() {
    if (!confirm(`Restore "${p.name}" to active status?`)) return;
    try {
      await restoreProject(p.id);
      onChange();
    } catch (err: any) {
      alert(`Restore failed: ${err.message}`);
    }
  }

  async function handlePermanentDelete() {
    const confirmText = p.slug;
    const input = prompt(`Permanently delete "${p.name}" and ALL associated data?\n\nThis cannot be undone. Type the project slug to confirm:\n\n${confirmText}`);
    if (input !== confirmText) return;
    try {
      await permanentlyDeleteProject(p.id);
      onDeleted();
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  }

  function handleDownloadSnapshot() {
    downloadArchiveSnapshot(scope.project);
  }

  return (
    <div className="space-y-4">
      {/* Archive status banner */}
      {isArchived && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg px-5 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Archive className="w-5 h-5 text-slate-500" />
              <div>
                <div className="text-sm font-medium text-slate-300">This project is archived</div>
                {scope.project.archived_at && (
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Archived on {new Date(scope.project.archived_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              {scope.project.archive_snapshot && (
                <Button variant="ghost" onClick={handleDownloadSnapshot}>
                  <Download className="w-3 h-3 inline mr-1" />Export snapshot
                </Button>
              )}
              <Button onClick={handleRestore}>
                <RotateCcw className="w-3 h-3 inline mr-1" />Restore
              </Button>
              <Button variant="danger" onClick={handlePermanentDelete}>
                <Trash2 className="w-3 h-3 inline mr-1" />Delete permanently
              </Button>
            </div>
          </div>
        </div>
      )}

      <Card>
        <CardHeader title="Identity" action={
          <div className="flex gap-2">
            {!isArchived && (
              <Button variant="ghost" onClick={handleArchive} disabled={archiving}>
                <Archive className="w-3 h-3 inline mr-1" />{archiving ? 'Archiving...' : 'Archive'}
              </Button>
            )}
            {!isArchived && (
              <Button variant="danger" onClick={remove}><Trash2 className="w-3 h-3 inline mr-1" />Delete</Button>
            )}
            <Button onClick={save} disabled={saving}><Save className="w-3 h-3 inline mr-1" />{saving ? 'Saving...' : 'Save'}</Button>
          </div>
        } />
        <div className="p-5 grid grid-cols-2 gap-4">
          <Field label="Name"><Input value={p.name} onChange={e => setP({ ...p, name: e.target.value })} /></Field>
          <Field label="Slug"><Input value={p.slug} onChange={e => setP({ ...p, slug: e.target.value })} /></Field>
          <Field label="Repo path"><Input value={p.repo_path} onChange={e => setP({ ...p, repo_path: e.target.value })} /></Field>
          <UrlField label="Repo URL" value={p.repo_url}>
            <UrlInputRow value={p.repo_url} onChange={e => setP({ ...p, repo_url: e.target.value })} placeholder="https://github.com/org/repo" />
          </UrlField>
          <Field label="Package manager">
            <Select value={p.package_manager} onChange={e => setP({ ...p, package_manager: e.target.value })}>
              <option value="npm">npm</option>
              <option value="pnpm">pnpm</option>
              <option value="yarn">yarn</option>
              <option value="bun">bun</option>
            </Select>
          </Field>
          <Field label="Default branch"><Input value={p.default_branch} onChange={e => setP({ ...p, default_branch: e.target.value })} /></Field>
          <Field label="Hosting platform"><Input value={p.hosting_platform} onChange={e => setP({ ...p, hosting_platform: e.target.value })} placeholder="vercel | render | fly | railway | self-hosted" /></Field>
          <Field label="Status">
            <Select value={p.status} onChange={e => setP({ ...p, status: e.target.value })}>
              <option value="active">active</option>
              <option value="archived">archived</option>
              <option value="paused">paused</option>
            </Select>
          </Field>
          <Field label="Tags"><Input value={p.tags} onChange={e => setP({ ...p, tags: e.target.value })} placeholder="comma,separated" /></Field>
          <Field label="Monorepo paths"><Textarea rows={2} value={p.monorepo_paths} onChange={e => setP({ ...p, monorepo_paths: e.target.value })} placeholder="apps/web&#10;apps/api" /></Field>
          <div className="col-span-2"><Field label="Description"><Textarea rows={2} value={p.description} onChange={e => setP({ ...p, description: e.target.value })} /></Field></div>
          <div className="col-span-2"><Field label="Notes"><Textarea rows={3} value={p.notes} onChange={e => setP({ ...p, notes: e.target.value })} /></Field></div>
          <div className="col-span-2"><Field label="Danger notes"><Textarea rows={2} value={p.danger_notes} onChange={e => setP({ ...p, danger_notes: e.target.value })} placeholder="Actions that require confirmation or can cause data loss" /></Field></div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader title="At a glance" />
          <div className="p-5 space-y-2 text-sm">
            <Row label="Commands" value={String(scope.commands.length)} />
            <Row label="Ports" value={String(scope.ports.length)} />
            <Row label="URLs" value={String(scope.urls.length)} />
            <Row label="Deployments" value={String(scope.deployments.length)} />
            <Row label="Env keys" value={String(scope.env_keys.length)} />
            <Row label="Infisical refs" value={String(scope.infisical_refs.length)} />
            <Row label="Docker configs" value={String(scope.docker.length)} />
            <Row label="Notes" value={String(scope.notes.length)} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Safety" />
          <div className="p-5 space-y-3 text-sm">
            <div className="flex items-center gap-2"><Badge tone="emerald">local-only</Badge><span className="text-slate-400">Binds 127.0.0.1 in daemon mode</span></div>
            <div className="flex items-center gap-2"><Badge tone="emerald">no raw secrets</Badge><span className="text-slate-400">Only references and key names stored</span></div>
            <div className="flex items-center gap-2"><Badge tone="amber">confirm required</Badge><span className="text-slate-400">Destructive Docker and external PIDs</span></div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between"><span className="text-slate-500">{label}</span><span className="text-slate-200 font-mono">{value}</span></div>
  );
}
