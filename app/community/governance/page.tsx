'use client';

import { useState, useEffect } from 'react';
import {
  type GovernanceData,
  truncateWallet,
  fetchGovernanceData,
} from '@/lib/community';
import { WalletAvatar } from '@/components/wallet-avatar';
import { ErrorBoundary } from '@/components/error-boundary';

export default function GovernancePage() {
  const [data, setData] = useState<GovernanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    fetchGovernanceData()
      .then(setData)
      .catch(() => setFetchError(true))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col min-h-full overflow-x-hidden" style={{ background: '#faf8f3' }}>
      {/* Header */}
      <header
        className="flex items-center gap-3 px-5 py-3 border-b sticky top-0 z-10"
        style={{ borderColor: '#e0d8cc', background: '#faf8f3' }}
      >
        <a
          href="/community"
          className="flex items-center gap-1.5 text-xs"
          style={{ color: '#7d8c6e' }}
        >
          <svg aria-hidden="true"
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
          Community
        </a>
        <span className="text-xs" style={{ color: '#e0d8cc' }}>
          ·
        </span>
        <h1 className="text-sm font-semibold" style={{ color: '#3d4f38' }}>
          Governance
        </h1>
      </header>

      <main id="main-content" className="flex-1 max-w-3xl w-full mx-auto px-4 py-6 space-y-8">
        {/* Stats cards */}
        <section>
          <h2
            className="text-xs font-semibold uppercase tracking-widest mb-3"
            style={{ color: '#9c9080' }}
          >
            Community stats
          </h2>
          <ErrorBoundary fallback={<StatsUnavailable />}>
            {loading ? (
              <StatsCardsSkeleton />
            ) : fetchError ? (
              <StatsUnavailable />
            ) : (
              <StatsCards stats={data!.stats} />
            )}
          </ErrorBoundary>
        </section>

        {/* Two-column leaderboards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Top posts */}
          <section>
            <h2
              className="text-xs font-semibold uppercase tracking-widest mb-3"
              style={{ color: '#9c9080' }}
            >
              Top posts — all time
            </h2>
            {loading ? (
              <LeaderboardSkeleton rows={10} />
            ) : fetchError ? (
              <EmptyState message="No community activity yet." />
            ) : (
              <PostLeaderboard posts={data!.topPosts} />
            )}
          </section>

          {/* Top contributors */}
          <section>
            <h2
              className="text-xs font-semibold uppercase tracking-widest mb-3"
              style={{ color: '#9c9080' }}
            >
              Top contributors
            </h2>
            {loading ? (
              <LeaderboardSkeleton rows={10} />
            ) : fetchError ? (
              <EmptyState message="No community activity yet." />
            ) : (
              <ContributorLeaderboard contributors={data!.topContributors} />
            )}
          </section>
        </div>

        {/* Trending this week */}
        <section>
          <h2
            className="text-xs font-semibold uppercase tracking-widest mb-3"
            style={{ color: '#9c9080' }}
          >
            Trending this week
          </h2>
          {loading ? (
            <LeaderboardSkeleton rows={5} />
          ) : fetchError ? (
            <EmptyState message="No community activity yet." />
          ) : data!.trendingThisWeek.length === 0 ? (
            <EmptyState message="No votes this week yet." />
          ) : (
            <TrendingList posts={data!.trendingThisWeek} />
          )}
        </section>
      </main>

      <footer
        className="flex items-center justify-center px-5 py-2.5 border-t"
        style={{ borderColor: '#e0d8cc', background: '#faf8f3' }}
      >
        <span className="text-xs" style={{ color: '#b0a898' }}>
          Convergence · Paradox of Acceptance
        </span>
      </footer>
    </div>
  );
}

// ── Stats unavailable ─────────────────────────────────────────────────────────

function StatsUnavailable() {
  return (
    <div
      className="rounded-2xl px-4 py-5 flex items-center justify-center"
      style={{ border: '1px solid #e0d8cc', background: '#fff' }}
    >
      <p className="text-xs" style={{ color: '#b0a898' }}>
        Stats temporarily unavailable.
      </p>
    </div>
  );
}

// ── Stats cards ──────────────────────────────────────────────────────────────

function StatsCards({ stats }: { stats: GovernanceData['stats'] }) {
  const cards = [
    { label: 'Posts', value: stats.totalPosts.toLocaleString() },
    { label: 'Replies', value: stats.totalReplies.toLocaleString() },
    { label: 'Voters', value: stats.totalVoters.toLocaleString() },
  ];

  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      {cards.map(({ label, value }) => (
        <div
          key={label}
          className="rounded-2xl px-3 py-3 sm:px-4 sm:py-4 flex flex-col gap-1"
          style={{ background: '#fff', border: '1px solid #e0d8cc' }}
        >
          <span className="text-xl sm:text-2xl font-semibold tabular-nums" style={{ color: '#3d4f38' }}>
            {value}
          </span>
          <span className="text-xs" style={{ color: '#9c9080' }}>
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

function StatsCardsSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="rounded-2xl px-4 py-4 flex flex-col gap-2"
          style={{ background: '#fff', border: '1px solid #e0d8cc' }}
        >
          <div
            className="h-7 w-16 rounded animate-pulse"
            style={{ background: '#e8e0d5' }}
          />
          <div
            className="h-3 w-10 rounded animate-pulse"
            style={{ background: '#f0ece3' }}
          />
        </div>
      ))}
    </div>
  );
}

// ── Post leaderboard ─────────────────────────────────────────────────────────

function PostLeaderboard({ posts }: { posts: GovernanceData['topPosts'] }) {
  if (posts.length === 0) return <EmptyState message="No posts yet." />;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ border: '1px solid #e0d8cc', background: '#fff' }}
    >
      {posts.map((post, idx) => (
        <a
          key={post.id}
          href={`/community/${post.id}`}
          className="flex items-start gap-3 px-4 py-3 transition-colors"
          style={{
            borderBottom: idx < posts.length - 1 ? '1px solid #f0ece3' : undefined,
            textDecoration: 'none',
          }}
          onMouseOver={(e) =>
            ((e.currentTarget as HTMLElement).style.background = '#faf8f3')
          }
          onMouseOut={(e) =>
            ((e.currentTarget as HTMLElement).style.background = '')
          }
        >
          {/* Rank */}
          <span
            className="text-xs tabular-nums font-medium w-5 flex-shrink-0 pt-0.5 text-right"
            style={{ color: idx < 3 ? '#7d8c6e' : '#b0a898' }}
          >
            {idx + 1}
          </span>

          {/* Avatar */}
          <WalletAvatar address={post.authorWallet} size={24} />

          {/* Content */}
          <div className="flex-1 min-w-0">
            <p
              className="text-xs font-medium leading-snug line-clamp-2"
              style={{ color: '#3d4f38' }}
            >
              {post.title}
            </p>
            <p className="text-xs mt-0.5" style={{ color: '#b0a898' }}>
              {truncateWallet(post.authorWallet)}
            </p>
          </div>

          {/* Vote score */}
          <span
            className="flex-shrink-0 text-xs font-semibold tabular-nums flex items-center gap-0.5"
            style={{ color: '#7d8c6e' }}
          >
            <svg aria-hidden="true" className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 4 3 20h18L12 4z" />
            </svg>
            {post.votes}
          </span>
        </a>
      ))}
    </div>
  );
}

// ── Contributor leaderboard ──────────────────────────────────────────────────

function ContributorLeaderboard({
  contributors,
}: {
  contributors: GovernanceData['topContributors'];
}) {
  if (contributors.length === 0) return <EmptyState message="No contributors yet." />;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ border: '1px solid #e0d8cc', background: '#fff' }}
    >
      {contributors.map((c, idx) => (
        <div
          key={c.authorWallet}
          className="flex items-center gap-3 px-4 py-3"
          style={{
            borderBottom:
              idx < contributors.length - 1 ? '1px solid #f0ece3' : undefined,
          }}
        >
          {/* Rank */}
          <span
            className="text-xs tabular-nums font-medium w-5 flex-shrink-0 text-right"
            style={{ color: idx < 3 ? '#7d8c6e' : '#b0a898' }}
          >
            {idx + 1}
          </span>

          {/* Avatar */}
          <WalletAvatar address={c.authorWallet} size={24} />

          {/* Wallet + post count */}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium" style={{ color: '#3d4f38' }}>
              {truncateWallet(c.authorWallet)}
            </p>
            <p className="text-xs" style={{ color: '#b0a898' }}>
              {c.postCount} {c.postCount === 1 ? 'post' : 'posts'}
            </p>
          </div>

          {/* Total votes received */}
          <span
            className="flex-shrink-0 text-xs font-semibold tabular-nums flex items-center gap-0.5"
            style={{ color: '#7d8c6e' }}
          >
            <svg aria-hidden="true" className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 4 3 20h18L12 4z" />
            </svg>
            {c.totalVotes}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Trending list ────────────────────────────────────────────────────────────

function TrendingList({ posts }: { posts: GovernanceData['trendingThisWeek'] }) {
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ border: '1px solid #e0d8cc', background: '#fff' }}
    >
      {posts.map((post, idx) => (
        <a
          key={post.id}
          href={`/community/${post.id}`}
          className="flex items-start gap-3 px-4 py-3 transition-colors"
          style={{
            borderBottom: idx < posts.length - 1 ? '1px solid #f0ece3' : undefined,
            textDecoration: 'none',
          }}
          onMouseOver={(e) =>
            ((e.currentTarget as HTMLElement).style.background = '#faf8f3')
          }
          onMouseOut={(e) =>
            ((e.currentTarget as HTMLElement).style.background = '')
          }
        >
          {/* Rank */}
          <span
            className="text-xs tabular-nums font-medium w-5 flex-shrink-0 pt-0.5 text-right"
            style={{ color: idx < 3 ? '#7d8c6e' : '#b0a898' }}
          >
            {idx + 1}
          </span>

          {/* Avatar */}
          <WalletAvatar address={post.authorWallet} size={24} />

          {/* Content */}
          <div className="flex-1 min-w-0">
            <p
              className="text-xs font-medium leading-snug line-clamp-2"
              style={{ color: '#3d4f38' }}
            >
              {post.title}
            </p>
            <p className="text-xs mt-0.5" style={{ color: '#b0a898' }}>
              {truncateWallet(post.authorWallet)}
            </p>
          </div>

          {/* Weekly votes badge */}
          <div className="flex-shrink-0 flex flex-col items-end gap-0.5">
            <span
              className="text-xs font-semibold tabular-nums flex items-center gap-0.5"
              style={{ color: '#7d8c6e' }}
            >
              <svg aria-hidden="true" className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 4 3 20h18L12 4z" />
              </svg>
              +{post.weeklyVotes}
            </span>
            <span className="text-xs" style={{ color: '#b0a898' }}>
              this week
            </span>
          </div>
        </a>
      ))}
    </div>
  );
}

// ── Shared skeleton ──────────────────────────────────────────────────────────

function LeaderboardSkeleton({ rows }: { rows: number }) {
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ border: '1px solid #e0d8cc', background: '#fff' }}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-4 py-3"
          style={{ borderBottom: i < rows - 1 ? '1px solid #f0ece3' : undefined }}
        >
          <div
            className="w-5 h-3 rounded animate-pulse flex-shrink-0"
            style={{ background: '#f0ece3' }}
          />
          <div
            className="w-6 h-6 rounded-full animate-pulse flex-shrink-0"
            style={{ background: '#e8e0d5' }}
          />
          <div className="flex-1 space-y-1.5">
            <div
              className="h-3 rounded animate-pulse"
              style={{ background: '#e8e0d5', width: `${60 + (i % 3) * 15}%` }}
            />
            <div
              className="h-2.5 w-16 rounded animate-pulse"
              style={{ background: '#f0ece3' }}
            />
          </div>
          <div
            className="w-8 h-3 rounded animate-pulse flex-shrink-0"
            style={{ background: '#f0ece3' }}
          />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div
      className="rounded-2xl px-4 py-8 flex items-center justify-center"
      style={{ border: '1px solid #e0d8cc', background: '#fff' }}
    >
      <p className="text-xs" style={{ color: '#b0a898' }}>
        {message}
      </p>
    </div>
  );
}
