'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface LeaderboardItem {
  rank: number;
  question: string;
  answerExcerpt: string;
  askCount: number;
}

export default function LeaderboardPage() {
  const [items, setItems] = useState<LeaderboardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/leaderboard')
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load leaderboard');
        return r.json();
      })
      .then((d) => setItems(d.items ?? []))
      .catch(() => setError('Could not load leaderboard. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen" style={{ background: '#faf8f3' }}>
      {/* Header */}
      <header
        className="flex items-center justify-between px-5 py-3 border-b"
        style={{ borderColor: '#e0d8cc', background: '#faf8f3' }}
      >
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center justify-center p-1.5 rounded-lg transition-colors"
            style={{ color: '#7d8c6e' }}
            aria-label="Back to home"
          >
            <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
          </Link>
          <span className="text-sm font-semibold tracking-tight" style={{ color: '#3d4f38' }}>
            Convergence
          </span>
          <span
            className="text-xs px-1.5 py-0.5 rounded-full"
            style={{ background: '#e8e0d5', color: '#7d8c6e' }}
          >
            beta
          </span>
        </div>
        <span className="text-xs font-medium" style={{ color: '#7d8c6e' }}>
          Top Questions
        </span>
      </header>

      {/* Content */}
      <main id="main-content" className="max-w-2xl mx-auto px-5 py-10">
        <div className="mb-8">
          <h1 className="text-xl font-semibold mb-1" style={{ color: '#3d4f38' }}>
            Most-Asked Questions
          </h1>
          <p className="text-sm" style={{ color: '#9c9080' }}>
            What the Convergence community is exploring most.
          </p>
        </div>

        {loading && (
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-20 rounded-xl animate-pulse"
                style={{ background: '#f0ebe2' }}
              />
            ))}
          </div>
        )}

        {error && (
          <p className="text-sm text-center py-12" style={{ color: '#9c9080' }}>
            {error}
          </p>
        )}

        {!loading && !error && items.length === 0 && (
          <p className="text-sm text-center py-12" style={{ color: '#9c9080' }}>
            No questions yet — be the first to ask.
          </p>
        )}

        {!loading && !error && items.length > 0 && (
          <ol className="space-y-2">
            {items.map((item) => (
              <li
                key={item.rank}
                className="flex items-start gap-4 px-4 py-4 rounded-xl"
                style={{ background: '#fff', border: '1px solid #e8e0d5' }}
              >
                {/* Rank */}
                <span
                  className="flex-shrink-0 w-6 text-right text-xs font-semibold tabular-nums pt-0.5"
                  style={{ color: item.rank <= 3 ? '#7d8c6e' : '#b0a898' }}
                >
                  {item.rank}
                </span>

                {/* Question + excerpt */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-snug mb-1" style={{ color: '#3d4f38' }}>
                    {item.question}
                  </p>
                  <p className="text-xs leading-relaxed line-clamp-2" style={{ color: '#9c9080' }}>
                    {item.answerExcerpt}
                  </p>
                </div>

                {/* Ask count + button */}
                <div className="flex-shrink-0 flex flex-col items-end gap-2">
                  <span
                    className="text-xs px-2 py-0.5 rounded-full font-medium tabular-nums"
                    style={{ background: '#f0ebe2', color: '#7d8c6e' }}
                  >
                    {item.askCount.toLocaleString()}×
                  </span>
                  <Link
                    href={`/?q=${encodeURIComponent(item.question)}`}
                    className="text-xs px-3 py-1.5 rounded-full transition-colors font-medium"
                    style={{ background: '#7d8c6e', color: '#fff' }}
                  >
                    Ask this
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        )}
      </main>
    </div>
  );
}
