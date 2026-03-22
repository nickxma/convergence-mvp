'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';

interface ClusterQuestion {
  questionHash: string;
  questionText: string;
  answerExcerpt: string | null;
}

interface QuestionsResponse {
  questions: ClusterQuestion[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

interface TopicMeta {
  label: string;
  questionCount: number;
}

export default function TopicDetailPage() {
  const params = useParams<{ clusterId: string }>();
  const router = useRouter();
  const clusterId = params.clusterId;

  const [meta, setMeta] = useState<TopicMeta | null>(null);
  const [questions, setQuestions] = useState<ClusterQuestion[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch topic meta from the cluster listing
  useEffect(() => {
    fetch('/api/topics')
      .then((res) => res.json() as Promise<{ topics: Array<{ clusterId: number; label: string; questionCount: number }> }>)
      .then(({ topics }) => {
        const found = topics.find((t) => String(t.clusterId) === clusterId);
        if (found) setMeta({ label: found.label, questionCount: found.questionCount });
      })
      .catch(() => {/* non-fatal, meta is cosmetic */});
  }, [clusterId]);

  const fetchPage = useCallback(
    (p: number, append: boolean) => {
      if (!append) setLoading(true);
      else setLoadingMore(true);

      fetch(`/api/topics/${clusterId}/questions?page=${p}`)
        .then((res) => {
          if (!res.ok) throw new Error('server');
          return res.json() as Promise<QuestionsResponse>;
        })
        .then((data) => {
          setQuestions((prev) => (append ? [...prev, ...data.questions] : data.questions));
          setPage(data.page);
          setTotal(data.total);
          setHasMore(data.hasMore);
        })
        .catch(() => setError('Failed to load questions. Please try again.'))
        .finally(() => {
          setLoading(false);
          setLoadingMore(false);
        });
    },
    [clusterId],
  );

  useEffect(() => {
    fetchPage(1, false);
  }, [fetchPage]);

  function handleQuestionClick(questionText: string) {
    router.push(`/?q=${encodeURIComponent(questionText)}`);
  }

  function handleLoadMore() {
    fetchPage(page + 1, true);
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      {/* Header */}
      <header
        className="flex items-center justify-between px-5 py-3 border-b sticky top-0 z-10"
        style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <a
            href="/topics"
            className="flex items-center gap-1.5 text-xs flex-shrink-0 transition-colors"
            style={{ color: 'var(--sage)' }}
          >
            <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Topics
          </a>
          {meta && (
            <>
              <span className="text-xs flex-shrink-0" style={{ color: 'var(--border)' }}>·</span>
              <h1 className="text-sm font-semibold truncate" style={{ color: 'var(--sage-dark)' }}>
                {meta.label}
              </h1>
            </>
          )}
        </div>
        {meta && (
          <span
            className="flex-shrink-0 text-xs px-2 py-0.5 rounded-full"
            style={{ background: 'var(--bg-chip)', color: 'var(--text-muted)' }}
          >
            {total || meta.questionCount} questions
          </span>
        )}
      </header>

      {/* Content */}
      <main id="main-content" className="max-w-3xl mx-auto px-4 py-8">
        {meta && (
          <div className="mb-6">
            <h2 className="text-xl font-semibold mb-1" style={{ color: 'var(--sage-dark)' }}>
              {meta.label}
            </h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Click any question to ask it in the Q&amp;A interface.
            </p>
          </div>
        )}

        {loading && (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="rounded-2xl p-4 animate-pulse"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', height: '90px' }}
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

        {!loading && !error && questions.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            No questions found in this topic cluster.
          </p>
        )}

        {!loading && !error && questions.length > 0 && (
          <>
            <div className="flex flex-col gap-3">
              {questions.map((q) => (
                <button
                  key={q.questionHash}
                  onClick={() => handleQuestionClick(q.questionText)}
                  className="text-left w-full rounded-2xl p-4 transition-colors group"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
                  onMouseOver={(e) => ((e.currentTarget as HTMLElement).style.borderColor = 'var(--sage-ring)')}
                  onMouseOut={(e) => ((e.currentTarget as HTMLElement).style.borderColor = 'var(--border)')}
                >
                  <p className="text-sm font-medium mb-1.5 group-hover:underline" style={{ color: 'var(--sage-dark)' }}>
                    {q.questionText}
                  </p>
                  {q.answerExcerpt && (
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-warm)' }}>
                      {q.answerExcerpt}
                    </p>
                  )}
                  <span
                    className="mt-2 inline-flex items-center gap-1 text-xs"
                    style={{ color: 'var(--sage)' }}
                  >
                    Ask this question
                    <svg aria-hidden="true" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                    </svg>
                  </span>
                </button>
              ))}
            </div>

            {hasMore && (
              <div className="mt-6 flex justify-center">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="text-sm px-5 py-2 rounded-full transition-colors"
                  style={{
                    border: '1px solid var(--border)',
                    color: 'var(--sage)',
                    background: 'var(--bg)',
                    opacity: loadingMore ? 0.6 : 1,
                  }}
                >
                  {loadingMore ? 'Loading…' : `Load more (${total - questions.length} remaining)`}
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
