'use client';

import { useEffect } from 'react';

interface ShortcutsModalProps {
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: ['/', 'Enter'], description: 'Focus the question input' },
  { keys: ['Ctrl', 'Enter'], description: 'Submit the question' },
  { keys: ['Ctrl', 'K'], description: 'Open command palette' },
  { keys: ['N'], description: 'New conversation' },
  { keys: ['B'], description: 'Open bookmarks' },
  { keys: ['Esc'], description: 'Blur input / close overlay' },
  { keys: ['?'], description: 'Show this reference' },
];

export function ShortcutsModal({ onClose }: ShortcutsModalProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm mx-4 rounded-2xl shadow-xl"
        style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: 'var(--border)' }}
        >
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
            Keyboard shortcuts
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ color: 'var(--text-muted)' }}
            className="p-1 rounded"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-4 space-y-2.5">
          {SHORTCUTS.map(({ keys, description }) => (
            <div key={description} className="flex items-center justify-between gap-4">
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {description}
              </span>
              <div className="flex items-center gap-1 flex-shrink-0">
                {keys.map((k, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && (
                      <span className="text-xs" style={{ color: 'var(--text-faint)' }}>+</span>
                    )}
                    <kbd
                      className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-xs font-mono"
                      style={{
                        background: 'var(--bg-chip)',
                        border: '1px solid var(--border)',
                        color: 'var(--text)',
                        minWidth: '1.5rem',
                      }}
                    >
                      {k}
                    </kbd>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div
          className="px-5 py-3 border-t text-xs"
          style={{ borderColor: 'var(--border)', color: 'var(--text-faint)' }}
        >
          Shortcuts are disabled while typing in a field.
        </div>
      </div>
    </div>
  );
}
