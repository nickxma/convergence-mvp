'use client';

import { useState, useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { loadBookmarks, removeBookmark, type Bookmark } from '@/lib/bookmarks';

export default function BookmarksPage() {
  const { ready, authenticated, user } = usePrivy();
  const userId = user?.id ?? null;
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);

  useEffect(() => {
    if (userId) {
      setBookmarks(loadBookmarks(userId));
    }
  }, [userId]);

  if (!ready) return null;

  if (!authenticated) {
    return (
      <div
        className="flex items-center justify-center h-screen"
        style={{ background: 'var(--bg)' }}
      >
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Sign in to view your bookmarks.
        </p>
      </div>
    );
  }

  function handleRemove(answerId: string) {
    if (!userId) return;
    removeBookmark(userId, answerId);
    setBookmarks((prev) => prev.filter((b) => b.answerId !== answerId));
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <a
            href="/"
            className="text-sm"
            style={{ color: 'var(--sage)' }}
          >
            ← Back
          </a>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>
            Bookmarks
          </h1>
          {bookmarks.length > 0 && (
            <span
              className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: 'var(--bg-chip)', color: 'var(--text-muted)' }}
            >
              {bookmarks.length}
            </span>
          )}
        </div>

        {bookmarks.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            No bookmarks yet. Save answers you want to revisit.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {bookmarks.map((b) => (
              <div
                key={b.answerId}
                className="rounded-2xl px-4 py-4"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
              >
                <p className="text-sm font-medium mb-2" style={{ color: 'var(--sage-dark)' }}>
                  {b.question}
                </p>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-warm)' }}>
                  {b.excerpt}
                  {b.excerpt.length >= 200 ? '…' : ''}
                </p>
                <div className="flex items-center gap-4 mt-3">
                  <a
                    href={`/qa/${b.answerId}`}
                    className="text-xs"
                    style={{ color: 'var(--sage)' }}
                  >
                    View full answer →
                  </a>
                  <button
                    onClick={() => handleRemove(b.answerId)}
                    className="text-xs"
                    style={{ color: 'var(--text-faint)' }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
