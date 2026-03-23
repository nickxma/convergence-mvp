'use client';

import { useEffect, useState, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';

// ── Types ─────────────────────────────────────────────────────────────────────

type Days = 7 | 30 | 90;

interface ConceptItem {
  name: string;
  count: number;
}

interface TopConceptsData {
  concepts: ConceptItem[];
  days: number;
  total: number;
}

interface UnansweredQuery {
  query: string;
  confidence: number;
  askedAt: string;
}

interface UnansweredData {
  queries: UnansweredQuery[];
  days: number;
  threshold: number;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ConceptBar({ item, max }: { item: ConceptItem; max: number }) {
  const pct = max > 0 ? (item.count / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span
        className="text-xs text-right flex-shrink-0 truncate"
        style={{ color: '#5c5248', width: '140px' }}
        title={item.name}
      >
        {item.name}
      </span>
      <div className="flex-1 flex items-center gap-2">
        <div
          className="rounded-r-sm"
          style={{
            width: `${Math.max(pct, 2)}%`,
            height: '16px',
            background: pct > 50 ? '#7d8c6e' : '#b8ccb0',
            transition: 'width 0.3s ease',
          }}
        />
        <span className="text-xs flex-shrink-0" style={{ color: '#9c9080' }}>
          {item.count}
        </span>
      </div>
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
  const options: Days[] = [7, 30, 90];
  return (
    <div
      className="inline-flex rounded-full overflow-hidden border"
      style={{ borderColor: '#e0d8cc' }}
    >
      {options.map((d) => (
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

function ConfidenceBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct < 20 ? '#b44' : pct < 35 ? '#a07020' : '#7d8c6e';
  return (
    <span className="font-mono text-xs" style={{ color }}>
      {pct}%
    </span>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function QAAnalyticsPage() {
  const { ready, authenticated, user } = usePrivy();
  const router = useRouter();
  const walletAddress = user?.wallet?.address ?? null;

  const [days, setDays] = useState<Days>(30);
  const [topConcepts, setTopConcepts] = useState<TopConceptsData | null>(null);
  const [unanswered, setUnanswered] = useState<UnansweredData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(
    async (wallet: string, d: Days) => {
      setLoading(true);
      setError(null);
      try {
        const [conceptsRes, unansweredRes] = await Promise.all([
          fetch(`/api/analytics/qa/top-concepts?days=${d}`, {
            headers: { Authorization: `Bearer ${wallet}` },
            cache: 'no-store',
          }),
          fetch(`/api/analytics/qa/unanswered?days=${d}&limit=50`, {
            headers: { Authorization: `Bearer ${wallet}` },
            cache: 'no-store',
          }),
        ]);

        if (conceptsRes.status === 401 || unansweredRes.status === 401) {
          setError('Access denied. This page requires admin credentials.');
          return;
        }

        if (conceptsRes.ok) {
          setTopConcepts(await conceptsRes.json());
        }
        if (unansweredRes.ok) {
          setUnanswered(await unansweredRes.json());
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
    if (ready && !authenticated) {
      router.replace('/');
    }
  }, [ready, authenticated, router]);

  useEffect(() => {
    if (walletAddress) {
      fetchData(walletAddress, days);
    }
  }, [walletAddress, days, fetchData]);

  const handleDaysChange = useCallback(
    (d: Days) => {
      setDays(d);
      // fetchData is triggered by the days useEffect above
    },
    [],
  );

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

  const maxConceptCount = Math.max(
    ...(topConcepts?.concepts.map((c) => c.count) ?? [1]),
    1,
  );

  return (
    <div className="flex flex-col min-h-full" style={{ background: '#faf8f3' }}>
      {/* Header */}
      <header
        className="flex items-center justify-between px-5 py-3 border-b flex-shrink-0"
        style={{ borderColor: '#e0d8cc', background: '#faf8f3' }}
      >
        <div className="flex items-center gap-3">
          <a href="/admin" className="flex items-center gap-1.5 text-xs" style={{ color: '#7d8c6e' }}>
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Admin
          </a>
          <span className="text-sm font-semibold tracking-tight" style={{ color: '#3d4f38' }}>
            Q&amp;A Analytics
          </span>
        </div>
        <div className="flex items-center gap-3">
          <DateRangePicker value={days} onChange={handleDaysChange} />
          <button
            onClick={() => walletAddress && fetchData(walletAddress, days)}
            disabled={loading}
            className="text-xs px-3 py-1.5 rounded-full border transition-colors disabled:opacity-50"
            style={{ borderColor: '#e0d8cc', color: '#7d8c6e' }}
          >
            {loading ? 'Loading…' : 'Refresh'}
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
        ) : (
          <div className="space-y-10">
            {/* Top Concepts */}
            <section>
              <div className="flex items-baseline justify-between mb-3">
                <h2
                  className="text-xs font-semibold uppercase tracking-wide"
                  style={{ color: '#7d8c6e' }}
                >
                  Top concepts — knowledge base coverage
                </h2>
                {topConcepts != null && (
                  <span className="text-xs" style={{ color: '#b0a898' }}>
                    {topConcepts.concepts.length} concepts · {topConcepts.total.toLocaleString()} chunks
                  </span>
                )}
              </div>
              <div
                className="rounded-xl p-5"
                style={{ background: '#f5f1e8', border: '1px solid #e0d8cc' }}
              >
                {topConcepts == null ? (
                  <p className="text-xs text-center py-8" style={{ color: '#b0a898' }}>
                    {loading ? 'Loading…' : 'No data'}
                  </p>
                ) : topConcepts.concepts.length === 0 ? (
                  <p className="text-xs text-center py-8" style={{ color: '#b0a898' }}>
                    No concepts updated in the last {days} days
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {topConcepts.concepts.map((item) => (
                      <ConceptBar key={item.name} item={item} max={maxConceptCount} />
                    ))}
                  </div>
                )}
              </div>
              <p className="text-xs mt-2" style={{ color: '#b0a898' }}>
                Chunk count per concept in the knowledge base, filtered to concepts updated within the selected window.
              </p>
            </section>

            {/* Unanswered Queries */}
            <section>
              <div className="flex items-baseline justify-between mb-3">
                <h2
                  className="text-xs font-semibold uppercase tracking-wide"
                  style={{ color: '#7d8c6e' }}
                >
                  Unanswered queries
                </h2>
                {unanswered != null && (
                  <span className="text-xs" style={{ color: '#b0a898' }}>
                    {unanswered.queries.length} queries · confidence &lt; {Math.round(unanswered.threshold * 100)}%
                  </span>
                )}
              </div>
              <div
                className="rounded-xl overflow-hidden"
                style={{ border: '1px solid #e0d8cc' }}
              >
                {unanswered == null ? (
                  <p
                    className="text-xs text-center py-8"
                    style={{ color: '#b0a898', background: '#f5f1e8' }}
                  >
                    {loading ? 'Loading…' : 'No data'}
                  </p>
                ) : unanswered.queries.length === 0 ? (
                  <p
                    className="text-xs text-center py-8"
                    style={{ color: '#b0a898', background: '#f5f1e8' }}
                  >
                    No low-confidence queries in the last {days} days
                  </p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr
                        style={{ background: '#f5f1e8', borderBottom: '1px solid #e0d8cc' }}
                      >
                        <th
                          className="text-left px-4 py-2.5 font-semibold"
                          style={{ color: '#7d8c6e' }}
                        >
                          Query
                        </th>
                        <th
                          className="text-right px-4 py-2.5 font-semibold"
                          style={{ color: '#7d8c6e' }}
                        >
                          Confidence
                        </th>
                        <th
                          className="text-right px-4 py-2.5 font-semibold"
                          style={{ color: '#7d8c6e' }}
                        >
                          Date
                        </th>
                        <th
                          className="text-right px-4 py-2.5 font-semibold"
                          style={{ color: '#7d8c6e' }}
                        >
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {unanswered.queries.map((q, i) => (
                        <tr
                          key={`${q.askedAt}-${i}`}
                          style={{
                            background: i % 2 === 0 ? '#faf8f3' : '#f5f1e8',
                            borderBottom: '1px solid #ede8e0',
                          }}
                        >
                          <td
                            className="px-4 py-3"
                            style={{ color: '#5c5248', maxWidth: '320px' }}
                          >
                            <span className="line-clamp-2" title={q.query}>
                              {q.query}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <ConfidenceBadge score={q.confidence} />
                          </td>
                          <td
                            className="px-4 py-3 text-right font-mono"
                            style={{ color: '#9c9080' }}
                          >
                            {new Date(q.askedAt).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              disabled
                              className="text-xs px-2 py-1 rounded-full border opacity-40"
                              style={{ borderColor: '#e0d8cc', color: '#7d8c6e' }}
                              title="Corpus improvement coming soon"
                            >
                              Improve
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <p className="text-xs mt-2" style={{ color: '#b0a898' }}>
                Non-cached queries where Pinecone top-1 relevance score was below{' '}
                {unanswered ? Math.round(unanswered.threshold * 100) : 40}% — indicating the knowledge base
                may lack coverage for these topics.
              </p>
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
