'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/use-auth';

interface Props {
  answerId: string;
  /** When true the button starts as already-saved (for permalink page SSR state). */
  initialSaved?: boolean;
  className?: string;
}

/**
 * Save-to-reading-list button for Q&A answers.
 *
 * - Authenticated: toggles saved state via POST/DELETE /api/reading-list.
 *   After saving shows an "Undo" option for 5 seconds.
 * - Unauthenticated: shows "Sign in to save" that triggers login.
 */
export function SaveToReadingListButton({ answerId, initialSaved = false, className }: Props) {
  const { ready, authenticated, user, getAccessToken, login } = useAuth();
  const [saved, setSaved] = useState(initialSaved);
  const [undoVisible, setUndoVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Check current save state on mount for authenticated users
  useEffect(() => {
    if (!authenticated || !user?.id || initialSaved) return;
    let cancelled = false;
    async function check() {
      const token = await getAccessToken();
      if (!token || cancelled) return;
      try {
        const res = await fetch('/api/reading-list', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const items: { type: string; refId: string }[] = data.items ?? [];
        setSaved(items.some((i) => i.type === 'qa_answer' && i.refId === answerId));
      } catch {
        // non-critical, silent
      }
    }
    check();
    return () => { cancelled = true; };
  }, [authenticated, user?.id, answerId, getAccessToken, initialSaved]);

  function clearUndoTimer() {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  }

  async function handleSave() {
    if (loading) return;
    setLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) return;
      const res = await fetch('/api/reading-list', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'qa_answer', refId: answerId }),
      });
      if (res.ok || res.status === 201) {
        setSaved(true);
        setUndoVisible(true);
        clearUndoTimer();
        undoTimerRef.current = setTimeout(() => setUndoVisible(false), 5000);
      }
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }

  async function handleRemove() {
    if (loading) return;
    clearUndoTimer();
    setUndoVisible(false);
    setLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) return;
      await fetch('/api/reading-list', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'qa_answer', refId: answerId }),
      });
      setSaved(false);
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }

  if (!ready) return null;

  if (!authenticated) {
    return (
      <button
        onClick={login}
        className={className ?? 'flex items-center gap-1 text-xs transition-colors mt-2'}
        style={{ color: 'var(--text-faint)' }}
        title="Sign in to save"
        aria-label="Sign in to save"
      >
        <BookmarkIcon filled={false} />
        Sign in to save
      </button>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <button
        onClick={saved ? handleRemove : handleSave}
        disabled={loading}
        title={saved ? 'Remove from reading list' : 'Save to reading list'}
        aria-label={saved ? 'Remove from reading list' : 'Save to reading list'}
        aria-pressed={saved}
        className={className ?? 'flex items-center gap-1 text-xs transition-colors mt-2'}
        style={{ color: saved ? 'var(--sage)' : 'var(--text-faint)' }}
      >
        <BookmarkIcon filled={saved} />
        {saved ? 'Saved' : 'Save'}
      </button>
      {undoVisible && (
        <button
          onClick={handleRemove}
          className="text-xs transition-colors mt-2"
          style={{ color: 'var(--text-faint)' }}
          aria-label="Undo save"
        >
          Undo
        </button>
      )}
    </span>
  );
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      className="w-3.5 h-3.5"
      fill={filled ? 'currentColor' : 'none'}
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z"
      />
    </svg>
  );
}
