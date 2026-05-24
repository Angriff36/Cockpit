import { useEffect, useCallback, useRef, useState } from 'react';

export type Shortcut = {
  key: string;             // e.g. 'k', '?', '1', 'ArrowLeft'
  ctrl?: boolean;          // Ctrl (Win/Linux) or Cmd (Mac)
  shift?: boolean;
  alt?: boolean;
  label: string;           // human-readable, shown in help overlay
  group: string;           // grouping in the overlay (Navigation, Actions, etc.)
  action: () => void;
};

type ShortcutEntry = Omit<Shortcut, 'action'> & { action: () => void };

function isEditableTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

function matchesShortcut(e: KeyboardEvent, s: ShortcutEntry): boolean {
  const wantCtrl = !!s.ctrl;
  const wantShift = !!s.shift;
  const wantAlt = !!s.alt;

  const hasCtrl = e.metaKey || e.ctrlKey;
  const hasShift = e.shiftKey;
  const hasAlt = e.altKey;

  if (wantCtrl !== hasCtrl) return false;
  if (wantAlt !== hasAlt) return false;

  // For shifted characters like '?', the browser already sets e.key='?'
  // so we don't require explicit shift match unless the shortcut declares it
  if (s.shift !== undefined && wantShift !== hasShift) return false;

  return e.key.toLowerCase() === s.key.toLowerCase();
}

export function useKeyboardShortcuts() {
  const [showHelp, setShowHelp] = useState(false);
  const registryRef = useRef<ShortcutEntry[]>([]);

  const register = useCallback((shortcuts: Shortcut[]) => {
    registryRef.current = shortcuts;
  }, []);

  const getShortcuts = useCallback((): readonly ShortcutEntry[] => {
    return registryRef.current;
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Always allow closing help with Escape
      if (e.key === 'Escape' && showHelp) {
        setShowHelp(false);
        return;
      }

      // Skip shortcuts when typing in form fields (unless it's a modifier combo)
      if (isEditableTarget(e) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        return;
      }

      // '?' toggles the help overlay
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!isEditableTarget(e)) {
          e.preventDefault();
          setShowHelp(prev => !prev);
          return;
        }
      }

      // Don't fire action shortcuts while help is showing (except Escape above)
      if (showHelp) return;

      for (const shortcut of registryRef.current) {
        if (matchesShortcut(e, shortcut)) {
          e.preventDefault();
          shortcut.action();
          return;
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showHelp]);

  return { showHelp, setShowHelp, register, getShortcuts };
}

/** Format a shortcut for display — e.g. "Ctrl+K" or "?" */
export function formatShortcut(s: Pick<Shortcut, 'key' | 'ctrl' | 'shift' | 'alt'>): string {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  const parts: string[] = [];
  if (s.ctrl) parts.push(isMac ? '\u2318' : 'Ctrl');
  if (s.alt) parts.push(isMac ? '\u2325' : 'Alt');
  if (s.shift) parts.push(isMac ? '\u21E7' : 'Shift');

  // Pretty-print known keys
  const keyMap: Record<string, string> = {
    arrowleft: '\u2190',
    arrowright: '\u2192',
    arrowup: '\u2191',
    arrowdown: '\u2193',
    escape: 'Esc',
    enter: '\u23CE',
    ' ': 'Space',
  };
  const display = keyMap[s.key.toLowerCase()] ?? s.key.toUpperCase();
  parts.push(display);

  return parts.join(isMac ? '' : '+');
}
