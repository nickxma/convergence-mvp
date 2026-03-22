'use client';

import { useEffect, useRef } from 'react';

export interface KeyboardShortcutHandlers {
  focusInput: () => void;
  newConversation: () => void;
  openBookmarks: () => void;
  openShortcuts: () => void;
  openCommandPalette: () => void;
  closeAll: () => void;
}

function isInInput(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement;
  return (
    t.tagName === 'INPUT' ||
    t.tagName === 'TEXTAREA' ||
    t.tagName === 'SELECT' ||
    t.isContentEditable
  );
}

export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers) {
  // Keep a ref so the event listener always calls the latest handlers
  // without needing to re-register on every render.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const h = handlersRef.current;

      // Escape: close overlays and blur focused element
      if (e.key === 'Escape') {
        h.closeAll();
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        return;
      }

      // Ctrl+K / Cmd+K: command palette (works everywhere)
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        h.openCommandPalette();
        return;
      }

      // The remaining shortcuts are suppressed when typing in a field
      if (isInInput(e)) return;

      switch (e.key) {
        case '/':
          e.preventDefault();
          h.focusInput();
          break;
        case 'n':
        case 'N':
          h.newConversation();
          break;
        case 'b':
        case 'B':
          h.openBookmarks();
          break;
        case '?':
          h.openShortcuts();
          break;
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []); // register once — latest handlers accessed via ref
}
