import { useEffect, useRef } from 'react';
import { Keyboard, X } from 'lucide-react';
import type { Shortcut } from '../lib/useKeyboardShortcuts';
import { formatShortcut } from '../lib/useKeyboardShortcuts';

type Props = {
  open: boolean;
  onClose: () => void;
  shortcuts: readonly Pick<Shortcut, 'key' | 'ctrl' | 'shift' | 'alt' | 'label' | 'group'>[];
};

export function ShortcutHelpModal({ open, onClose, shortcuts }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (overlayRef.current && e.target === overlayRef.current) onClose();
    }
    const el = overlayRef.current;
    el?.addEventListener('mousedown', handleClick);
    return () => el?.removeEventListener('mousedown', handleClick);
  }, [open, onClose]);

  if (!open) return null;

  // Group shortcuts
  const groups = new Map<string, typeof shortcuts extends readonly (infer T)[] ? T[] : never>();
  for (const s of shortcuts) {
    const list = groups.get(s.group) ?? [];
    list.push(s);
    groups.set(s.group, list);
  }
  // Always include the help shortcut itself
  if (!shortcuts.some(s => s.key === '?')) {
    const helpGroup = groups.get('General') ?? [];
    helpGroup.unshift({ key: '?', label: 'Show keyboard shortcuts', group: 'General' });
    groups.set('General', helpGroup);
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <Keyboard className="w-4.5 h-4.5 text-emerald-400" />
            <h3 className="text-sm font-semibold text-slate-100">Keyboard Shortcuts</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 transition-colors p-1 rounded hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-5 py-4 space-y-5">
          {Array.from(groups.entries()).map(([group, items]) => (
            <div key={group}>
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-2">
                {group}
              </div>
              <div className="space-y-1">
                {items.map((s, i) => (
                  <div
                    key={`${s.key}-${i}`}
                    className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-slate-800/50"
                  >
                    <span className="text-xs text-slate-300">{s.label}</span>
                    <kbd className="inline-flex items-center gap-0.5 px-2 py-0.5 bg-slate-800 border border-slate-700 rounded text-[11px] font-mono text-slate-400 min-w-[28px] justify-center">
                      {formatShortcut(s)}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800 text-center">
          <span className="text-[10px] text-slate-600">
            Press <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-[10px] font-mono text-slate-500">?</kbd> or <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-[10px] font-mono text-slate-500">Esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}
