'use client';

import { Fragment, useEffect, useState, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';

// ── Types ─────────────────────────────────────────────────────────────────────

type Days = 7 | 30 | 90;
type Granularity = 'daily' | 'weekly';

interface Kpi {
  queriesToday: number;
  queries7d: number;
  queries30d: number;
  cacheHitPct: number | null;
  avgLatencyMs: number | null;
  thumbsUpPct: number | null;
  errorPct: number | null;
}

interface DayCount {
  date: string;
  count: number;
}

interface TopQuery {
  hash: string;
  question: string | null;
  count: number;
  avgLatencyMs: number | null;
  feedbackCount: number;
  thumbsUpPct: number | null;
}

interface LatencyPercentiles {
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

interface RecentError {
  hash: string;
  question: string | null;
  maxScore: number;
  askedAt: string;
  reason: string;
}

interface StatsData {
  kpi: Kpi;
  latencyPercentiles: LatencyPercentiles;
  dailyCounts: DayCount[];
  topQueries: TopQuery[];
  recentErrors: RecentError[];
}

interface AbVariant {
  id: string;
  name: string;
  isActive: boolean;
  trafficPct: number;
  queryCount: number;
  ratedCount: number;
  avgRating: number | null;
  thumbsUpPct: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  isSignificant: boolean;
}

interface QueryAnswer {
  id: string;
  question: string;
  answer: string;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMs(ms: number | null): string {
  if (ms == null) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function fmtPct(pct: number | null): string {
  if (pct == null) return '—';
  return `${pct}%`;
}

function exportCsv(rows: TopQuery[]): void {
  const header = 'Question,Count,Avg Latency (ms),Feedback,Thumbs-up %';
  const lines = rows.map((r) => {
    const q = (r.question ?? r.hash).replace(/"/g, '""');
    return `"${q}",${r.count},${r.avgLatencyMs ?? ''},${r.feedbackCount},${r.thumbsUpPct ?? ''}`;
  });
  const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `top-queries-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function rollupWeekly(daily: DayCount[]): DayCount[] {
  const weeks: DayCount[] = [];
  for (let i = 0; i < daily.length; i += 7) {
    const slice = daily.slice(i, i + 7);
    const total = slice.reduce((s, d) => s + d.count, 0);
    weeks.push({ date: slice[0].date, count: total });
  }
  return weeks;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className="rounded-xl px-5 py-4"
      style={{ background: '#f5f1e8', border: '1px solid #e0d8cc' }}
    >
      <p
        className="text-2xl font-semibold tabular-nums"
        style={{ color: accent ? '#b44' : '#3d4f38' }}
      >
        {value}
      </p>
      <p className="text-xs mt-0.5" style={{ color: '#9c9080' }}>
        {label}
      </p>
      {sub && (
        <p className="text-xs mt-1" style={{ color: '#b0a898' }}>
          {sub}
        </p>
      )}
    </div>
  );
}

function DateRangePicker({
  value,
  onChange,
}: {
  value: Days;
  onChange: (d: Days) => void;
}) {
  return (
    <div
      className="inline-flex rounded-full overflow-hidden border"
      style={{ borderColor: '#e0d8cc' }}
    >
      {([7, 30, 90] as Days[]).map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          className="text-xs px-3 py-1.5 transition-colors"
          style={{
            background: value === d ? '#7d8c6e' : '#f5f1e8',
            color: value === d ? '#fff' : '#7d8c6e',
          }}
        >
          {d}d
        </button>
      ))}
    </div>
  );
}

function GranularityToggle({
  value,
  onChange,
}: {
  value: Granularity;
  onChange: (g: Granularity) => void;
}) {
  return (
    <div
      className="inline-flex rounded-full overflow-hidden border"
      style={{ borderColor: '#e0d8cc' }}
    >
      {(['daily', 'weekly'] as Granularity[]).map((g) => (
        <button
          key={g}
          onClick={() => onChange(g)}
          className="text-xs px-3 py-1.5 transition-colors capitalize"
          style={{
            background: value === g ? '#5c5248' : '#f5f1e8',
            color: value === g ? '#fff' : '#5c5248',
          }}
        >
          {g}
        </button>
      ))}
    </div>
  );
}

function VolumeChart({ data, granularity }: { data: DayCount[]; granularity: Granularity }) {
  const chartData = granularity === 'weekly' ? rollupWeekly(data) : data;
  const max = Math.max(...chartData.map((d) => d.count), 1);
  const showLabel = chartData.length <= 31;

  return (
    <div className="flex items-end gap-1" style={{ height: '120px' }}>
      {chartData.map((d) => {
        const heightPct = (d.count / max) * 100;
        const label = granularity === 'weekly'
          ? d.date.slice(5) + '…'
          : d.date.slice(5); // MM-DD
        return (
          <div
            key={d.date}
            className="flex flex-col items-center flex-1 gap-0.5"
            title={`${d.date}: ${d.count} queries`}
          >
            <span className="text-xs" style={{ color: '#9c9080', fontSize: '0.6rem' }}>
              {d.count > 0 ? d.count : ''}
            </span>
            <div
              className="w-full rounded-t-sm transition-all"
              style={{
                height: `${Math.max(heightPct, 4)}%`,
                background: heightPct > 0 ? '#7d8c6e' : '#e8e0d5',
                minHeight: '3px',
              }}
            />
            {showLabel && (
              <span style={{ color: '#b0a898', fontSize: '0.55rem' }}>
                {label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function LatencyBar({
  label,
  value,
  max,
}: {
  label: string;
  value: number | null;
  max: number;
}) {
  const pct = value != null && max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span
        className="text-xs font-mono flex-shrink-0 text-right"
        style={{ color: '#5c5248', width: '32px' }}
      >
        {label}
      </span>
      <div
        className="flex-1 rounded-full overflow-hidden"
        style={{ height: '10px', background: '#e8e0d5' }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${Math.max(pct, 2)}%`,
            background: label === 'p99' ? '#a07050' : label === 'p95' ? '#b8ccb0' : '#7d8c6e',
          }}
        />
      </div>
      <span
        className="text-xs font-mono flex-shrink-0 text-right tabular-nums"
        style={{ color: '#9c9080', width: '48px' }}
      >
        {fmtMs(value)}
      </span>
    </div>
  );
}

function CacheHitBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span style={{ color: '#b0a898' }}>—</span>;
  const color = pct >= 50 ? '#7d8c6e' : pct >= 25 ? '#a07020' : '#9c9080';
  return (
    <span className="text-xs font-mono" style={{ color }}>
      {pct}% cache
    </span>
  );
}

function ExpandedAnswers({
  hash,
  wallet,
}: {
  hash: string;
  wallet: string;
}) {
  const [answers, setAnswers] = useState<QueryAnswer[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/qa-answers?hash=${encodeURIComponent(hash)}`, {
      headers: { Authorization: `Bearer ${wallet}` },
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setAnswers(d?.answers ?? []))
      .catch(() => setAnswers([]))
      .finally(() => setLoading(false));
  }, [hash, wallet]);

  if (loading) {
    return (
      <div className="px-4 py-3" style={{ background: '#faf8f3' }}>
        <p className="text-xs" style={{ color: '#b0a898' }}>
          Loading answers…
        </p>
      </div>
    );
  }

  if (!answers || answers.length === 0) {
    return (
      <div className="px-4 py-3" style={{ background: '#faf8f3' }}>
        <p className="text-xs" style={{ color: '#b0a898' }}>
          No cached answers found for this question.
        </p>
      </div>
    );
  }

  return (
    <div
      className="px-4 py-3 space-y-3"
      style={{ background: '#faf8f3', borderTop: '1px solid #ede8e0' }}
    >
      {answers.map((a) => (
        <div key={a.id}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium" style={{ color: '#5c5248' }}>
              {a.question}
            </span>
            <span className="text-xs font-mono ml-3 flex-shrink-0" style={{ color: '#b0a898' }}>
              {new Date(a.created_at).toLocaleDateString()}
            </span>
          </div>
          <p
            className="text-xs line-clamp-3"
            style={{ color: '#7d8c6e', lineHeight: '1.5' }}
          >
            {a.answer}
          </p>
        </div>
      ))}
    </div>
  );
}

function TopQueriesTable({
  data,
  wallet,
}: {
  data: TopQuery[];
  wallet: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const toggle = (hash: string) => setExpanded((prev) => (prev === hash ? null : hash));

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: '#7d8c6e' }}
        >
          Top queries
        </h2>
        {data.length > 0 && (
          <button
            onClick={() => exportCsv(data)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors"
            style={{ borderColor: '#e0d8cc', color: '#7d8c6e' }}
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4-4 4m0 0-4-4m4 4V4" />
            </svg>
            Export CSV
          </button>
        )}
      </div>
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #e0d8cc' }}>
        {data.length === 0 ? (
          <p className="text-xs text-center py-8" style={{ color: '#b0a898', background: '#f5f1e8' }}>
            No query data for this period
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: '#f5f1e8', borderBottom: '1px solid #e0d8cc' }}>
                <th className="text-left px-4 py-2.5 font-semibold" style={{ color: '#7d8c6e' }}>
                  Query
                </th>
                <th className="text-right px-4 py-2.5 font-semibold" style={{ color: '#7d8c6e' }}>
                  Count
                </th>
                <th className="text-right px-4 py-2.5 font-semibold" style={{ color: '#7d8c6e' }}>
                  Avg latency
                </th>
                <th className="text-right px-4 py-2.5 font-semibold" style={{ color: '#7d8c6e' }}>
                  Rating
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((q, i) => (
                <Fragment key={q.hash}>
                  <tr
                    onClick={() => toggle(q.hash)}
                    className="cursor-pointer transition-colors"
                    style={{
                      background: expanded === q.hash
                        ? '#eee8dc'
                        : i % 2 === 0
                        ? '#faf8f3'
                        : '#f5f1e8',
                      borderBottom: expanded === q.hash ? 'none' : '1px solid #ede8e0',
                    }}
                  >
                    <td className="px-4 py-3" style={{ color: '#5c5248', maxWidth: '300px' }}>
                      <div className="flex items-start gap-2">
                        <svg
                          className="w-3 h-3 mt-0.5 flex-shrink-0 transition-transform"
                          style={{
                            color: '#9c9080',
                            transform: expanded === q.hash ? 'rotate(90deg)' : 'rotate(0deg)',
                          }}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
                        </svg>
                        <span className="line-clamp-2" title={q.question ?? q.hash}>
                          {q.question ?? (
                            <span style={{ color: '#b0a898', fontFamily: 'monospace' }}>
                              {q.hash.slice(0, 16)}…
                            </span>
                          )}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums" style={{ color: '#3d4f38' }}>
                      {q.count.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums" style={{ color: '#9c9080' }}>
                      {fmtMs(q.avgLatencyMs)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <CacheHitBadge pct={q.thumbsUpPct} />
                    </td>
                  </tr>
                  {expanded === q.hash && (
                    <tr>
                      <td colSpan={4} style={{ borderBottom: '1px solid #ede8e0', padding: 0 }}>
                        <ExpandedAnswers hash={q.hash} wallet={wallet} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function AbVariantCard({ v }: { v: AbVariant }) {
  const statusColor = v.isActive ? '#7d8c6e' : '#b0a898';
  const significantBg = v.isSignificant ? '#f0f7ee' : undefined;
  const significantBorder = v.isSignificant ? '#b8ccb0' : '#e0d8cc';

  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: significantBg ?? '#f5f1e8',
        border: `1px solid ${significantBorder}`,
      }}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <span className="text-sm font-semibold" style={{ color: '#3d4f38' }}>
            {v.name}
          </span>
          {v.isSignificant && (
            <span
              className="ml-2 text-xs px-2 py-0.5 rounded-full"
              style={{ background: '#7d8c6e', color: '#fff' }}
            >
              Significant
            </span>
          )}
        </div>
        <span className="text-xs" style={{ color: statusColor }}>
          {v.isActive ? `${v.trafficPct}% traffic` : 'Inactive'}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-base font-semibold tabular-nums" style={{ color: '#3d4f38' }}>
            {v.queryCount.toLocaleString()}
          </p>
          <p className="text-xs" style={{ color: '#9c9080' }}>Queries</p>
        </div>
        <div>
          <p className="text-base font-semibold tabular-nums" style={{ color: '#3d4f38' }}>
            {v.thumbsUpPct != null ? `${v.thumbsUpPct}%` : '—'}
          </p>
          <p className="text-xs" style={{ color: '#9c9080' }}>Thumbs-up</p>
        </div>
        <div>
          <p className="text-base font-semibold tabular-nums" style={{ color: '#3d4f38' }}>
            {fmtMs(v.p50LatencyMs)}
          </p>
          <p className="text-xs" style={{ color: '#9c9080' }}>p50 latency</p>
        </div>
      </div>
      {v.ratedCount > 0 && (
        <p className="text-xs mt-2" style={{ color: '#b0a898' }}>
          {v.ratedCount.toLocaleString()} rated ·{' '}
          {v.p95LatencyMs != null ? `p95 ${fmtMs(v.p95LatencyMs)}` : ''}
        </p>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function QAAnalyticsDashboard() {
  const { ready, authenticated, user } = usePrivy();
  const router = useRouter();
  const wallet = user?.wallet?.address ?? null;

  const [days, setDays] = useState<Days>(30);
  const [granularity, setGranularity] = useState<Granularity>('daily');
  const [stats, setStats] = useState<StatsData | null>(null);
  const [abVariants, setAbVariants] = useState<AbVariant[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(
    async (w: string, d: Days) => {
      setLoading(true);
      setError(null);
      try {
        const [statsRes, abRes] = await Promise.all([
          fetch(`/api/admin/qa-stats?days=${d}`, {
            headers: { Authorization: `Bearer ${w}` },
            cache: 'no-store',
          }),
          fetch('/api/admin/experiments/results', {
            headers: { Authorization: `Bearer ${w}` },
            cache: 'no-store',
          }),
        ]);

        if (statsRes.status === 403 || statsRes.status === 401) {
          setError('Access denied. This page requires admin credentials.');
          return;
        }
        if (!statsRes.ok) {
          setError(`Failed to load analytics (${statsRes.status}).`);
          return;
        }

        setStats(await statsRes.json());
        if (abRes.ok) {
          const abData = await abRes.json();
          setAbVariants(abData.results ?? []);
        }
      } catch {
        setError('Network error. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (ready && !authenticated) router.replace('/');
  }, [ready, authenticated, router]);

  useEffect(() => {
    if (wallet) fetchData(wallet, days);
  }, [wallet, days, fetchData]);

  // ── Render states ──────────────────────────────────────────────────────────

  if (!ready || !authenticated) {
    return (
      <div className="flex flex-1 items-center justify-center" style={{ background: '#faf8f3' }}>
        <p className="text-sm" style={{ color: '#9c9080' }}>Loading…</p>
      </div>
    );
  }

  const kpi = stats?.kpi;
  const perc = stats?.latencyPercentiles;
  const percMax = Math.max(perc?.p50 ?? 0, perc?.p95 ?? 0, perc?.p99 ?? 0, 1);

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
            Q&amp;A Analytics
          </span>
        </div>
        <div className="flex items-center gap-3">
          <DateRangePicker value={days} onChange={setDays} />
          {days >= 30 && (
            <GranularityToggle value={granularity} onChange={setGranularity} />
          )}
          <button
            onClick={() => wallet && fetchData(wallet, days)}
            disabled={loading}
            className="text-xs px-3 py-1.5 rounded-full border transition-colors disabled:opacity-50"
            style={{ borderColor: '#e0d8cc', color: '#7d8c6e' }}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </header>

      <main id="main-content" className="flex-1 px-5 py-8 max-w-4xl mx-auto w-full">
        {error ? (
          <div
            className="rounded-xl p-6 text-center"
            style={{ background: '#fdf0f0', border: '1px solid #f5c6c6' }}
          >
            <p className="text-sm font-medium" style={{ color: '#b44' }}>{error}</p>
          </div>
        ) : (
          <div className="space-y-10">
            {/* KPI row */}
            <section>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                <KpiCard
                  label="Queries today"
                  value={kpi ? kpi.queriesToday.toLocaleString() : '—'}
                />
                <KpiCard
                  label="Queries 7d"
                  value={kpi ? kpi.queries7d.toLocaleString() : '—'}
                />
                <KpiCard
                  label="Queries 30d"
                  value={kpi ? kpi.queries30d.toLocaleString() : '—'}
                />
                <KpiCard
                  label="Cache hit"
                  value={kpi ? fmtPct(kpi.cacheHitPct) : '—'}
                />
                <KpiCard
                  label="Avg latency"
                  value={kpi ? fmtMs(kpi.avgLatencyMs) : '—'}
                />
                <KpiCard
                  label="Thumbs-up"
                  value={kpi ? fmtPct(kpi.thumbsUpPct) : '—'}
                />
              </div>
              {kpi?.errorPct != null && kpi.errorPct > 0 && (
                <div
                  className="mt-3 rounded-lg px-4 py-2.5 flex items-center gap-2"
                  style={{ background: '#fdf0f0', border: '1px solid #f5c6c6' }}
                >
                  <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="#b44" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                  </svg>
                  <p className="text-xs" style={{ color: '#b44' }}>
                    <strong>{kpi.errorPct}%</strong> of queries in this period returned low-confidence results (top Pinecone score &lt; 30%)
                  </p>
                </div>
              )}
            </section>

            {/* Volume chart */}
            <section>
              <h2
                className="text-xs font-semibold uppercase tracking-wide mb-3"
                style={{ color: '#7d8c6e' }}
              >
                Query volume
              </h2>
              <div
                className="rounded-xl p-5"
                style={{ background: '#f5f1e8', border: '1px solid #e0d8cc' }}
              >
                {stats == null ? (
                  <p className="text-xs text-center py-8" style={{ color: '#b0a898' }}>
                    {loading ? 'Loading…' : 'No data'}
                  </p>
                ) : (
                  <VolumeChart data={stats.dailyCounts} granularity={granularity} />
                )}
              </div>
            </section>

            {/* Top queries table */}
            {stats != null && (
              <TopQueriesTable data={stats.topQueries} wallet={wallet ?? ''} />
            )}
            {stats == null && (
              <section>
                <h2
                  className="text-xs font-semibold uppercase tracking-wide mb-3"
                  style={{ color: '#7d8c6e' }}
                >
                  Top queries
                </h2>
                <div
                  className="rounded-xl p-5 text-center"
                  style={{ background: '#f5f1e8', border: '1px solid #e0d8cc' }}
                >
                  <p className="text-xs" style={{ color: '#b0a898' }}>
                    {loading ? 'Loading…' : 'No data'}
                  </p>
                </div>
              </section>
            )}

            {/* Latency histogram */}
            <section>
              <h2
                className="text-xs font-semibold uppercase tracking-wide mb-3"
                style={{ color: '#7d8c6e' }}
              >
                Latency percentiles
              </h2>
              <div
                className="rounded-xl p-5"
                style={{ background: '#f5f1e8', border: '1px solid #e0d8cc' }}
              >
                {perc == null ? (
                  <p className="text-xs text-center py-4" style={{ color: '#b0a898' }}>
                    {loading ? 'Loading…' : 'No latency data'}
                  </p>
                ) : (
                  <div className="space-y-3">
                    <LatencyBar label="p50" value={perc.p50} max={percMax} />
                    <LatencyBar label="p95" value={perc.p95} max={percMax} />
                    <LatencyBar label="p99" value={perc.p99} max={percMax} />
                  </div>
                )}
              </div>
            </section>

            {/* Recent errors */}
            <section>
              <div className="flex items-baseline justify-between mb-3">
                <h2
                  className="text-xs font-semibold uppercase tracking-wide"
                  style={{ color: '#7d8c6e' }}
                >
                  Recent low-confidence queries
                </h2>
                {stats?.recentErrors && stats.recentErrors.length > 0 && (
                  <span className="text-xs" style={{ color: '#b0a898' }}>
                    {stats.recentErrors.length} recent
                  </span>
                )}
              </div>
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #e0d8cc' }}>
                {stats == null || stats.recentErrors.length === 0 ? (
                  <p
                    className="text-xs text-center py-8"
                    style={{ color: '#b0a898', background: '#f5f1e8' }}
                  >
                    {loading ? 'Loading…' : 'No low-confidence queries in this period'}
                  </p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: '#f5f1e8', borderBottom: '1px solid #e0d8cc' }}>
                        <th className="text-left px-4 py-2.5 font-semibold" style={{ color: '#7d8c6e' }}>
                          Query
                        </th>
                        <th className="text-right px-4 py-2.5 font-semibold" style={{ color: '#7d8c6e' }}>
                          Reason
                        </th>
                        <th className="text-right px-4 py-2.5 font-semibold" style={{ color: '#7d8c6e' }}>
                          Date
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.recentErrors.map((e, i) => (
                        <tr
                          key={`${e.hash}-${i}`}
                          style={{
                            background: i % 2 === 0 ? '#faf8f3' : '#f5f1e8',
                            borderBottom: '1px solid #ede8e0',
                          }}
                        >
                          <td className="px-4 py-3" style={{ color: '#5c5248', maxWidth: '280px' }}>
                            <span className="line-clamp-2" title={e.question ?? e.hash}>
                              {e.question ?? (
                                <span style={{ fontFamily: 'monospace', color: '#b0a898' }}>
                                  {e.hash.slice(0, 16)}…
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right" style={{ color: '#b44' }}>
                            {e.reason}
                          </td>
                          <td className="px-4 py-3 text-right font-mono" style={{ color: '#9c9080' }}>
                            {new Date(e.askedAt).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>

            {/* A/B experiment results */}
            <section>
              <div className="flex items-baseline justify-between mb-3">
                <h2
                  className="text-xs font-semibold uppercase tracking-wide"
                  style={{ color: '#7d8c6e' }}
                >
                  Prompt A/B experiments
                </h2>
                {abVariants && abVariants.length > 0 && (
                  <a
                    href="/admin/qa"
                    className="text-xs"
                    style={{ color: '#7d8c6e' }}
                  >
                    Manage variants →
                  </a>
                )}
              </div>
              {abVariants == null ? (
                <div
                  className="rounded-xl p-5 text-center"
                  style={{ background: '#f5f1e8', border: '1px solid #e0d8cc' }}
                >
                  <p className="text-xs" style={{ color: '#b0a898' }}>
                    {loading ? 'Loading…' : 'No experiment data'}
                  </p>
                </div>
              ) : abVariants.length === 0 ? (
                <div
                  className="rounded-xl p-5 text-center"
                  style={{ background: '#f5f1e8', border: '1px solid #e0d8cc' }}
                >
                  <p className="text-xs" style={{ color: '#b0a898' }}>
                    No prompt variants configured.{' '}
                    <a href="/admin/qa" style={{ color: '#7d8c6e' }}>
                      Set up an experiment →
                    </a>
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {abVariants.map((v) => (
                    <AbVariantCard key={v.id} v={v} />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      <footer
        className="flex items-center justify-center px-5 py-2.5 border-t"
        style={{ borderColor: '#e0d8cc', background: '#faf8f3' }}
      >
        <span className="text-xs" style={{ color: '#b0a898' }}>
          Convergence · Admin · Q&amp;A Analytics
        </span>
      </footer>
    </div>
  );
}
