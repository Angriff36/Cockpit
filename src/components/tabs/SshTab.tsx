import { useState } from 'react';
import { Plus, Trash2, Terminal, FolderOpen, ChevronDown, ChevronRight, Copy, Check, Wifi, WifiOff, RefreshCw, FileJson } from 'lucide-react';
import type { ProjectScope, SshConfig } from '../../lib/types';
import { upsertRow, deleteRow } from '../../lib/api';
import { openTerminal } from '../../lib/daemon';
import { useDaemonOnline } from '../../lib/useDaemonOnline';
import { Card, CardHeader, Field, Input, Button, Badge } from '../ui';
import { JsonImportPanel } from '../JsonImportPanel';

const SSH_TEMPLATE = [
  { label: 'Production', host: 'prod.example.com', port: 22, username: 'ubuntu', identity_file: '~/.ssh/id_rsa', remote_path: '/var/www/app', jump_host: '', notes: '' },
  { label: 'Staging', host: 'staging.example.com', port: 22, username: 'ubuntu', identity_file: '~/.ssh/id_rsa', remote_path: '/var/www/app', jump_host: '', notes: 'Staging environment' },
];

/** Build the ssh command string from a config */
function buildSshCommand(c: SshConfig): string {
  const parts = ['ssh'];
  if (c.identity_file) parts.push(`-i "${c.identity_file}"`);
  if (c.jump_host) parts.push(`-J ${c.jump_host}`);
  if (c.port && c.port !== 22) parts.push(`-p ${c.port}`);
  const target = c.username ? `${c.username}@${c.host}` : c.host;
  parts.push(target);
  return parts.join(' ');
}

function buildSshToPathCommand(c: SshConfig): string {
  const base = buildSshCommand(c);
  if (!c.remote_path) return base;
  return `${base} -t "cd '${c.remote_path}' && exec bash"`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button onClick={copy} className="p-1 text-slate-600 hover:text-slate-400 transition-colors" title="Copy command">
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function SshRow({ cfg, onSave, onRemove, daemonOnline }: {
  cfg: SshConfig;
  onSave: (c: SshConfig) => void;
  onRemove: (id: string) => void;
  daemonOnline: boolean;
}) {
  const [c, setC] = useState(cfg);
  const [expanded, setExpanded] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  function save() { onSave(c); }

  async function connect(toPath = false) {
    if (!c.host) return;
    setConnecting(true);
    setStatus(null);
    try {
      const cmd = toPath ? buildSshToPathCommand(c) : buildSshCommand(c);
      await openTerminal(cmd, undefined, c.label || `${c.username}@${c.host}`);
      setStatus({ ok: true, msg: 'Terminal opened — check your terminal window' });
      setTimeout(() => setStatus(null), 4000);
    } catch (e: any) {
      setStatus({ ok: false, msg: e.message });
    } finally {
      setConnecting(false);
    }
  }

  const sshCmd = buildSshCommand(c);
  const hasHost = Boolean(c.host);

  return (
    <div className={`border rounded transition-colors ${expanded ? 'border-slate-700 bg-slate-900/60' : 'border-slate-800/60 bg-slate-950/40 hover:border-slate-700/60'}`}>
      {/* Compact row */}
      <div className="flex items-center gap-3 px-3 py-2">
        <button onClick={() => setExpanded(e => !e)} className="shrink-0 text-slate-600 hover:text-slate-400 transition-colors">
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>

        <Terminal className="w-3.5 h-3.5 text-cyan-500 shrink-0" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-200 truncate">{c.label || (c.host ? `${c.username}@${c.host}` : 'New connection')}</span>
            {c.host && (
              <span className="text-[11px] text-slate-500 font-mono hidden sm:block truncate">
                {c.username ? `${c.username}@` : ''}{c.host}{c.port !== 22 ? `:${c.port}` : ''}
              </span>
            )}
            {c.remote_path && (
              <span className="text-[11px] text-slate-600 font-mono hidden md:block truncate max-w-[180px]">{c.remote_path}</span>
            )}
          </div>
        </div>

        {hasHost && <CopyButton text={sshCmd} />}

        <div className="flex gap-1 shrink-0">
          {daemonOnline && hasHost && (
            <>
              <button
                onClick={() => connect(false)}
                disabled={connecting}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 transition-colors disabled:opacity-50"
                title="Open SSH terminal"
              >
                <Terminal className="w-3 h-3" /> Connect
              </button>
              {c.remote_path && (
                <button
                  onClick={() => connect(true)}
                  disabled={connecting}
                  className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-slate-700/50 border border-slate-600/40 text-slate-300 hover:bg-slate-700 transition-colors disabled:opacity-50"
                  title="Open SSH terminal at remote path"
                >
                  <FolderOpen className="w-3 h-3" />
                </button>
              )}
            </>
          )}
          <button onClick={() => onRemove(c.id)} className="p-1 rounded text-slate-600 hover:text-rose-400 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Status feedback */}
      {status && (
        <div className={`mx-3 mb-2 px-3 py-1.5 rounded text-[11px] font-mono ${status.ok ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300' : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'}`}>
          {status.msg}
        </div>
      )}

      {/* Generated command preview */}
      {!expanded && hasHost && (
        <div className="px-10 pb-2">
          <code className="text-[10px] text-slate-600 font-mono">{sshCmd}</code>
        </div>
      )}

      {/* Expanded edit form */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-slate-800">
          <div className="grid grid-cols-12 gap-3 mt-3">
            <div className="col-span-4"><Field label="Label"><Input value={c.label} onChange={e => setC({ ...c, label: e.target.value })} onBlur={save} placeholder="dev server" /></Field></div>
            <div className="col-span-4"><Field label="Host"><Input className="font-mono" value={c.host} onChange={e => setC({ ...c, host: e.target.value })} onBlur={save} placeholder="192.168.1.10 or dev.example.com" /></Field></div>
            <div className="col-span-2"><Field label="Port"><Input type="number" value={c.port} onChange={e => setC({ ...c, port: Number(e.target.value) || 22 })} onBlur={save} /></Field></div>
            <div className="col-span-2"><Field label="Username"><Input value={c.username} onChange={e => setC({ ...c, username: e.target.value })} onBlur={save} placeholder="ubuntu" /></Field></div>
            <div className="col-span-6"><Field label="Identity file (local path)"><Input className="font-mono" value={c.identity_file} onChange={e => setC({ ...c, identity_file: e.target.value })} onBlur={save} placeholder="~/.ssh/id_ed25519" /></Field></div>
            <div className="col-span-6"><Field label="Jump host (bastion)"><Input className="font-mono" value={c.jump_host} onChange={e => setC({ ...c, jump_host: e.target.value })} onBlur={save} placeholder="user@bastion.example.com" /></Field></div>
            <div className="col-span-12"><Field label="Remote project path"><Input className="font-mono" value={c.remote_path} onChange={e => setC({ ...c, remote_path: e.target.value })} onBlur={save} placeholder="/home/ubuntu/myproject" /></Field></div>
            <div className="col-span-12"><Field label="Notes"><Input value={c.notes} onChange={e => setC({ ...c, notes: e.target.value })} onBlur={save} /></Field></div>
          </div>
          {hasHost && (
            <div className="mt-3 pt-3 border-t border-slate-800">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">Generated command</span>
                <CopyButton text={sshCmd} />
              </div>
              <code className="text-xs text-slate-400 font-mono bg-slate-950 border border-slate-800 rounded px-3 py-2 block">{sshCmd}</code>
              {c.remote_path && (
                <code className="text-xs text-slate-500 font-mono bg-slate-950 border border-slate-800 rounded px-3 py-1.5 block mt-1">{buildSshToPathCommand(c)}</code>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SshTab({ scope, onChange }: { scope: ProjectScope; onChange: () => void }) {
  const daemonOnline = useDaemonOnline();
  const [testingDaemon, setTestingDaemon] = useState(false);
  const [daemonStatusMsg, setDaemonStatusMsg] = useState('');
  const [importMode, setImportMode] = useState(false);

  async function importSshConfigs(items: unknown[]) {
    for (let i = 0; i < items.length; i++) {
      const s = items[i] as any;
      if (typeof s !== 'object' || s === null) throw new Error(`Item ${i + 1}: must be an object`);
      if (typeof s.host !== 'string' || !s.host.trim()) throw new Error(`Item ${i + 1}: "host" (string) is required`);
    }
    for (const item of items) {
      const s = item as any;
      await upsertRow<SshConfig>('project_ssh_configs', {
        project_id: scope.project.id,
        label: s.label?.trim() || '',
        host: s.host.trim(),
        port: typeof s.port === 'number' ? s.port : 22,
        username: s.username?.trim() || '',
        identity_file: s.identity_file?.trim() || '',
        remote_path: s.remote_path?.trim() || '',
        jump_host: s.jump_host?.trim() || '',
        notes: s.notes?.trim() || '',
      } as any);
    }
    setImportMode(false);
    onChange();
  }

  async function testDaemonConnection() {
    setTestingDaemon(true);
    setDaemonStatusMsg('Testing connection...');
    try {
      const { checkHealth } = await import('../../lib/daemon');
      await checkHealth();
      setDaemonStatusMsg('✅ Daemon connected!');
      setTimeout(() => setDaemonStatusMsg(''), 2000);
    } catch (error) {
      setDaemonStatusMsg(`❌ Daemon unreachable: ${error instanceof Error ? error.message : String(error)}`);
      setTimeout(() => setDaemonStatusMsg(''), 3000);
    } finally {
      setTestingDaemon(false);
    }
  }

  async function add() {
    await upsertRow<SshConfig>('project_ssh_configs', {
      project_id: scope.project.id,
      label: '',
      host: '',
      port: 22,
      username: '',
      identity_file: '',
      remote_path: '',
      jump_host: '',
      notes: '',
    } as any);
    onChange();
  }

  async function update(cfg: SshConfig) {
    await upsertRow<SshConfig>('project_ssh_configs', cfg);
    onChange();
  }

  async function remove(id: string) {
    await deleteRow('project_ssh_configs', id);
    onChange();
  }

  return (
    <div className="space-y-4">
      {importMode && (
        <JsonImportPanel
          title="Import SSH Configs from JSON"
          template={SSH_TEMPLATE}
          schemaHint={'Required: host\nOptional: label, port (default 22), username, identity_file, remote_path, jump_host, notes'}
          onImport={importSshConfigs}
          onClose={() => setImportMode(false)}
        />
      )}

      <Card>
        <CardHeader
          title="SSH Connections"
          action={
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setImportMode(m => !m)}>
                <FileJson className="w-3 h-3 inline mr-1" />Import JSON
              </Button>
              <button
                onClick={testDaemonConnection}
                disabled={testingDaemon}
                className="px-2 py-1 text-xs flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors disabled:opacity-50"
                title="Test daemon connection"
              >
                {testingDaemon ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : daemonOnline ? (
                  <Wifi className="w-3 h-3 text-emerald-400" />
                ) : (
                  <WifiOff className="w-3 h-3 text-rose-400" />
                )}
                {testingDaemon ? 'Testing...' : daemonOnline ? 'Daemon Online' : 'Test Daemon'}
              </button>
              {daemonStatusMsg && (
                <span className="text-xs text-slate-400">{daemonStatusMsg}</span>
              )}
              <Button onClick={add}><Plus className="w-3 h-3 inline mr-1" />Add</Button>
            </div>
          }
        />
        <div className="p-5 space-y-2">
          {scope.ssh_configs.length === 0 && (
            <div className="text-sm text-slate-500">
              No SSH connections yet. Add a connection to quickly SSH into remote machines or Linux dev environments from this project.
            </div>
          )}
          {scope.ssh_configs.map(cfg => (
            <SshRow key={cfg.id} cfg={cfg} onSave={update} onRemove={remove} daemonOnline={daemonOnline} />
          ))}

          {!daemonOnline && scope.ssh_configs.length > 0 && (
            <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded text-sm text-amber-200">
              <div className="flex items-center gap-2 mb-2">
                <Terminal className="w-4 h-4" />
                <span className="font-medium">Daemon Offline - Manual SSH Commands</span>
              </div>
              <div className="text-xs text-amber-300/80 mb-2">
                The daemon is not running. You can manually run these SSH commands:
              </div>
              <div className="space-y-1">
                {scope.ssh_configs.map(cfg => {
                  const cmd = buildSshCommand(cfg);
                  return (
                    <div key={cfg.id} className="flex items-center gap-2 bg-slate-950 rounded px-2 py-1">
                      <code className="text-xs font-mono text-slate-300 flex-1 truncate">{cmd}</code>
                      <button
                        onClick={() => navigator.clipboard.writeText(cmd)}
                        className="text-xs px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded"
                      >
                        Copy
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </Card>

      {!daemonOnline && scope.ssh_configs.length > 0 && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded px-4 py-3 text-xs text-amber-200/80">
          <span className="font-medium">Daemon offline</span> — Connect buttons require the <code className="font-mono">ldc daemon</code> to be running locally to open terminal windows.
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded px-4 py-3">
        <div className="text-xs text-slate-400 font-medium mb-2">Multiple directories</div>
        <div className="text-xs text-slate-500 space-y-1">
          <p>Store separate SSH configs for each remote path — e.g. one for your Linux dev box root and one pointed at a specific project directory.</p>
          <p>The <Badge tone="emerald">Connect</Badge> button opens a plain SSH shell. The <span className="inline-flex items-center gap-1 text-slate-400"><FolderOpen className="w-3 h-3" /> folder</span> button opens SSH directly into the remote project path.</p>
        </div>
      </div>
    </div>
  );
}
