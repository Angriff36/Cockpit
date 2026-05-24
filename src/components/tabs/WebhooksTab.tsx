import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, TestTube2, RefreshCw, CheckCircle2, XCircle, Loader2, Zap, AlertCircle, WifiOff, ExternalLink } from 'lucide-react';
import type { ProjectScope } from '../../lib/types';
import {
  listWebhookConfigs,
  listWebhookDeliveries,
  registerWebhookConfig,
  removeWebhookConfig,
  testWebhook,
  type WebhookConfigState,
  type WebhookDeliveryEntry,
} from '../../lib/daemon';
import { Card, CardHeader, Field, Input, Button, Badge } from '../ui';
import { ExternalHref } from '../ExternalLink';

const COMMON_EVENTS = [
  'daemon.start', 'daemon.stop',
  'process.started', 'process.stopped',
  'deploy.triggered',
  'health.check',
  'field.update',
  'sync.complete',
];

function generateId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function timeAgo(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── Delivery log ────────────────────────────────────────────────────────────

function DeliveryRow({ d }: { d: WebhookDeliveryEntry }) {
  const [expanded, setExpanded] = useState(false);
  const ok = d.status === 'delivered';

  return (
    <div className="border-b border-slate-800/50 last:border-0">
      <button
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-800/30 transition-colors text-left"
        onClick={() => setExpanded(e => !e)}
      >
        {ok
          ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          : <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />}
        <span className="text-xs font-mono text-slate-300 flex-1 truncate">{d.event}</span>
        {d.statusCode && (
          <span className={`text-[10px] font-mono ${ok ? 'text-emerald-400' : 'text-rose-400'}`}>{d.statusCode}</span>
        )}
        <span className="text-[10px] text-slate-600">{timeAgo(d.createdAt)}</span>
        {d.attemptCount > 1 && (
          <span className="text-[10px] text-amber-500">{d.attemptCount} attempts</span>
        )}
      </button>
      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {d.responseBody && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Response</div>
              <pre className="text-[11px] font-mono text-slate-400 bg-slate-950 border border-slate-800 rounded p-2 overflow-x-auto max-h-24 overflow-y-auto">{d.responseBody.slice(0, 500)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Webhook config row ───────────────────────────────────────────────────────

function WebhookRow({
  config,
  onRemove,
  onTest,
}: {
  config: WebhookConfigState;
  onRemove: () => void;
  onTest: () => void;
}) {
  const events = config.events ? config.events.split(',').map(e => e.trim()).filter(Boolean) : [];

  return (
    <div className="border-b border-slate-800/50 last:border-0 px-5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${config.enabled ? 'bg-emerald-400' : 'bg-slate-600'}`} />
            <ExternalHref href={config.url} className="text-sm font-mono truncate block">
              {config.url}
            </ExternalHref>
          </div>
          {events.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {events.map(e => (
                <span key={e} className="text-[10px] font-mono bg-slate-800 text-slate-400 rounded px-1.5 py-0.5">{e}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" onClick={onTest} title="Send test payload">
            <TestTube2 className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" onClick={onRemove} title="Remove webhook">
            <Trash2 className="w-3.5 h-3.5 text-rose-400" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Add webhook form ─────────────────────────────────────────────────────────

function AddWebhookForm({
  projectSlug,
  onAdded,
}: {
  projectSlug: string;
  onAdded: () => void;
}) {
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState('daemon.start,process.started,process.stopped');
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    if (!url.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await registerWebhookConfig({
        id: generateId(),
        url: url.trim(),
        events: events.trim() || undefined,
        secret: secret.trim() || undefined,
        enabled: true,
        projectSlug,
      });
      setUrl('');
      setSecret('');
      onAdded();
    } catch (e: any) {
      setError(e?.message || 'Failed to add webhook');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-5 space-y-3 border-b border-slate-800">
      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12">
          <Field label="Endpoint URL">
            <Input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://your-server.com/webhook"
              className="font-mono"
            />
          </Field>
        </div>
        <div className="col-span-8">
          <Field label="Events (comma-separated)">
            <Input
              value={events}
              onChange={e => setEvents(e.target.value)}
              placeholder="daemon.start,process.started"
              className="font-mono"
            />
          </Field>
        </div>
        <div className="col-span-4">
          <Field label="HMAC Secret (optional)">
            <Input
              type="password"
              value={secret}
              onChange={e => setSecret(e.target.value)}
              placeholder="••••••••"
            />
          </Field>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 items-center">
        <span className="text-[10px] uppercase tracking-wider text-slate-500">Quick add:</span>
        {COMMON_EVENTS.map(ev => (
          <button
            key={ev}
            onClick={() => {
              const current = events.split(',').map(e => e.trim()).filter(Boolean);
              if (!current.includes(ev)) {
                setEvents([...current, ev].join(','));
              }
            }}
            className="text-[10px] font-mono bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded px-1.5 py-0.5 transition-colors"
          >
            {ev}
          </button>
        ))}
      </div>
      {error && (
        <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded px-3 py-2">{error}</div>
      )}
      <div className="flex justify-end">
        <Button variant="primary" onClick={handleAdd} disabled={!url.trim() || saving}>
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1" /> : <Plus className="w-3.5 h-3.5 inline mr-1" />}
          Add webhook
        </Button>
      </div>
    </div>
  );
}

// ── Main tab ─────────────────────────────────────────────────────────────────

export function WebhooksTab({
  scope,
  daemonOnline,
}: {
  scope: ProjectScope;
  onChange: () => void;
  daemonOnline: boolean;
}) {
  const [configs, setConfigs] = useState<WebhookConfigState[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDeliveryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, string>>({});

  const slug = scope.project.slug;

  const load = useCallback(async () => {
    if (!daemonOnline) return;
    setLoading(true);
    try {
      const [allConfigs, recentDeliveries] = await Promise.all([
        listWebhookConfigs(),
        listWebhookDeliveries({ limit: 50 }),
      ]);
      setConfigs(allConfigs.filter(c => !c.projectSlug || c.projectSlug === slug));
      setDeliveries(recentDeliveries);
    } catch {
      // daemon unavailable; clear stale data
      setConfigs([]);
      setDeliveries([]);
    } finally {
      setLoading(false);
    }
  }, [daemonOnline, slug]);

  useEffect(() => { load(); }, [load]);

  async function handleRemove(id: string) {
    try {
      await removeWebhookConfig(id);
      await load();
    } catch (e: any) {
      alert(`Remove failed: ${e.message}`);
    }
  }

  async function handleTest(config: WebhookConfigState) {
    setTestResults(prev => ({ ...prev, [config.id]: 'testing' }));
    try {
      const result = await testWebhook(config.url, undefined, 'test.ping');
      setTestResults(prev => ({
        ...prev,
        [config.id]: result.ok ? 'ok' : (result.error || 'failed'),
      }));
    } catch (e: any) {
      setTestResults(prev => ({ ...prev, [config.id]: e?.message || 'error' }));
    }
  }

  if (!daemonOnline) {
    return (
      <Card>
        <CardHeader title="Webhooks" />
        <div className="p-6 flex items-center gap-3 text-slate-500">
          <WifiOff className="w-4 h-4 shrink-0" />
          <span className="text-sm">Daemon must be running to manage webhooks. Start it with <code className="font-mono text-xs bg-slate-800 rounded px-1">ldc daemon</code>.</span>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Configs */}
      <Card>
        <CardHeader
          title="Webhook Endpoints"
          action={
            <div className="flex items-center gap-2">
              <a
                href="https://github.com/Angriff36/cockpit#webhooks"
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-500 hover:text-slate-300 transition-colors"
                title="Webhook docs"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <Button variant="ghost" onClick={load} disabled={loading}>
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          }
        />

        <AddWebhookForm projectSlug={slug} onAdded={load} />

        {configs.length === 0 ? (
          <div className="p-6 text-slate-500 text-sm text-center">
            No webhooks configured for this project.
          </div>
        ) : (
          <div className="divide-y divide-slate-800/30">
            {configs.map(config => (
              <div key={config.id}>
                <WebhookRow
                  config={config}
                  onRemove={() => handleRemove(config.id)}
                  onTest={() => handleTest(config)}
                />
                {testResults[config.id] && (
                  <div className={`px-5 pb-2 text-xs flex items-center gap-1.5 ${
                    testResults[config.id] === 'testing'
                      ? 'text-slate-400'
                      : testResults[config.id] === 'ok'
                        ? 'text-emerald-400'
                        : 'text-rose-400'
                  }`}>
                    {testResults[config.id] === 'testing' ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : testResults[config.id] === 'ok' ? (
                      <CheckCircle2 className="w-3 h-3" />
                    ) : (
                      <AlertCircle className="w-3 h-3" />
                    )}
                    {testResults[config.id] === 'testing' ? 'Sending test...' : testResults[config.id] === 'ok' ? 'Test delivered' : `Test failed: ${testResults[config.id]}`}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Recent deliveries */}
      {deliveries.length > 0 && (
        <Card>
          <CardHeader
            title="Recent Deliveries"
            action={
              <Badge tone="slate">{deliveries.length}</Badge>
            }
          />
          <div className="divide-y divide-slate-800/30">
            {deliveries.map(d => (
              <DeliveryRow key={d.id} d={d} />
            ))}
          </div>
        </Card>
      )}

      {/* Event reference */}
      <Card>
        <CardHeader title="Available Events" />
        <div className="p-5">
          <div className="flex flex-wrap gap-2">
            {COMMON_EVENTS.map(ev => (
              <div key={ev} className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded px-2 py-1">
                <Zap className="w-3 h-3 text-slate-500" />
                <span className="text-[11px] font-mono text-slate-300">{ev}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-600 mt-3">Events are sent as JSON POST requests with <code className="font-mono bg-slate-800 rounded px-1">X-Cockpit-Event</code> and optional HMAC signature headers.</p>
        </div>
      </Card>
    </div>
  );
}
