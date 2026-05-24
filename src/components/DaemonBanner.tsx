import { useEffect, useState } from 'react';
import { Terminal, Play, Copy, Check } from 'lucide-react';
import { checkHealth } from '../lib/daemon';

export function DaemonBanner() {
  const [online, setOnline] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const result = await checkHealth();
        console.log('Daemon health check result:', result);
        setOnline(true);
      } catch (error) {
        console.error('Daemon health check failed:', error);
        setOnline(false);
      }
    };

    checkStatus();
    // Recheck every 5 seconds
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const copyCommand = () => {
    navigator.clipboard.writeText('ldc daemon');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const startDaemon = () => {
    setStarting(true);
    copyCommand();
    setTimeout(() => setStarting(false), 1000);
  };

  if (online === null || online === true) return null;

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
            <Terminal className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-amber-200">Daemon Offline</p>
            <p className="text-xs text-amber-300/70">Start the daemon to enable commands, deployments, and machine detection</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-xs text-amber-300/70 mr-2">
            <code className="font-mono bg-slate-950/50 px-2 py-1 rounded">
              ldc daemon
            </code>
          </div>

          <button
            onClick={copyCommand}
            className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 flex items-center gap-1.5 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied!' : 'Copy Command'}
          </button>

          <button
            onClick={startDaemon}
            disabled={starting}
            className="px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" />
            {starting ? 'Copied!' : 'Copy & Start'}
          </button>
        </div>
      </div>
    </div>
  );
}