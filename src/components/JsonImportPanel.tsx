import { useState } from 'react';
import { FileJson, Copy, AlertTriangle } from 'lucide-react';
import { Card, CardHeader, Button } from './ui';

type Props = {
  title?: string;
  template: unknown;
  schemaHint?: string;       // one or two short lines describing required/optional fields
  onImport: (items: unknown[]) => Promise<void>;
  onClose: () => void;
};

export function JsonImportPanel({ title = 'Import from JSON', template, schemaHint, onImport, onClose }: Props) {
  const [json, setJson] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  async function handleImport() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (e: any) {
      setError(`Invalid JSON: ${e.message}`);
      return;
    }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    setError(null);
    setImporting(true);
    try {
      await onImport(items);
    } catch (e: any) {
      setError(e.message ?? 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={title}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setJson(JSON.stringify(template, null, 2)); setError(null); }}
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
            >
              <Copy className="w-3 h-3" />Load template
            </button>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={handleImport} disabled={importing || !json.trim()}>
              <FileJson className="w-3 h-3 inline mr-1" />
              {importing ? 'Importing…' : 'Import'}
            </Button>
          </div>
        }
      />
      <div className="p-5 space-y-3">
        <p className="text-xs text-slate-400">
          Paste a single object or an array of objects. Click <strong className="text-slate-300">Load template</strong> to see the full schema.
        </p>
        <textarea
          value={json}
          onChange={e => { setJson(e.target.value); setError(null); }}
          placeholder={'{\n  "name": "...",\n  ...\n}'}
          rows={14}
          spellCheck={false}
          className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2.5 text-xs font-mono text-slate-200 placeholder:text-slate-700 focus:border-emerald-500 focus:outline-none resize-y"
        />
        {error && (
          <div className="flex items-start gap-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            {error}
          </div>
        )}
        {schemaHint && (
          <p className="text-[11px] text-slate-600 whitespace-pre-line">{schemaHint}</p>
        )}
      </div>
    </Card>
  );
}
