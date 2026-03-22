'use client';

import { useState, useEffect } from 'react';

interface TopicCluster {
  clusterId: number;
  label: string;
  questionCount: number;
  examples: string[];
}

export default function TopicsPage() {
  const [topics, setTopics] = useState<TopicCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/topics')
      .then((res) => {
        if (!res.ok) throw new Error('server');
        return res.json() as Promise<{ topics: TopicCluster[] }>;
      })
      .then(({ topics }) => setTopics(topics))
      .catch(() => setError('Failed to load topics. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      {/* Header */}
      <header
        className="flex items-center justify-between px-5 py-3 border-b sticky top-0 z-10"
        style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
      >
        <div className="flex items-center gap-3">
          <a
            href="/"
            className="flex items-center gap-1.5 text-xs transition-colors"
            style={{ color: 'var(--sage)' }}
          >
            <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Convergence
          </a>
          <span className="text-xs" style={{ color: 'var(--border)' }}>·</span>
          <h1 className="text-sm font-semibold" style={{ color: 'var(--sage-dark)' }}>
            Topics
          </h1>
        </div>
      </header>

      {/* Content */}
      <main id="main-content" className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--sage-dark)' }}>
            Explore by theme
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-warm)' }}>
            Questions from the Q&amp;A archive, grouped into themes. Click a topic to explore all questions in that cluster.
          </p>
        </div>

        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="rounded-2xl p-5 animate-pulse"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', height: '160px' }}
              />
            ))}
          </div>
        )}

        {error && (
          <div
            className="rounded-xl px-4 py-3 text-sm"
            style={{ background: 'var(--error-bg)', border: '1px solid var(--error-border)', color: 'var(--error-text)' }}
          >
            {error}
          </div>
        )}

        {!loading && !error && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {topics.map((topic) => (
              <a
                key={topic.clusterId}
                href={`/topics/${topic.clusterId}`}
                className="block rounded-2xl p-5 transition-colors group"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
                onMouseOver={(e) => ((e.currentTarget as HTMLElement).style.borderColor = 'var(--sage-ring)')}
                onMouseOut={(e) => ((e.currentTarget as HTMLElement).style.borderColor = 'var(--border)')}
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <h3
                    className="text-sm font-semibold leading-snug group-hover:underline"
                    style={{ color: 'var(--sage-dark)' }}
                  >
                    {topic.label}
                  </h3>
                  <span
                    className="flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ background: 'var(--bg-chip)', color: 'var(--text-muted)' }}
                  >
                    {topic.questionCount}
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {topic.examples.map((q, idx) => (
                    <li key={idx} className="flex items-start gap-1.5">
                      <span className="mt-1.5 flex-shrink-0 w-1 h-1 rounded-full" style={{ background: 'var(--sage-pale)' }} />
                      <span className="text-xs leading-relaxed line-clamp-2" style={{ color: 'var(--text-warm)' }}>
                        {q}
                      </span>
                    </li>
                  ))}
                </ul>
              </a>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
