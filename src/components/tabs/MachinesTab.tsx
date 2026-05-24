import { useState, useEffect } from 'react';
import { Trash2, Monitor, Save, RefreshCw, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';
import type { ProjectScope, Machine, MachineOverride } from '../../lib/types';
import {
  listMachines, upsertMachine, deleteMachine, registerMachine,
  upsertMachineOverride, deleteMachineOverride,
} from '../../lib/api';
import { getMachineIdentity } from '../../lib/daemon';
import { useDaemonOnline } from '../../lib/useDaemonOnline';
import { Card, CardHeader, Field, Input, Textarea, Button, Badge } from '../ui';

function OverrideRow({ override, machine, onSave, onRemove }: {
  override: MachineOverride;
  machine: Machine | undefined;
  onSave: (o: MachineOverride) => void;
  onRemove: (id: string) => void;
}) {
  const [o, setO] = useState(override);
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`border rounded transition-colors ${expanded ? 'border-slate-700 bg-slate-900/60' : 'border-slate-800/60 bg-slate-950/40 hover:border-slate-700/60'}`}>
      <div className="flex items-center gap-3 px-3 py-2">
        <button onClick={() => setExpanded(e => !e)} className="shrink-0 text-slate-600 hover:text-slate-400 transition-colors">
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        <Monitor className="w-3.5 h-3.5 text-blue-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-200 truncate">{machine?.label || machine?.hostname || 'Unknown machine'}</span>
            {machine?.is_current && <Badge tone="emerald">current</Badge>}
            {o.port_offset !== 0 && <span className="text-[11px] text-amber-400 font-mono">port offset: {o.port_offset > 0 ? '+' : ''}{o.port_offset}</span>}
          </div>
          {o.repo_path && (
            <div className="text-[11px] text-slate-500 font-mono truncate">{o.repo_path}</div>
          )}
        </div>
        <button onClick={() => onRemove(o.id)} className="p-1 rounded text-slate-600 hover:text-rose-400 transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-slate-800">
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Field label="Repo path (on this machine)">
              <Input className="font-mono" value={o.repo_path} onChange={e => setO({ ...o, repo_path: e.target.value })} placeholder="C:\Projects\my-app or /home/user/my-app" />
            </Field>
            <Field label="Port offset">
              <Input type="number" value={o.port_offset} onChange={e => setO({ ...o, port_offset: Number(e.target.value) || 0 })} placeholder="0" />
            </Field>
            <div className="col-span-2">
              <Field label="Working dir override">
                <Input className="font-mono" value={o.working_dir_override} onChange={e => setO({ ...o, working_dir_override: e.target.value })} placeholder="Override command working directories" />
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="Custom environment variables">
                <Textarea rows={3} value={o.custom_env} onChange={e => setO({ ...o, custom_env: e.target.value })} placeholder="KEY=value&#10;ANOTHER_KEY=value" />
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="Notes">
                <Input value={o.notes} onChange={e => setO({ ...o, notes: e.target.value })} placeholder="Machine-specific notes" />
              </Field>
            </div>
          </div>
          <div className="flex justify-end mt-3">
            <Button onClick={() => onSave(o)}><Save className="w-3 h-3 inline mr-1" />Save</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function MachineRow({ machine, onSave, onRemove }: {
  machine: Machine;
  onSave: (m: Machine) => void;
  onRemove: (id: string) => void;
}) {
  const [m, setM] = useState(machine);
  const [editing, setEditing] = useState(false);

  return (
    <div className={`border rounded transition-colors ${editing ? 'border-slate-700 bg-slate-900/60' : 'border-slate-800/60 bg-slate-950/40 hover:border-slate-700/60'}`}>
      <div className="flex items-center gap-3 px-3 py-2">
        <button onClick={() => setEditing(e => !e)} className="shrink-0 text-slate-600 hover:text-slate-400 transition-colors">
          {editing ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        <Monitor className="w-3.5 h-3.5 text-blue-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-200 truncate">{m.label || m.hostname}</span>
            {m.is_current && <Badge tone="emerald">current</Badge>}
            <span className="text-[11px] text-slate-500 font-mono">{m.hostname}</span>
            {m.os && <Badge tone="blue">{m.os}</Badge>}
            {m.arch && <span className="text-[10px] text-slate-600">{m.arch}</span>}
          </div>
        </div>
        <button onClick={() => onRemove(m.id)} className="p-1 rounded text-slate-600 hover:text-rose-400 transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {editing && (
        <div className="px-4 pb-4 pt-1 border-t border-slate-800">
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Field label="Label"><Input value={m.label} onChange={e => setM({ ...m, label: e.target.value })} /></Field>
            <Field label="Hostname"><Input className="font-mono" value={m.hostname} onChange={e => setM({ ...m, hostname: e.target.value })} /></Field>
            <Field label="OS"><Input value={m.os} onChange={e => setM({ ...m, os: e.target.value })} /></Field>
            <Field label="Architecture"><Input value={m.arch} onChange={e => setM({ ...m, arch: e.target.value })} /></Field>
            <div className="col-span-2"><Field label="Notes"><Input value={m.notes} onChange={e => setM({ ...m, notes: e.target.value })} /></Field></div>
          </div>
          <div className="flex justify-end mt-3">
            <Button onClick={() => { onSave(m); setEditing(false); }}><Save className="w-3 h-3 inline mr-1" />Save</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function MachinesTab({ scope, onChange }: { scope: ProjectScope; onChange: () => void }) {
  const daemonOnline = useDaemonOnline();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);

  async function loadMachines() {
    setLoading(true);
    try {
      const ms = await listMachines();
      setMachines(ms);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadMachines(); }, []);

  async function handleRegisterCurrent() {
    setRegistering(true);
    try {
      const identity = await getMachineIdentity();
      if (!identity.hostname) {
        alert('Could not detect machine hostname. Make sure the daemon is running.');
        return;
      }
      await registerMachine(identity.hostname, identity.os, identity.arch);
      await loadMachines();
      onChange();
    } catch (e: any) {
      alert(`Failed to register machine: ${e.message}`);
    } finally {
      setRegistering(false);
    }
  }

  async function saveMachine(m: Machine) {
    await upsertMachine(m);
    await loadMachines();
  }

  async function removeMachine(id: string) {
    if (!confirm('Delete this machine? All its project overrides will also be removed.')) return;
    await deleteMachine(id);
    await loadMachines();
    onChange();
  }

  // Override helpers
  async function addOverride(machineId: string) {
    await upsertMachineOverride({
      project_id: scope.project.id,
      machine_id: machineId,
      repo_path: '',
      port_offset: 0,
      working_dir_override: '',
      custom_env: '',
      notes: '',
    } as any);
    onChange();
  }

  async function saveOverride(o: MachineOverride) {
    await upsertMachineOverride(o);
    onChange();
  }

  async function removeOverride(id: string) {
    await deleteMachineOverride(id);
    onChange();
  }

  const currentMachine = machines.find(m => m.is_current);
  const machinesWithoutOverride = machines.filter(
    m => !scope.machine_overrides.some(o => o.machine_id === m.id)
  );

  return (
    <div className="space-y-4">
      {/* Registered machines */}
      <Card>
        <CardHeader title="Registered Machines" action={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={loadMachines}><RefreshCw className="w-3 h-3" /></Button>
            {daemonOnline && (
              <Button onClick={handleRegisterCurrent} disabled={registering}>
                <CheckCircle2 className="w-3 h-3 inline mr-1" />{registering ? 'Detecting...' : 'Register This Machine'}
              </Button>
            )}
          </div>
        } />
        <div className="p-5 space-y-2">
          {loading && machines.length === 0 && (
            <div className="text-sm text-slate-500">Loading machines...</div>
          )}
          {!loading && machines.length === 0 && (
            <div className="text-sm text-slate-500">
              No machines registered yet. Start the daemon and click "Register This Machine" to detect your current machine, or add one manually.
            </div>
          )}
          {machines.map(m => (
            <MachineRow key={m.id} machine={m} onSave={saveMachine} onRemove={removeMachine} />
          ))}
        </div>
      </Card>

      {/* Machine overrides for this project */}
      <Card>
        <CardHeader title="Machine Overrides" action={
          machinesWithoutOverride.length > 0 ? (
            <div className="flex items-center gap-2">
              <select
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-slate-300 focus:border-emerald-500 focus:outline-none"
                defaultValue=""
                onChange={(e) => { if (e.target.value) { addOverride(e.target.value); e.target.value = ''; } }}
              >
                <option value="" disabled>Add override for...</option>
                {machinesWithoutOverride.map(m => (
                  <option key={m.id} value={m.id}>{m.label || m.hostname}</option>
                ))}
              </select>
            </div>
          ) : undefined
        } />
        <div className="p-5 space-y-2">
          {scope.machine_overrides.length === 0 && (
            <div className="text-sm text-slate-500">
              No machine-specific overrides for this project. Add an override to customize paths, ports, or environment for a specific machine.
            </div>
          )}
          {scope.machine_overrides.map(o => (
            <OverrideRow
              key={o.id}
              override={o}
              machine={machines.find(m => m.id === o.machine_id)}
              onSave={saveOverride}
              onRemove={removeOverride}
            />
          ))}
        </div>
      </Card>

      {/* Info panel */}
      <div className="bg-slate-900 border border-slate-800 rounded px-4 py-3">
        <div className="text-xs text-slate-400 font-medium mb-2">How multi-machine sync works</div>
        <div className="text-xs text-slate-500 space-y-1">
          <p>Project configurations (commands, ports, URLs, deployments) are shared across all your machines via Supabase. Machine-specific values like <strong>repo paths</strong> and <strong>port offsets</strong> are stored as overrides.</p>
          <p>The daemon detects your machine's <strong>hostname</strong> automatically. Register each machine once, then add per-project overrides where paths or ports differ.</p>
          <p><strong>Port offset</strong> shifts all project ports by the specified amount — useful when running the same project on different machines with different port layouts.</p>
          {!daemonOnline && (
            <p className="text-amber-300 mt-2">The daemon is currently offline. Start it with <code className="font-mono bg-slate-950 px-1 rounded">ldc daemon</code> to enable machine detection.</p>
          )}
        </div>
      </div>

      {/* Current machine indicator */}
      {currentMachine && (
        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded px-4 py-3 text-xs text-emerald-200/80">
          <span className="font-medium">Current machine:</span> {currentMachine.label || currentMachine.hostname}
          <span className="text-emerald-500/60 ml-2">({currentMachine.os} {currentMachine.arch})</span>
          {currentMachine.last_seen_at && (
            <span className="text-emerald-500/40 ml-2">Last seen: {new Date(currentMachine.last_seen_at).toLocaleString()}</span>
          )}
        </div>
      )}
    </div>
  );
}
