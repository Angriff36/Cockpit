import { Component, ReactNode } from 'react';
import { WifiOff, Clock, AlertTriangle } from 'lucide-react';
import { formatAge } from '../lib/cache';

// ── Error Boundary ───────────────────────────────────────────────────────────

type EBState = { hasError: boolean; error: Error | null };

export class ErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, EBState> {
  constructor(props: { children: ReactNode; fallback?: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error): EBState {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex items-center justify-center min-h-[200px] p-8">
          <div className="text-center max-w-sm">
            <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto mb-3" />
            <div className="text-rose-300 text-sm font-semibold mb-1">Something went wrong</div>
            <div className="text-slate-500 text-xs mb-4">{this.state.error?.message}</div>
            <button
              className="px-3 py-1.5 rounded text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-slate-900 border border-slate-800 rounded-lg ${className}`}>{children}</div>;
}

export function CardHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800">
      <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
      {action}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wider font-medium text-slate-500 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 text-sm placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none ${props.className || ''}`}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 text-sm placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none font-mono ${props.className || ''}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 text-sm focus:border-emerald-500 focus:outline-none ${props.className || ''}`}
    />
  );
}

export function Button({
  children, variant = 'primary', className = '', ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  const variants = {
    primary: 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-medium',
    secondary: 'bg-slate-800 hover:bg-slate-700 text-slate-200',
    danger: 'bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300',
    ghost: 'text-slate-400 hover:text-slate-200 hover:bg-slate-800',
  };
  return (
    <button
      {...rest}
      className={`px-3 py-1.5 rounded text-xs transition-colors disabled:opacity-50 ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'emerald' | 'amber' | 'rose' | 'blue' }) {
  const tones = {
    slate: 'bg-slate-800 text-slate-300 border-slate-700',
    emerald: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
    amber: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
    rose: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
    blue: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  };
  return <span className={`inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded border ${tones[tone]}`}>{children}</span>;
}

// ── Offline-mode components ─────────────────────────────────────────────────

export function OfflineBanner() {
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 text-amber-300 text-xs">
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>Offline — showing cached data. Changes are disabled until connectivity is restored.</span>
    </div>
  );
}

export function StaleIndicator({ cachedAt }: { cachedAt: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-amber-400/80" title={`Cached ${new Date(cachedAt).toLocaleString()}`}>
      <Clock className="w-3 h-3" />
      {formatAge(cachedAt)}
    </span>
  );
}

// ── Checkbox ─────────────────────────────────────────────────────────────────

export function Checkbox({
  checked, indeterminate, onChange, className = '',
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      onClick={e => { e.stopPropagation(); onChange(!checked); }}
      className={`w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0 ${
        checked || indeterminate
          ? 'bg-emerald-500 border-emerald-500 text-slate-950'
          : 'border-slate-600 hover:border-slate-400 bg-transparent'
      } ${className}`}
    >
      {checked && (
        <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="2.5 6 5 8.5 9.5 3.5" />
        </svg>
      )}
      {indeterminate && !checked && (
        <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="3" y1="6" x2="9" y2="6" />
        </svg>
      )}
    </button>
  );
}

// ── Sparkline ────────────────────────────────────────────────────────────────

export function Sparkline({
  data,
  width = 64,
  height = 16,
}: {
  /** Array of booleans — true = up, false = down. Displayed oldest→newest (left→right). */
  data: boolean[];
  width?: number;
  height?: number;
}) {
  if (data.length === 0) return null;

  const barW = Math.max(1, width / data.length);
  const gap = data.length > 40 ? 0 : 1;
  const radius = 1;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="inline-block">
      {data.map((up, i) => {
        const x = i * barW;
        // Full-height bars: up=emerald, down=rose
        const fill = up ? 'rgb(52 211 153 / 0.7)' : 'rgb(251 113 133 / 0.5)';
        return (
          <rect
            key={i}
            x={x}
            y={0}
            width={Math.max(0.5, barW - gap)}
            height={height}
            rx={radius}
            fill={fill}
          />
        );
      })}
    </svg>
  );
}

// ── Modal ────────────────────────────────────────────────────────────────────

export function Modal({
  open, onClose, title, children, width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: string;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-slate-900 border border-slate-700 rounded-xl shadow-2xl ${width} w-full mx-4`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors p-1">
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
