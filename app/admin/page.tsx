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

interface AnalyticsData {
  queryCounts: { today: number; week: number };
  avgLatencyMs: number | null;
  avgTopScore: number | null;
  topQuestions: TopQuestion[];
  dailyCounts: DayCount[];
  scoreDistribution: ScoreBucket[];
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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchAnalytics = useCallback(async (wallet: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/qa-analytics', {
        headers: { Authorization: `Bearer ${wallet}` },
        cache: 'no-store',
      });
      if (res.status === 403) {
        setError('Access denied. This page requires admin credentials.');
        return;
      }
      if (!res.ok) {
        setError(`Failed to load analytics (${res.status}).`);
        return;
      }
      setData(await res.json());
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

      <main className="flex-1 px-5 py-8 max-w-3xl mx-auto w-full">
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
