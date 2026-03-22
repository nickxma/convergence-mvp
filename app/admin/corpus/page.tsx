'use client';

import { useEffect, useState, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';

// ── Types ─────────────────────────────────────────────────────────────────────

interface GapTopic {
  topic: string;
  question_count: number;
  avg_max_score: number;
  sample_questions: string[];
}

interface GapsData {
  topics: GapTopic[];
  total_flagged: number;
  total_checked: number;
  threshold: number;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-xl px-5 py-4"
      style={{ background: '#f5f1e8', border: '1px solid #e0d8cc' }}
    >
      <p className="text-2xl font-semibold" style={{ color: '#3d4f38' }}>
        {value}
      </p>
      <p className="text-xs mt-1" style={{ color: '#9c9080' }}>
        {label}
      </p>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color = score < 0.5 ? '#b44' : score < 0.65 ? '#a07020' : '#7d8c6e';
  return (
    <span className="font-mono text-xs font-semibold" style={{ color }}>
      {score.toFixed(3)}
    </span>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CorpusGapsPage() {
  const { ready, authenticated, user } = usePrivy();
  const router = useRouter();
  const walletAddress = user?.wallet?.address ?? null;

  const [data, setData] = useState<GapsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchGaps = useCallback(async (wallet: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/corpus/gaps', {
        headers: { Authorization: `Bearer ${wallet}` },
        cache: 'no-store',
      });
      if (res.status === 401) {
        setError('Access denied. This page requires admin credentials.');
        return;
      }
      if (!res.ok) {
        setError(`Failed to load corpus gaps (${res.status}).`);
        return;
      }
      setData(await res.json());
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready && !authenticated) router.replace('/');
  }, [ready, authenticated, router]);

  useEffect(() => {
    if (walletAddress) fetchGaps(walletAddress);
  }, [walletAddress, fetchGaps]);

  const toggleExpanded = (topic: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(topic)) next.delete(topic);
      else next.add(topic);
      return next;
    });
  };

  if (!ready || !authenticated) {
    return (
      <div className="flex flex-1 items-center justify-center" style={{ background: '#faf8f3' }}>
        <p className="text-sm" style={{ color: '#9c9080' }}>Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full" style={{ background: '#faf8f3' }}>
      {/* Header */}
      <header
        className="flex items-center justify-between px-5 py-3 border-b flex-shrink-0"
        style={{ borderColor: '#e0d8cc', background: '#faf8f3' }}
      >
        <div className="flex items-center gap-3">
          <a href="/admin" className="flex items-center gap-1.5 text-xs" style={{ color: '#7d8c6e' }}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Admin
          </a>
          <span className="text-sm font-semibold tracking-tight" style={{ color: '#3d4f38' }}>
            Corpus Gap Analysis
          </span>
        </div>
        <button
          onClick={() => walletAddress && fetchGaps(walletAddress)}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-full border transition-colors disabled:opacity-50"
          style={{ borderColor: '#e0d8cc', color: '#7d8c6e' }}
        >
          {loading ? 'Analysing…' : 'Re-run analysis'}
        </button>
      </header>

      <main id="main-content" className="flex-1 px-5 py-8 max-w-3xl mx-auto w-full">
        {error ? (
          <div className="rounded-xl p-6 text-center" style={{ background: '#fdf0f0', border: '1px solid #f5c6c6' }}>
            <p className="text-sm font-medium" style={{ color: '#b44' }}>{error}</p>
          </div>
        ) : !data ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-sm" style={{ color: '#9c9080' }}>Analysing corpus coverage…</p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Summary stats */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: '#7d8c6e' }}>
                Overview
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <StatCard label="Questions analysed" value={String(data.total_checked)} />
                <StatCard label="Weak coverage" value={String(data.total_flagged)} />
                <StatCard
                  label="Coverage rate"
                  value={
                    data.total_checked > 0
                      ? `${Math.round(((data.total_checked - data.total_flagged) / data.total_checked) * 100)}%`
                      : '—'
                  }
                />
              </div>
              <p className="text-xs mt-2" style={{ color: '#9c9080' }}>
                Weak coverage = Pinecone top-1 match score below {data.threshold}. These questions likely
                produced low-quality or fabricated answers.
              </p>
            </section>

            {/* Gap topics table */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: '#7d8c6e' }}>
                Topics with thin retrieval coverage
              </h2>
              {data.topics.length === 0 ? (
                <div
                  className="rounded-xl p-8 text-center"
                  style={{ background: '#f0f5f0', border: '1px solid #c8dcc5' }}
                >
                  <p className="text-sm font-medium" style={{ color: '#5a7a50' }}>
                    No coverage gaps found — all top questions have strong retrieval scores.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #e0d8cc' }}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: '#f5f1e8', borderBottom: '1px solid #e0d8cc' }}>
                        <th className="text-left px-4 py-2.5 font-semibold" style={{ color: '#7d8c6e' }}>
                          Topic
                        </th>
                        <th className="text-right px-4 py-2.5 font-semibold" style={{ color: '#7d8c6e' }}>
                          Questions
                        </th>
                        <th className="text-right px-4 py-2.5 font-semibold" style={{ color: '#7d8c6e' }}>
                          Avg score
                        </th>
                        <th className="px-4 py-2.5 font-semibold" style={{ color: '#7d8c6e' }} />
                      </tr>
                    </thead>
                    <tbody>
                      {data.topics.map((t, i) => (
                        <>
                          <tr
                            key={t.topic}
                            style={{
                              background: i % 2 === 0 ? '#faf8f3' : '#f5f1e8',
                              borderBottom: expanded.has(t.topic) ? 'none' : '1px solid #ede8e0',
                              cursor: 'pointer',
                            }}
                            onClick={() => toggleExpanded(t.topic)}
                          >
                            <td className="px-4 py-3 font-medium" style={{ color: '#3d4f38' }}>
                              {t.topic}
                            </td>
                            <td className="px-4 py-3 text-right" style={{ color: '#5c5248' }}>
                              {t.question_count}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <ScoreBadge score={t.avg_max_score} />
                            </td>
                            <td className="px-4 py-3 text-right" style={{ color: '#9c9080' }}>
                              {expanded.has(t.topic) ? '▲' : '▼'}
                            </td>
                          </tr>
                          {expanded.has(t.topic) && (
                            <tr
                              key={`${t.topic}-expanded`}
                              style={{
                                background: i % 2 === 0 ? '#faf8f3' : '#f5f1e8',
                                borderBottom: '1px solid #ede8e0',
                              }}
                            >
                              <td colSpan={4} className="px-4 pb-3">
                                <p className="text-xs font-semibold mb-1.5" style={{ color: '#9c9080' }}>
                                  Sample questions:
                                </p>
                                <ul className="space-y-1">
                                  {t.sample_questions.map((q) => (
                                    <li key={q} className="text-xs" style={{ color: '#5c5248' }}>
                                      · {q}
                                    </li>
                                  ))}
                                </ul>
                              </td>
                            </tr>
                          )}
                        </>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Guidance */}
            {data.topics.length > 0 && (
              <section>
                <div
                  className="rounded-xl p-4"
                  style={{ background: '#f5f1e8', border: '1px solid #e0d8cc' }}
                >
                  <p className="text-xs font-semibold mb-1" style={{ color: '#3d4f38' }}>
                    How to use this
                  </p>
                  <p className="text-xs" style={{ color: '#7d8c6e' }}>
                    Topics are sorted by average retrieval score (worst first). Prioritise ingesting
                    teacher transcripts that cover the top topics — this will improve answer quality for
                    the most-viewed questions with the weakest corpus coverage.
                  </p>
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      <footer
        className="flex items-center justify-center px-5 py-2.5 border-t"
        style={{ borderColor: '#e0d8cc', background: '#faf8f3' }}
      >
        <span className="text-xs" style={{ color: '#b0a898' }}>
          Convergence · Corpus Gap Analysis
        </span>
      </footer>
    </div>
  );
}
