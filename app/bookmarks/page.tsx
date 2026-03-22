'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/use-auth';
import { SaveToReadingListButton } from '@/components/save-to-reading-list-button';

interface QAItem {
  id: string;
  type: 'qa_answer';
  refId: string;
  createdAt: string;
  question: string;
  excerpt: string;
  teachers: string[];
  url: string;
}

type ReadingListItem = QAItem | { id: string; type: 'essay'; refId: string; createdAt: string };

export default function BookmarksPage() {
  const { ready, authenticated, getAccessToken } = useAuth();
  const [items, setItems] = useState<ReadingListItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchItems = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/reading-list', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setItems(data.items ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (authenticated) fetchItems();
  }, [authenticated, fetchItems]);

  if (!ready) return null;

  if (!authenticated) {
    return (
      <div
        className="flex items-center justify-center h-screen"
        style={{ background: 'var(--bg)' }}
      >
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Sign in to view your reading list.
        </p>
      </div>
    );
  }

  const qaItems = items.filter((i): i is QAItem => i.type === 'qa_answer');

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <a href="/" className="text-sm" style={{ color: 'var(--sage)' }}>
            ← Back
          </a>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>
            Reading List
          </h1>
          {qaItems.length > 0 && (
            <span
              className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: 'var(--bg-chip)', color: 'var(--text-muted)' }}
            >
              {qaItems.length}
            </span>
          )}
        </div>

        {loading ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Loading…
          </p>
        ) : qaItems.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            No saved answers yet. Save answers you want to revisit.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {qaItems.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl px-4 py-4"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
              >
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--sage-dark)' }}>
                  {item.question}
                </p>
                {item.teachers.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {item.teachers.map((teacher) => (
                      <span
                        key={teacher}
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{ background: 'var(--bg-chip)', color: 'var(--text-muted)' }}
                      >
                        {teacher}
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-warm)' }}>
                  {item.excerpt}
                  {item.excerpt.length >= 100 ? '…' : ''}
                </p>
                <div className="flex items-center gap-4 mt-3">
                  <a href={item.url} className="text-xs" style={{ color: 'var(--sage)' }}>
                    View full answer →
                  </a>
                  <SaveToReadingListButton
                    answerId={item.refId}
                    initialSaved={true}
                    className="text-xs transition-colors"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
