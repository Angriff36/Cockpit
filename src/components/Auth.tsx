import { useState } from 'react';
import { Terminal, LogIn, Github } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { signInWithGitHub } from '../lib/api';

export function Auth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [loading, setLoading] = useState(false);
  const [ghLoading, setGhLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const fn = mode === 'signin'
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({ email, password });
      const { error } = await fn;
      if (error) setError(error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-12 h-12 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
            <Terminal className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-100">Local Dev Cockpit</h1>
            <p className="text-xs text-slate-500">Project Source of Truth</p>
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <h2 className="text-lg font-medium text-slate-100 mb-1">
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </h2>
          <p className="text-sm text-slate-500 mb-5">Access your project cockpit</p>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 text-sm focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Password</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 text-sm focus:border-emerald-500 focus:outline-none"
              />
            </div>
            {error && <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded px-3 py-2">{error}</div>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-medium rounded px-4 py-2 text-sm flex items-center justify-center gap-2 transition-colors"
            >
              <LogIn className="w-4 h-4" />
              {loading ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
            </button>
          </form>
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-slate-800" />
            <span className="text-xs text-slate-600">or</span>
            <div className="flex-1 h-px bg-slate-800" />
          </div>
          <button
            type="button"
            disabled={ghLoading}
            onClick={async () => {
              setGhLoading(true);
              setError('');
              try {
                await signInWithGitHub();
              } catch (err: any) {
                setError(err.message || 'GitHub sign-in failed');
                setGhLoading(false);
              }
            }}
            className="w-full bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-100 font-medium rounded px-4 py-2 text-sm flex items-center justify-center gap-2 transition-colors border border-slate-700"
          >
            <Github className="w-4 h-4" />
            {ghLoading ? 'Redirecting…' : 'Continue with GitHub'}
          </button>
          <button
            onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
            className="mt-4 w-full text-xs text-slate-500 hover:text-slate-300"
          >
            {mode === 'signin' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
          </button>
        </div>
        <p className="text-center text-xs text-slate-600 mt-6">
          Local-first. No secret values are stored.
        </p>
      </div>
    </div>
  );
}
