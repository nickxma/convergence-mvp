'use client';

import { use, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { WalletAvatar } from '@/components/wallet-avatar';
import { PassOwnershipBadge } from '@/components/pass-ownership-badge';
import { DisplayNameEditor } from '@/components/display-name-editor';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Post {
  id: string;
  title: string;
  excerpt: string;
  votes: number;
  createdAt: string;
}

interface ProfileData {
  wallet: string;
  displayName: string | null;
  ensName: string | null;
  hasPass: boolean;
  postCount: number;
  totalVotesReceived: number;
  recentPosts: Post[];
}

// ---------------------------------------------------------------------------
// Mock data — replace with real API calls when backend is ready
// ---------------------------------------------------------------------------

function getMockProfile(wallet: string): ProfileData {
  // Deterministic mock based on wallet so repeated renders are stable
  const seed = parseInt(wallet.slice(2, 8) || '0', 16);
  const hasPass = seed % 3 !== 0; // ~66% of wallets have a pass in mock

  const posts: Post[] = Array.from({ length: Math.min(seed % 8 + 2, 10) }, (_, i) => ({
    id: `post-${i}`,
    title: MOCK_POST_TITLES[i % MOCK_POST_TITLES.length],
    excerpt: MOCK_POST_EXCERPTS[i % MOCK_POST_EXCERPTS.length],
    votes: Math.floor((seed * (i + 1)) % 42),
    createdAt: new Date(Date.now() - i * 86_400_000 * 3).toISOString(),
  }));

  return {
    wallet,
    displayName: null,
    ensName: null, // ENS resolved client-side below
    hasPass,
    postCount: posts.length,
    totalVotesReceived: posts.reduce((s, p) => s + p.votes, 0),
    recentPosts: posts,
  };
}

const MOCK_POST_TITLES = [
  'The nature of awareness in daily practice',
  'Non-dual perspectives on the waking state',
  'How mindfulness changes default mode network activity',
  'Thoughts on guided practice — six months in',
  'Is concentration meditation necessary?',
  'Open monitoring vs focused attention',
  'On the dissolution of the sense of self',
  'Comparing Vipassana and Dzogchen approaches',
  'Equanimity as ground, not distance',
  'The relationship between insight and ethics',
];

const MOCK_POST_EXCERPTS = [
  'What does it mean to notice the noticing itself? I have been sitting with this question…',
  'There is something fundamentally different about the non-dual view that took me time to…',
  'Recent research suggests that insight practice directly reduces activity in the DMN…',
  'After half a year of daily sits, here is what I have found most surprising about…',
  'Many teachers say samatha is prerequisite; others suggest investigation is sufficient…',
  'The distinction between object-based and objectless awareness is subtle but important…',
  'At some point in practice the looker dissolves into the looking. Trying to articulate…',
  'Both traditions point at the same territory but through radically different maps…',
  'Equanimity is often mistaken for detachment. The difference is worth examining…',
  'Sam argues that the path and its fruits are inseparable from how we treat others…',
];

// ---------------------------------------------------------------------------
// ENS lookup
// ---------------------------------------------------------------------------

async function lookupEns(address: string): Promise<string | null> {
  try {
    // ENS is on Ethereum mainnet — use a public JSON-RPC endpoint
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [
        {
          to: '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e', // ENS registry
          data: '0x', // simplified — real implementation uses viem getEnsName
        },
        'latest',
      ],
    };
    // If viem is available server-side we would use createPublicClient + getEnsName.
    // For now gracefully return null; wire up real lookup in the API route.
    void body;
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PostCard({ post }: { post: Post }) {
  return (
    <div
      className="rounded-xl px-4 py-3"
      style={{ background: '#f5f1e8', border: '1px solid #e0d8cc' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-snug" style={{ color: '#2c2c2c' }}>
            {post.title}
          </p>
          <p className="text-xs mt-1 leading-relaxed line-clamp-2" style={{ color: '#7d8c6e' }}>
            {post.excerpt}
          </p>
          <p className="text-xs mt-1.5" style={{ color: '#b0a898' }}>
            {new Date(post.createdAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
        </div>
        <div className="flex-shrink-0 flex flex-col items-center gap-0.5 pt-0.5">
          <svg className="w-3.5 h-3.5" style={{ color: '#7d8c6e' }} fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 4l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 4z" />
          </svg>
          <span className="text-xs font-semibold" style={{ color: '#3d4f38' }}>
            {post.votes}
          </span>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      className="rounded-xl p-3 text-center"
      style={{ background: '#f5f1e8', border: '1px solid #e0d8cc' }}
    >
      <p className="text-lg font-semibold" style={{ color: '#3d4f38' }}>
        {value}
      </p>
      <p className="text-xs mt-0.5" style={{ color: '#9c9080' }}>
        {label}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ContributorProfilePage({
  params,
}: {
  params: Promise<{ wallet: string }>;
}) {
  const { wallet } = use(params);
  const { ready, authenticated, user } = usePrivy();

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [page, setPage] = useState(0);
  const POSTS_PER_PAGE = 5;

  const viewerWallet = user?.wallet?.address?.toLowerCase() ?? null;
  const isOwner = viewerWallet === wallet.toLowerCase();

  useEffect(() => {
    // Load profile — replace with real fetch when API is ready:
    // fetch(`/api/profile/${wallet}`).then(r => r.json()).then(setProfile)
    const mock = getMockProfile(wallet);
    setProfile(mock);

    // ENS lookup (best-effort)
    lookupEns(wallet).then((ens) => {
      if (ens) setProfile((prev) => prev ? { ...prev, ensName: ens } : prev);
    });
  }, [wallet]);

  function handleDisplayNameSave(name: string) {
    setProfile((prev) => prev ? { ...prev, displayName: name || null } : prev);
  }

  const shortAddress = `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
  const displayLabel = profile?.ensName ?? profile?.displayName ?? shortAddress;

  const visiblePosts = profile?.recentPosts.slice(
    page * POSTS_PER_PAGE,
    (page + 1) * POSTS_PER_PAGE
  ) ?? [];
  const totalPages = Math.ceil((profile?.recentPosts.length ?? 0) / POSTS_PER_PAGE);

  if (!profile) {
    return (
      <div className="flex flex-col min-h-full overflow-x-hidden" style={{ background: '#faf8f3' }}>
        <header
          className="flex items-center gap-3 px-5 py-3 border-b"
          style={{ borderColor: '#e0d8cc', background: '#faf8f3' }}
        >
          <div className="h-3 w-8 rounded animate-pulse" style={{ background: '#e8e0d5' }} />
        </header>
        <main className="flex-1 px-5 py-8 max-w-lg mx-auto w-full">
          {/* Profile header skeleton */}
          <section className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-full flex-shrink-0 animate-pulse" style={{ background: '#e8e0d5' }} />
            <div className="flex-1 min-w-0 space-y-2 pt-1">
              <div className="h-4 w-32 rounded animate-pulse" style={{ background: '#e8e0d5' }} />
              <div className="h-3 w-24 rounded animate-pulse" style={{ background: '#f0ece3' }} />
              <div className="h-5 w-20 rounded-full animate-pulse" style={{ background: '#f0ece3' }} />
            </div>
          </section>
          {/* Post rows skeleton */}
          <section className="mt-8">
            <div className="h-4 w-24 rounded animate-pulse mb-3" style={{ background: '#e8e0d5' }} />
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="rounded-xl px-4 py-3"
                  style={{ background: '#f5f1e8', border: '1px solid #e0d8cc' }}
                >
                  <div className="h-3.5 rounded animate-pulse mb-2" style={{ background: '#e8e0d5', width: `${65 + i * 10}%` }} />
                  <div className="h-3 rounded animate-pulse mb-1" style={{ background: '#ede9e0', width: '100%' }} />
                  <div className="h-3 rounded animate-pulse" style={{ background: '#ede9e0', width: '80%' }} />
                </div>
              ))}
            </div>
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

  return (
    <div className="flex flex-col min-h-full overflow-x-hidden" style={{ background: '#faf8f3' }}>
      {/* Header */}
      <header
        className="flex items-center justify-between px-5 py-3 border-b flex-shrink-0"
        style={{ borderColor: '#e0d8cc', background: '#faf8f3' }}
      >
        <div className="flex items-center gap-3">
          <a
            href="/"
            className="flex items-center gap-1.5 text-xs"
            style={{ color: '#7d8c6e' }}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Back
          </a>
          <span className="text-sm font-semibold tracking-tight" style={{ color: '#3d4f38' }}>
            Contributor
          </span>
        </div>
        {ready && authenticated && isOwner && (
          <a
            href="/profile"
            className="text-xs px-3 min-h-[44px] inline-flex items-center rounded-full border transition-colors"
            style={{ borderColor: '#e0d8cc', color: '#7d8c6e' }}
          >
            Edit profile
          </a>
        )}
      </header>

      <main className="flex-1 px-5 py-8 max-w-lg mx-auto w-full">
        {/* Identity card */}
        <section>
          <div className="flex items-start gap-4">
            <WalletAvatar address={wallet} size={56} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base font-semibold" style={{ color: '#2c2c2c' }}>
                  {displayLabel}
                </h1>
                {profile.displayName && profile.ensName && (
                  <span className="text-xs" style={{ color: '#9c9080' }}>
                    ({profile.ensName})
                  </span>
                )}
              </div>

              <p
                className="text-xs font-mono mt-0.5"
                style={{ color: '#9c9080' }}
                title={wallet}
              >
                {shortAddress}
              </p>

              <div className="mt-2">
                <PassOwnershipBadge wallet={wallet} hasPass={profile.hasPass} />
              </div>

              {isOwner && (
                <div className="mt-2">
                  <DisplayNameEditor
                    wallet={wallet}
                    currentName={profile.displayName}
                    hasPass={profile.hasPass}
                    isOwner={isOwner}
                    onSave={handleDisplayNameSave}
                  />
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="mt-8">
          <h2 className="text-sm font-semibold mb-3" style={{ color: '#3d4f38' }}>
            Activity
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Posts" value={profile.postCount} />
            <StatCard label="Total votes received" value={profile.totalVotesReceived} />
          </div>
        </section>

        {/* Recent posts */}
        <section className="mt-8">
          <h2 className="text-sm font-semibold mb-3" style={{ color: '#3d4f38' }}>
            Recent posts
          </h2>

          {profile.recentPosts.length === 0 ? (
            <div
              className="rounded-xl px-4 py-6 text-center"
              style={{ background: '#f5f1e8', border: '1px solid #e0d8cc' }}
            >
              <p className="text-sm" style={{ color: '#9c9080' }}>
                No posts yet.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {visiblePosts.map((post) => (
                  <PostCard key={post.id} post={post} />
                ))}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="text-xs px-3 min-h-[44px] rounded-lg border disabled:opacity-40 transition-colors"
                    style={{ borderColor: '#e0d8cc', color: '#7d8c6e' }}
                  >
                    Previous
                  </button>
                  <span className="text-xs" style={{ color: '#9c9080' }}>
                    {page + 1} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="text-xs px-3 min-h-[44px] rounded-lg border disabled:opacity-40 transition-colors"
                    style={{ borderColor: '#e0d8cc', color: '#7d8c6e' }}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
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
