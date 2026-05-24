import { useEffect, useRef, useState } from 'react';
import { Github, Unlink, Loader2, Key, ChevronDown } from 'lucide-react';
import { getGitHubToken, upsertGitHubToken, deleteGitHubToken, signInWithGitHub } from '../lib/api';
import type { GitHubToken } from '../lib/types';

async function validatePAT(pat: string): Promise<{ login: string; avatar_url: string; scopes: string }> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).message || `GitHub API ${res.status}`);
  }
  const user = await res.json();
  const scopes = res.headers.get('x-oauth-scopes') || '';
  return { login: user.login, avatar_url: user.avatar_url, scopes };
}

export function GitHubStatus() {
  const [token, setToken] = useState<GitHubToken | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showPAT, setShowPAT] = useState(false);
  const [pat, setPat] = useState('');
  const [saving, setSaving] = useState(false);
  const [patError, setPatError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getGitHubToken()
      .then(setToken)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (showPAT) inputRef.current?.focus();
  }, [showPAT]);

  async function savePAT() {
    const trimmed = pat.trim();
    if (!trimmed) return;
    setSaving(true);
    setPatError('');
    try {
      const { login, avatar_url, scopes } = await validatePAT(trimmed);
      const saved = await upsertGitHubToken(trimmed, login, avatar_url, scopes);
      setToken(saved);
      setShowPAT(false);
      setPat('');
    } catch (err: any) {
      setPatError(err.message || 'Invalid token');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-600 text-xs px-2 py-1.5">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span>Checking GitHub…</span>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="space-y-1">
        <button
          onClick={() => signInWithGitHub().catch(console.error)}
          className="w-full flex items-center gap-2 text-slate-500 hover:text-slate-300 text-xs px-2 py-1.5 transition-colors"
        >
          <Github className="w-3.5 h-3.5 shrink-0" />
          <span>Connect GitHub</span>
        </button>
        <button
          onClick={() => setShowPAT(v => !v)}
          className="w-full flex items-center gap-2 text-slate-600 hover:text-slate-400 text-xs px-2 py-1 transition-colors"
        >
          <Key className="w-3 h-3 shrink-0" />
          <span>Use a token (PAT)</span>
          <ChevronDown className={`w-3 h-3 ml-auto transition-transform ${showPAT ? 'rotate-180' : ''}`} />
        </button>
        {showPAT && (
          <div className="px-2 pb-1 space-y-1.5">
            <input
              ref={inputRef}
              type="password"
              value={pat}
              onChange={e => { setPat(e.target.value); setPatError(''); }}
              onKeyDown={e => { if (e.key === 'Enter') savePAT(); if (e.key === 'Escape') setShowPAT(false); }}
              placeholder="ghp_xxxxxxxxxxxx"
              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-slate-500 focus:outline-none font-mono"
            />
            {patError && <p className="text-[10px] text-rose-400">{patError}</p>}
            <button
              onClick={savePAT}
              disabled={saving || !pat.trim()}
              className="w-full flex items-center justify-center gap-1.5 text-xs px-2 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-600/40 text-emerald-400 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              {saving ? 'Validating…' : 'Save token'}
            </button>
            <p className="text-[10px] text-slate-600 leading-relaxed">
              Needs <code className="font-mono">repo</code>, <code className="font-mono">workflow</code>, and <code className="font-mono">read:user</code> scopes.{' '}
              <a
                href="https://github.com/settings/tokens/new?scopes=repo,workflow,read:user&description=cockpit"
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-500 hover:text-slate-300 underline"
              >
                Generate one
              </a>
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs px-2 py-1.5 group">
      {token.github_avatar_url ? (
        <img src={token.github_avatar_url} alt="" className="w-4 h-4 rounded-full" />
      ) : (
        <Github className="w-3.5 h-3.5 text-slate-400" />
      )}
      <span className="text-slate-400 truncate flex-1">
        {token.github_username || 'GitHub connected'}
      </span>
      <button
        onClick={async () => {
          setDisconnecting(true);
          try {
            await deleteGitHubToken();
            setToken(null);
          } catch {
            setDisconnecting(false);
          }
        }}
        disabled={disconnecting}
        className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-rose-400 transition-all"
        title="Disconnect GitHub"
      >
        {disconnecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Unlink className="w-3 h-3" />}
      </button>
    </div>
  );
}
