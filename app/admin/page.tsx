'use client';

import { useEffect, useState, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DayCount {
  date: string;
  count: number;
}

interface ScoreBucket {
  bucket: string;
  count: number;
}

interface TopQuestion {
  hash: string;
  count: number;
}

interface FeedbackSummary {
  total: number;
  up: number;
  down: number;
  pctPositive: number | null;
}

interface AnalyticsData {
  queryCounts: { today: number; week: number };
  avgLatencyMs: number | null;
  avgTopScore: number | null;
  topQuestions: TopQuestion[];
  dailyCounts: DayCount[];
  scoreDistribution: ScoreBucket[];
  feedback: FeedbackSummary;
}

interface CostByModel {
  model: string;
  totalUsd: number;
  promptTokens: number;
  completionTokens: number;
}

interface CostByDay {
  date: string;
  totalUsd: number;
}

interface CostsData {
  period: string;
  totalUsd: number;
  byModel: CostByModel[];
  byDay: CostByDay[];
}

interface LowQualityAnswer {
  hash: string;
  question: string;
  answerExcerpt: string;
  qualityScore: number;
  feedbackCount: number;
  positiveFeedbackCount: number;
  pineconeTop1Score: number | null;
  markedForRefresh: boolean;
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

function BarChart({ data }: { data: DayCount[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div>
      <div className="flex items-end gap-2 h-32">
        {data.map((d) => {
          const heightPct = (d.count / max) * 100;
          const label = d.date.slice(5); // MM-DD
          return (
            <div key={d.date} className="flex flex-col items-center flex-1 gap-1">
              <span className="text-xs" style={{ color: '#9c9080' }}>
                {d.count > 0 ? d.count : ''}
              </span>
              <div
                className="w-full rounded-t-md transition-all"
                style={{
                  height: `${Math.max(heightPct, 4)}%`,
                  background: heightPct > 0 ? '#7d8c6e' : '#e8e0d5',
                  minHeight: '4px',
                }}
              />
              <span className="text-xs" style={{ color: '#b0a898' }}>
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Histogram({ data }: { data: ScoreBucket[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="flex items-end gap-1 h-28">
      {data.map((d) => {
        const heightPct = (d.count / max) * 100;
        return (
          <div key={d.bucket} className="flex flex-col items-center flex-1 gap-1">
            <span className="text-xs" style={{ color: '#9c9080' }}>
              {d.count > 0 ? d.count : ''}
            </span>
            <div
              className="w-full rounded-t-sm"
              title={`${d.bucket}: ${d.count}`}
              style={{
                height: `${Math.max(heightPct, 4)}%`,
                background: heightPct > 0 ? '#b8ccb0' : '#e8e0d5',
                minHeight: '4px',
              }}
            />
            <span className="text-xs" style={{ color: '#b0a898', fontSize: '0.6rem' }}>
              {d.bucket.split('–')[0]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { ready, authenticated, user } = usePrivy();
  const router = useRouter();
  const walletAddress = user?.wallet?.address ?? null;

  const [data, setData] = useState<AnalyticsData | null>(null);
  const [costs, setCosts] = useState<CostsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [lowQualityAnswers, setLowQualityAnswers] = useState<LowQualityAnswer[] | null>(null);
  const [markingForRefresh, setMarkingForRefresh] = useState<Set<string>>(new Set());

  const fetchAnalytics = useCallback(async (wallet: string) => {
    setLoading(true);
    setError(null);
    try {
      const [analyticsRes, lowQualityRes, costsRes] = await Promise.all([
        fetch('/api/admin/qa-analytics', {
          headers: { Authorization: `Bearer ${wallet}` },
          cache: 'no-store',
        }),
        fetch('/api/admin/low-quality-answers', {
          headers: { Authorization: `Bearer ${wallet}` },
          cache: 'no-store',
        }),
        fetch('/api/admin/costs?period=7d', {
          headers: { Authorization: `Bearer ${wallet}` },
          cache: 'no-store',
        }),
      ]);

      const res = analyticsRes;
      if (res.status === 403) {
        setError('Access denied. This page requires admin credentials.');
        return;
      }
      if (!res.ok) {
        setError(`Failed to load analytics (${res.status}).`);
        return;
      }
      setData(await res.json());

      if (lowQualityRes.ok) {
        const lqData = await lowQualityRes.json();
        setLowQualityAnswers(lqData.items ?? []);
      }
      if (costsRes.ok) {
        setCosts(await costsRes.json());
      }
      setLastRefresh(new Date());
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Redirect unauthenticated users
  useEffect(() => {
    if (ready && !authenticated) {
      router.replace('/');
    }
  }, [ready, authenticated, router]);

  // Initial load
  useEffect(() => {
    if (walletAddress) {
      fetchAnalytics(walletAddress);
    }
  }, [walletAddress, fetchAnalytics]);

  // 30-second auto-refresh
  useEffect(() => {
    if (!walletAddress) return;
    const interval = setInterval(() => fetchAnalytics(walletAddress), 30_000);
    return () => clearInterval(interval);
  }, [walletAddress, fetchAnalytics]);

  const markForRefresh = useCallback(async (hash: string) => {
    if (!walletAddress || markingForRefresh.has(hash)) return;
    setMarkingForRefresh((prev) => new Set([...prev, hash]));
    try {
      const res = await fetch(`/api/admin/low-quality-answers/${hash}/mark-for-refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${walletAddress}` },
      });
      if (res.ok) {
        setLowQualityAnswers((prev) =>
          prev?.map((item) => item.hash === hash ? { ...item, markedForRefresh: true } : item) ?? null
        );
      }
    } finally {
      setMarkingForRefresh((prev) => { const next = new Set(prev); next.delete(hash); return next; });
    }
  }, [walletAddress, markingForRefresh]);

  // ── Render states ──────────────────────────────────────────────────────────

  if (!ready || !authenticated) {
    return (
      <div className="flex flex-1 items-center justify-center" style={{ background: '#faf8f3' }}>
        <p className="text-sm" style={{ color: '#9c9080' }}>
          Loading…
        </p>
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
          <a href="/" className="flex items-center gap-1.5 text-xs" style={{ color: '#7d8c6e' }}>
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18"
              />
            </svg>
            Back
          </a>
          <span className="text-sm font-semibold tracking-tight" style={{ color: '#3d4f38' }}>
            Admin Analytics
          </span>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-xs" style={{ color: '#b0a898' }}>
              Updated {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={() => walletAddress && fetchAnalytics(walletAddress)}
            disabled={loading}
            className="text-xs px-3 py-1.5 rounded-full border transition-colors disabled:opacity-50"
            style={{ borderColor: '#e0d8cc', color: '#7d8c6e' }}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      <main id="main-content" className="flex-1 px-5 py-8 max-w-3xl mx-auto w-full">
        {error ? (
          <div
            className="rounded-xl p-6 text-center"
            style={{ background: '#fdf0f0', border: '1px solid #f5c6c6' }}
          >
            <p className="text-sm font-medium" style={{ color: '#b44' }}>
              {error}
            </p>
          </div>
        ) : !data ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-sm" style={{ color: '#9c9080' }}>
              Loading analytics…
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Summary stats */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: '#7d8c6e' }}>
                Overview
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Queries today" value={String(data.queryCounts.today)} />
                <StatCard label="Queries this week" value={String(data.queryCounts.week)} />
                <StatCard
                  label="Avg latency"
                  value={data.avgLatencyMs != null ? `${data.avgLatencyMs}ms` : '—'}
                />
                <StatCard
                  label="Avg relevance"
                  value={data.avgTopScore != null ? data.avgTopScore.toFixed(3) : '—'}
                />
              </div>
            </section>

            {/* Daily query volume */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: '#7d8c6e' }}>
                Daily query volume (last 7 days)
              </h2>
              <div
                className="rounded-xl p-5"
                style={{ background: '#f5f1e8', border: '1px solid #e0d8cc' }}
              >
                {data.dailyCounts.every((d) => d.count === 0) ? (
                  <p className="text-xs text-center py-8" style={{ color: '#b0a898' }}>
                    No queries yet
                  </p>
                ) : (
                  <BarChart data={data.dailyCounts} />
                )}
              </div>
            </section>

            {/* Top questions */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: '#7d8c6e' }}>
                Top questions by frequency
              </h2>
              <div
                className="rounded-xl overflow-hidden"
                style={{ border: '1px solid #e0d8cc' }}
              >
                {data.topQuestions.length === 0 ? (
                  <p
                    className="text-xs text-center py-8"
                    style={{ color: '#b0a898', background: '#f5f1e8' }}
                  >
                    No data yet
                  </p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: '#f5f1e8', borderBottom: '1px solid #e0d8cc' }}>
                        <th
                          className="text-left px-4 py-2.5 font-semibold"
                          style={{ color: '#7d8c6e' }}
                        >
                          #
                        </th>
                        <th
                          className="text-left px-4 py-2.5 font-semibold"
                          style={{ color: '#7d8c6e' }}
                        >
                          Question hash (SHA-256)
                        </th>
                        <th
                          className="text-right px-4 py-2.5 font-semibold"
                          style={{ color: '#7d8c6e' }}
                        >
                          Count
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topQuestions.map((q, i) => (
                        <tr
                          key={q.hash}
                          style={{
                            background: i % 2 === 0 ? '#faf8f3' : '#f5f1e8',
                            borderBottom: '1px solid #ede8e0',
                          }}
                        >
                          <td className="px-4 py-2.5 font-mono" style={{ color: '#9c9080' }}>
                            {i + 1}
                          </td>
                          <td
                            className="px-4 py-2.5 font-mono"
                            style={{ color: '#5c5248' }}
                            title={q.hash}
                          >
                            {q.hash.slice(0, 12)}…{q.hash.slice(-6)}
                          </td>
                          <td
                            className="px-4 py-2.5 text-right font-semibold"
                            style={{ color: '#3d4f38' }}
                          >
                            {q.count}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>

            {/* Feedback summary */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: '#7d8c6e' }}>
                Feedback summary
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Total ratings" value={String(data.feedback.total)} />
                <StatCard
                  label="Positive"
                  value={data.feedback.pctPositive != null ? `${data.feedback.pctPositive}%` : '—'}
                />
                <StatCard label="Thumbs up" value={String(data.feedback.up)} />
                <StatCard label="Thumbs down" value={String(data.feedback.down)} />
              </div>
            </section>

            {/* OpenAI costs */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: '#7d8c6e' }}>
                OpenAI costs (last 7 days)
              </h2>
              {costs == null ? (
                <p className="text-xs" style={{ color: '#b0a898' }}>Loading…</p>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <StatCard label="Total spend" value={`$${costs.totalUsd.toFixed(4)}`} />
                    {costs.byModel.map((m) => (
                      <StatCard
                        key={m.model}
                        label={m.model}
                        value={`$${m.totalUsd.toFixed(4)}`}
                      />
                    ))}
                  </div>
                  {costs.byModel.length > 0 && (
                    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #e0d8cc' }}>
                      <table className="w-full text-xs">
                        <thead>
                          <tr style={{ background: '#f5f1e8', borderBottom: '1px solid #e0d8cc' }}>
                            <th className="text-left px-4 py-2.5 font-semibold" style={{ color: '#7d8c6e' }}>Model</th>
                            <th className="text-right px-4 py-2.5 font-semibold" style={{ color: '#7d8c6e' }}>Prompt tokens</th>
                            <th className="text-right px-4 py-2.5 font-semibold" style={{ color: '#7d8c6e' }}>Completion tokens</th>
                            <th className="text-right px-4 py-2.5 font-semibold" style={{ color: '#7d8c6e' }}>Cost (USD)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {costs.byModel.map((m, i) => (
                            <tr
                              key={m.model}
                              style={{
                                background: i % 2 === 0 ? '#faf8f3' : '#f5f1e8',
                                borderBottom: '1px solid #ede8e0',
                              }}
                            >
                              <td className="px-4 py-2.5 font-mono" style={{ color: '#5c5248' }}>{m.model}</td>
                              <td className="px-4 py-2.5 text-right" style={{ color: '#5c5248' }}>{m.promptTokens.toLocaleString()}</td>
                              <td className="px-4 py-2.5 text-right" style={{ color: '#5c5248' }}>{m.completionTokens.toLocaleString()}</td>
                              <td className="px-4 py-2.5 text-right font-semibold" style={{ color: '#3d4f38' }}>${m.totalUsd.toFixed(4)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Answer quality histogram */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: '#7d8c6e' }}>
                Answer quality — relevance score distribution
              </h2>
              <div
                className="rounded-xl p-5"
                style={{ background: '#f5f1e8', border: '1px solid #e0d8cc' }}
              >
                {data.scoreDistribution.every((b) => b.count === 0) ? (
                  <p className="text-xs text-center py-8" style={{ color: '#b0a898' }}>
                    No data yet
                  </p>
                ) : (
                  <>
                    <Histogram data={data.scoreDistribution} />
                    <p className="text-xs mt-2 text-center" style={{ color: '#b0a898' }}>
                      Pinecone relevance score (0 = low, 1 = high)
                    </p>
                  </>
                )}
              </div>
            </section>

            {/* Low quality answers */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: '#7d8c6e' }}>
                Low quality answers
                {lowQualityAnswers != null && (
                  <span
                    className="ml-2 px-1.5 py-0.5 rounded-full text-xs font-semibold"
                    style={{
                      background: lowQualityAnswers.length > 0 ? '#fdf0f0' : '#f0f5f0',
                      color: lowQualityAnswers.length > 0 ? '#b44' : '#7d8c6e',
                    }}
                  >
                    {lowQualityAnswers.length}
                  </span>
                )}
              </h2>
              <p className="text-xs mb-3" style={{ color: '#9c9080' }}>
                Answers with quality score &lt; 0.4 and at least 3 feedback votes.
                Score = (Pinecone relevance × 0.6) + (positive feedback rate × 0.4).
              </p>
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #e0d8cc' }}>
                {lowQualityAnswers == null ? (
                  <p className="text-xs text-center py-8" style={{ color: '#b0a898', background: '#f5f1e8' }}>
                    Loading…
                  </p>
                ) : lowQualityAnswers.length === 0 ? (
                  <p className="text-xs text-center py-8" style={{ color: '#b0a898', background: '#f5f1e8' }}>
                    No flagged answers
                  </p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: '#f5f1e8', borderBottom: '1px solid #e0d8cc' }}>
                        <th className="text-left px-4 py-2.5 font-semibold" style={{ color: '#7d8c6e' }}>Question</th>
                        <th className="text-right px-4 py-2.5 font-semibold" style={{ color: '#7d8c6e' }}>Score</th>
                        <th className="text-right px-4 py-2.5 font-semibold" style={{ color: '#7d8c6e' }}>Feedback</th>
                        <th className="text-right px-4 py-2.5 font-semibold" style={{ color: '#7d8c6e' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lowQualityAnswers.map((item, i) => (
                        <tr
                          key={item.hash}
                          style={{
                            background: i % 2 === 0 ? '#faf8f3' : '#f5f1e8',
                            borderBottom: '1px solid #ede8e0',
                          }}
                        >
                          <td className="px-4 py-3" style={{ color: '#5c5248', maxWidth: '280px' }}>
                            <p className="font-medium truncate" title={item.question}>{item.question}</p>
                            <p className="mt-0.5 truncate" style={{ color: '#9c9080' }} title={item.answerExcerpt}>
                              {item.answerExcerpt.slice(0, 120)}…
                            </p>
                          </td>
                          <td className="px-4 py-3 text-right font-mono" style={{ color: '#b44' }}>
                            {item.qualityScore.toFixed(3)}
                          </td>
                          <td className="px-4 py-3 text-right" style={{ color: '#5c5248' }}>
                            {item.positiveFeedbackCount}↑ / {item.feedbackCount - item.positiveFeedbackCount}↓
                          </td>
                          <td className="px-4 py-3 text-right">
                            {item.markedForRefresh ? (
                              <span className="text-xs px-2 py-1 rounded-full" style={{ background: '#e8f0e5', color: '#5a7a50' }}>
                                Queued
                              </span>
                            ) : (
                              <button
                                onClick={() => markForRefresh(item.hash)}
                                disabled={markingForRefresh.has(item.hash)}
                                className="text-xs px-2 py-1 rounded-full border transition-colors disabled:opacity-50"
                                style={{ borderColor: '#e0d8cc', color: '#7d8c6e' }}
                              >
                                {markingForRefresh.has(item.hash) ? 'Marking…' : 'Mark for corpus refresh'}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          </div>
        )}
      </main>

      <footer
        className="flex items-center justify-center px-5 py-2.5 border-t"
        style={{ borderColor: '#e0d8cc', background: '#faf8f3' }}
      >
        <span className="text-xs" style={{ color: '#b0a898' }}>
          Convergence · Admin · Auto-refreshes every 30s
        </span>
      </footer>
    </div>
  );
}
