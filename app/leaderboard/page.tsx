'use client';

/**
 * /leaderboard — OpenClaw global winner leaderboard.
 *
 * Toggles between All Time / This Week / This Month.
 * Fetches from GET /api/leaderboard?period=&userId=
 * Logged-in user's row is highlighted and pinned near the bottom if outside top 50.
 */

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeaderboardEntry {
  rank: number;
  userId: string;
  playerDisplay: string;
  prizeCount: number;
  lastWinDate: string;
  totalSessions: number;
}

type Period = 'alltime' | 'weekly' | 'monthly';

const PERIOD_LABELS: Record<Period, string> = {
  alltime: 'All Time',
  weekly: 'This Week',
  monthly: 'This Month',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Deterministic hue from a string — used for avatar color. */
function hashHue(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(h) % 360;
}

function Avatar({ userId, display }: { userId: string; display: string }) {
  const hue = hashHue(userId);
  const initials = display.slice(0, 2).toUpperCase();
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 32,
        borderRadius: '50%',
        background: `hsl(${hue}, 55%, 35%)`,
        color: `hsl(${hue}, 80%, 90%)`,
        fontSize: 11,
        fontWeight: 700,
        flexShrink: 0,
        letterSpacing: 0.5,
      }}
    >
      {initials}
    </span>
  );
}

function TrophyIcon({ rank }: { rank: number }) {
  if (rank === 1) return <span aria-label="Gold trophy">🥇</span>;
  if (rank === 2) return <span aria-label="Silver trophy">🥈</span>;
  if (rank === 3) return <span aria-label="Bronze trophy">🥉</span>;
  return (
    <span
      style={{
        display: 'inline-block',
        width: 22,
        textAlign: 'right',
        fontVariantNumeric: 'tabular-nums',
        fontSize: 13,
        color: '#64748b',
      }}
    >
      {rank}
    </span>
  );
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return '—';
  }
}

// ─── Row component ────────────────────────────────────────────────────────────

function PlayerRow({
  entry,
  isViewer,
  isPinned,
}: {
  entry: LeaderboardEntry;
  isViewer: boolean;
  isPinned: boolean;
}) {
  const highlight = isViewer
    ? { background: '#1e3a5f', border: '1px solid #3b82f6' }
    : { background: '#1e293b', border: '1px solid #334155' };

  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        borderRadius: 10,
        ...highlight,
        ...(isPinned ? { marginTop: 8, borderStyle: 'dashed' } : {}),
      }}
    >
      {/* Rank / trophy */}
      <span style={{ width: 28, flexShrink: 0, textAlign: 'center' }}>
        <TrophyIcon rank={entry.rank} />
      </span>

      {/* Avatar */}
      <Avatar userId={entry.userId} display={entry.playerDisplay} />

      {/* Name */}
      <span
        style={{
          flex: 1,
          fontSize: 14,
          fontWeight: 500,
          color: isViewer ? '#93c5fd' : '#e2e8f0',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {entry.playerDisplay}
        {isViewer && (
          <span style={{ marginLeft: 6, fontSize: 11, color: '#60a5fa', fontWeight: 400 }}>
            (you)
          </span>
        )}
      </span>

      {/* Prize count */}
      <span
        style={{
          flexShrink: 0,
          fontSize: 13,
          fontWeight: 700,
          color: entry.rank <= 3 ? '#fbbf24' : '#94a3b8',
          minWidth: 52,
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
        }}
        title={`${entry.prizeCount} prize${entry.prizeCount !== 1 ? 's' : ''}`}
      >
        {entry.prizeCount} {entry.prizeCount === 1 ? 'win' : 'wins'}
      </span>

      {/* Last win date — hidden on very small screens */}
      <span
        className="hidden sm:inline"
        style={{
          flexShrink: 0,
          fontSize: 12,
          color: '#475569',
          minWidth: 88,
          textAlign: 'right',
        }}
      >
        {formatDate(entry.lastWinDate)}
      </span>
    </li>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {Array.from({ length: 10 }).map((_, i) => (
        <li
          key={i}
          style={{
            height: 56,
            borderRadius: 10,
            background: '#1e293b',
            border: '1px solid #334155',
            animation: 'pulse 1.6s ease-in-out infinite',
            opacity: 1 - i * 0.06,
          }}
        />
      ))}
    </ul>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LeaderboardPage() {
  const { ready, authenticated, user } = usePrivy();
  const viewerUserId = authenticated && user?.id ? user.id : null;

  const [period, setPeriod] = useState<Period>('alltime');
  const [items, setItems] = useState<LeaderboardEntry[]>([]);
  const [viewer, setViewer] = useState<(LeaderboardEntry & { rank: number }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLeaderboard = useCallback(
    async (p: Period, uid: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ period: p });
        if (uid) params.set('userId', uid);
        const res = await fetch(`/api/leaderboard?${params}`);
        if (!res.ok) throw new Error('Failed to load');
        const data = await res.json();
        setItems(data.items ?? []);
        setViewer(data.viewer ?? null);
      } catch {
        setError('Could not load leaderboard. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!ready) return;
    fetchLeaderboard(period, viewerUserId);
  }, [ready, period, viewerUserId, fetchLeaderboard]);

  const viewerInTop50 = viewerUserId
    ? items.some((it) => it.userId === viewerUserId)
    : false;

  return (
    <div style={{ minHeight: '100dvh', background: '#0f172a', color: '#e2e8f0' }}>
      {/* ── Header ── */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 20px',
          borderBottom: '1px solid #1e293b',
          background: '#0f172a',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link
            href="/openclaw"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 6,
              borderRadius: 8,
              color: '#64748b',
              textDecoration: 'none',
            }}
            aria-label="Back to OpenClaw"
          >
            <svg aria-hidden="true" width={16} height={16} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
          </Link>
          <span style={{ fontWeight: 700, fontSize: 15, color: '#f1f5f9', letterSpacing: -0.3 }}>
            OpenClaw
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: '#64748b',
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: 99,
              padding: '2px 8px',
            }}
          >
            Leaderboard
          </span>
        </div>

        <span style={{ fontSize: 12, color: '#475569' }}>Top 50 Winners</span>
      </header>

      {/* ── Content ── */}
      <main style={{ maxWidth: 640, margin: '0 auto', padding: '28px 16px 64px' }}>
        {/* Title */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9', margin: '0 0 4px' }}>
            🏆 Prize Winners
          </h1>
          <p style={{ fontSize: 13, color: '#475569', margin: 0 }}>
            Ranked by total prizes won. Ties broken by sessions played.
          </p>
        </div>

        {/* Period toggle */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: 10,
            padding: 4,
            marginBottom: 20,
            width: 'fit-content',
          }}
          role="group"
          aria-label="Leaderboard period"
        >
          {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              aria-pressed={period === p}
              style={{
                padding: '6px 14px',
                borderRadius: 7,
                border: 'none',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: period === p ? 600 : 400,
                background: period === p ? '#3b82f6' : 'transparent',
                color: period === p ? '#fff' : '#64748b',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>

        {/* Loading */}
        {loading && <Skeleton />}

        {/* Error */}
        {!loading && error && (
          <div
            style={{
              textAlign: 'center',
              padding: '48px 0',
              color: '#64748b',
              fontSize: 14,
            }}
          >
            <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
            <p style={{ margin: 0 }}>{error}</p>
            <button
              onClick={() => fetchLeaderboard(period, viewerUserId)}
              style={{
                marginTop: 16,
                padding: '8px 20px',
                borderRadius: 8,
                border: '1px solid #334155',
                background: '#1e293b',
                color: '#94a3b8',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty */}
        {!loading && !error && items.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 0', color: '#475569', fontSize: 14 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🎰</div>
            <p style={{ margin: '0 0 8px', fontWeight: 500, color: '#64748b' }}>
              No winners yet
            </p>
            <p style={{ margin: 0, fontSize: 12 }}>
              {period === 'weekly' ? 'No wins this week — ' : period === 'monthly' ? 'No wins this month — ' : ''}
              be the first!
            </p>
            <Link
              href="/openclaw"
              style={{
                display: 'inline-block',
                marginTop: 16,
                padding: '8px 20px',
                borderRadius: 8,
                background: '#3b82f6',
                color: '#fff',
                textDecoration: 'none',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Play OpenClaw
            </Link>
          </div>
        )}

        {/* Leaderboard list */}
        {!loading && !error && items.length > 0 && (
          <>
            {/* Column headers */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '0 16px 8px',
                fontSize: 11,
                fontWeight: 600,
                color: '#475569',
                textTransform: 'uppercase',
                letterSpacing: 0.6,
              }}
            >
              <span style={{ width: 28, flexShrink: 0 }}>#</span>
              <span style={{ width: 32, flexShrink: 0 }} />
              <span style={{ flex: 1 }}>Player</span>
              <span style={{ flexShrink: 0, minWidth: 52, textAlign: 'right' }}>Wins</span>
              <span className="hidden sm:inline" style={{ flexShrink: 0, minWidth: 88, textAlign: 'right' }}>
                Last Win
              </span>
            </div>

            <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.map((entry) => (
                <PlayerRow
                  key={entry.userId}
                  entry={entry}
                  isViewer={viewerUserId === entry.userId}
                  isPinned={false}
                />
              ))}
            </ol>

            {/* Pinned viewer row (outside top 50) */}
            {viewer && !viewerInTop50 && viewerUserId && (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    margin: '16px 0 6px',
                    fontSize: 11,
                    color: '#334155',
                  }}
                >
                  <div style={{ flex: 1, height: 1, background: '#1e293b' }} />
                  <span style={{ flexShrink: 0, fontSize: 11, color: '#475569' }}>your rank</span>
                  <div style={{ flex: 1, height: 1, background: '#1e293b' }} />
                </div>
                <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  <PlayerRow
                    entry={{ ...viewer, userId: viewerUserId }}
                    isViewer={true}
                    isPinned={true}
                  />
                </ol>
              </>
            )}

            {/* Not-yet-won nudge for logged-in users with no wins */}
            {!loading && authenticated && !viewerInTop50 && !viewer && (
              <p
                style={{
                  textAlign: 'center',
                  fontSize: 12,
                  color: '#334155',
                  marginTop: 20,
                  marginBottom: 0,
                }}
              >
                You haven&apos;t won yet.{' '}
                <Link href="/openclaw" style={{ color: '#3b82f6', textDecoration: 'none' }}>
                  Play to get on the board!
                </Link>
              </p>
            )}
          </>
        )}
      </main>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
