import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { ProjectScope, ProjectUrl } from '../../lib/types';
import { upsertRow, deleteRow } from '../../lib/api';
import { Card, CardHeader, Field, Input, Select, Button } from '../ui';
import { UrlInputRow } from '../ExternalLink';

const CATEGORIES = ['local-app', 'local-api', 'production', 'preview', 'admin', 'dashboard', 'vercel', 'sentry', 'supabase', 'infisical', 'docs', 'repo', 'other'];

function UrlRow({ u: initial, onSave, onRemove }: { u: ProjectUrl; onSave: (u: ProjectUrl) => void; onRemove: (id: string) => void }) {
  const [u, setU] = useState(initial);

  function save() { onSave(u); }

  return (
    <div className="bg-slate-950 border border-slate-800 rounded p-4 grid grid-cols-12 gap-3">
      <div className="col-span-3"><Field label="Label"><Input value={u.label} onChange={e => setU({ ...u, label: e.target.value })} onBlur={save} /></Field></div>
      <div className="col-span-2"><Field label="Category">
        <Select value={u.category} onChange={e => { const n = { ...u, category: e.target.value }; setU(n); onSave(n); }}>
          {CATEGORIES.map(c => <option key={c}>{c}</option>)}
        </Select>
      </Field></div>
      <div className="col-span-2"><Field label="Environment"><Input value={u.environment} onChange={e => setU({ ...u, environment: e.target.value })} onBlur={save} placeholder="prod | staging | local" /></Field></div>
      <div className="col-span-5"><Field label="URL"><UrlInputRow value={u.url} onChange={e => setU({ ...u, url: e.target.value })} onBlur={save} openLabel="Open URL" /></Field></div>
      <div className="col-span-12 flex justify-end gap-2">
        <Button variant="danger" onClick={() => onRemove(u.id)}><Trash2 className="w-3 h-3" /></Button>
      </div>
    </div>
  );
}

export function UrlsTab({ scope, onChange }: { scope: ProjectScope; onChange: () => void }) {
  async function add() {
    await upsertRow<ProjectUrl>('project_urls', { project_id: scope.project.id, label: 'New URL', url: '', category: 'other' } as any);
    onChange();
  }
  async function update(u: ProjectUrl) { await upsertRow<ProjectUrl>('project_urls', u); onChange(); }
  async function remove(id: string) { await deleteRow('project_urls', id); onChange(); }

  return (
    <Card>
      <CardHeader title="URLs & Dashboards" action={<Button onClick={add}><Plus className="w-3 h-3 inline mr-1" />Add</Button>} />
      <div className="p-5 space-y-3">
        {scope.urls.length === 0 && <div className="text-sm text-slate-500">No URLs yet.</div>}
        {scope.urls.map(u => (
          <UrlRow key={u.id} u={u} onSave={update} onRemove={remove} />
        ))}
      </div>
    </Card>
  );
}
