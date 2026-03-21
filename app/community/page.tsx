'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/use-auth';
import {
  type Post,
  MOCK_POSTS,
  truncateWallet,
  formatRelativeTime,
  fetchPosts,
  checkTokenGate,
  voteOnPost,
  TokenGateError,
} from '@/lib/community';
import { VoteButton } from '@/components/vote-button';
import { CreatePostModal } from '@/components/create-post-modal';
import { OnboardingModal, hasSeenOnboarding } from '@/components/onboarding-modal';
import { SearchBar } from '@/components/search-bar';

const PAGE_SIZE = 20;

export default function CommunityPage() {
  const { ready, authenticated, user, getAccessToken } = useAuth();
  const walletAddress = user?.wallet?.address ?? null;

  const [posts, setPosts] = useState<Post[]>(MOCK_POSTS);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [hasPass, setHasPass] = useState<boolean | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [pendingVotePostId, setPendingVotePostId] = useState<string | null>(null);
  const [voteToastError, setVoteToastError] = useState<string | null>(null);

  // Load real posts from API (falls back to mock if unavailable)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPosts(1, PAGE_SIZE)
      .then((res) => {
        if (!cancelled) {
          setPosts(res.posts);
          setPage(1);
          setHasMore(res.hasMore);
        }
      })
      .catch(() => {
        // API not ready — keep mock data
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Check token gate when wallet is available; trigger onboarding for new pass holders
  useEffect(() => {
    if (!walletAddress) {
      setHasPass(null);
      return;
    }
    checkTokenGate(walletAddress)
      .then((result) => {
        setHasPass(result);
        if (result && user?.id && !hasSeenOnboarding(user.id)) {
          setShowOnboarding(true);
        }
      })
      .catch(() => setHasPass(false));
  }, [walletAddress, user?.id]);

  // Get auth token for write operations
  useEffect(() => {
    if (!authenticated) {
      setAuthToken(null);
      return;
    }
    getAccessToken().then(setAuthToken).catch(() => setAuthToken(null));
  }, [authenticated, getAccessToken]);

  const loadMore = useCallback(async () => {
    const nextPage = page + 1;
    setLoading(true);
    try {
      const res = await fetchPosts(nextPage, PAGE_SIZE);
      setPosts((prev) => [...prev, ...res.posts]);
      setPage(nextPage);
      setHasMore(res.hasMore);
    } catch {
      // API not ready
    } finally {
      setLoading(false);
    }
  }, [page]);

  function handleVote(postId: string, direction: 'up' | 'down') {
    if (!authToken || pendingVotePostId) return;

    const prevPost = posts.find((p) => p.id === postId);
    if (!prevPost) return;
    const savedVotes = prevPost.votes;
    const savedUserVote = prevPost.userVote;

    // Optimistic update
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== postId) return p;
        const prevVote = p.userVote;
        let delta = 0;
        let nextVote: 'up' | 'down' | null = direction;
        if (prevVote === direction) {
          // Toggle off
          delta = direction === 'up' ? -1 : 1;
          nextVote = null;
        } else if (prevVote === null) {
          delta = direction === 'up' ? 1 : -1;
        } else {
          // Switching direction
          delta = direction === 'up' ? 2 : -2;
        }
        return { ...p, votes: p.votes + delta, userVote: nextVote };
      }),
    );
    setPendingVotePostId(postId);

    voteOnPost(postId, direction, authToken)
      .catch((err) => {
        // Revert to pre-optimistic state
        setPosts((prev) =>
          prev.map((p) =>
            p.id === postId ? { ...p, votes: savedVotes, userVote: savedUserVote } : p,
          ),
        );
        if (!(err instanceof TokenGateError)) {
          setVoteToastError('Vote failed. Please try again.');
          setTimeout(() => setVoteToastError(null), 3500);
        }
      })
      .finally(() => setPendingVotePostId(null));
  }

  function handlePostCreated(newPost: { id: string; title: string; body: string }) {
    const post: Post = {
      id: newPost.id,
      title: newPost.title,
      body: newPost.body,
      authorWallet: walletAddress ?? '0x0000…',
      createdAt: new Date().toISOString(),
      votes: 0,
      replyCount: 0,
      userVote: null,
    };
    setPosts((prev) => [post, ...prev]);
    setShowCreateModal(false);
  }

  if (!ready) {
    return (
      <div className="flex flex-1 items-center justify-center" style={{ background: '#faf8f3' }}>
        <div className="text-sm" style={{ color: '#9c9080' }}>Loading…</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full overflow-x-hidden" style={{ background: '#faf8f3' }}>
      {/* Header */}
      <header
        className="flex items-center justify-between px-5 py-3 border-b sticky top-0 z-10"
        style={{ borderColor: '#e0d8cc', background: '#faf8f3' }}
      >
        <div className="flex items-center gap-3">
          <a href="/" className="flex items-center gap-1.5 text-xs" style={{ color: '#7d8c6e' }}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Convergence
          </a>
          <span className="text-xs" style={{ color: '#e0d8cc' }}>·</span>
          <h1 className="text-sm font-semibold" style={{ color: '#3d4f38' }}>
            Community
          </h1>
          <a
            href="/community/governance"
            className="hidden sm:inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full transition-colors"
            style={{ color: '#7d8c6e', border: '1px solid #e0d8cc' }}
            onMouseOver={(e) => ((e.currentTarget as HTMLElement).style.borderColor = '#b8ccb0')}
            onMouseOut={(e) => ((e.currentTarget as HTMLElement).style.borderColor = '#e0d8cc')}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
            </svg>
            Governance
          </a>
        </div>

        <div className="flex items-center gap-2">
          {/* Search */}
          <SearchBar />

          {/* Token gate status badge */}
          {walletAddress && hasPass !== null && (
            <span
              className="hidden sm:inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full"
              style={
                hasPass
                  ? { background: '#d4e6cc', color: '#3d4f38', border: '1px solid #b8ccb0' }
                  : { background: '#f0ece3', color: '#9c9080', border: '1px solid #e0d8cc' }
              }
            >
              {hasPass ? (
                <>
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z" />
                  </svg>
                  Pass holder
                </>
              ) : (
                'Read only'
              )}
            </span>
          )}

          {/* New post button */}
          {authenticated && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center justify-center gap-1.5 text-xs px-3 rounded-full font-medium transition-opacity min-h-[44px]"
              style={{
                background: hasPass === false ? '#e8e0d5' : '#7d8c6e',
                color: hasPass === false ? '#9c9080' : '#fff',
                cursor: hasPass === false ? 'default' : 'pointer',
              }}
              title={hasPass === false ? 'Acceptance Pass required to post' : 'Create a new post'}
            >
              <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              <span className="hidden sm:inline">New post</span>
            </button>
          )}
        </div>
      </header>

      {/* Token gate banner for non-holders */}
      {authenticated && hasPass === false && (
        <div
          className="px-5 py-3 border-b text-xs flex flex-wrap items-center gap-x-3 gap-y-1.5"
          style={{ background: '#fef9ec', borderColor: '#f0d88a', color: '#7a6220' }}
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 0 1 0 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a3 3 0 0 1 0-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375Z" />
          </svg>
          <span className="flex-1 min-w-0">
            You&apos;re in <strong>read-only mode</strong> — you need an Acceptance Pass to post and vote.
          </span>
          <a
            href="https://opensea.io/collection/acceptance-pass"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 font-medium underline underline-offset-2"
            style={{ color: '#7d8c6e' }}
          >
            Get a Pass →
          </a>
        </div>
      )}

      {/* Feed */}
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-6">
        {!authenticated && (
          <div
            className="rounded-2xl px-5 py-4 mb-6 text-sm"
            style={{ background: '#f0ece3', border: '1px solid #ddd5c8' }}
          >
            <p className="font-medium mb-1" style={{ color: '#3d4f38' }}>
              Sign in to participate
            </p>
            <p className="text-xs leading-relaxed" style={{ color: '#7d8c6e' }}>
              Create an account to post, reply, and vote. Acceptance Pass holders unlock full governance rights.
            </p>
            <a
              href="/login"
              className="inline-flex items-center gap-1 mt-3 text-xs font-medium px-3 py-1.5 rounded-full"
              style={{ background: '#7d8c6e', color: '#fff' }}
            >
              Sign in
            </a>
          </div>
        )}

        {posts.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mb-4"
              style={{ background: '#e8e0d5' }}
            >
              <svg className="w-6 h-6" style={{ color: '#7d8c6e' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
              </svg>
            </div>
            <p className="text-sm font-medium mb-1" style={{ color: '#5c5248' }}>No posts yet</p>
            <p className="text-xs mb-5 max-w-xs leading-relaxed" style={{ color: '#9c9080' }}>
              {hasPass
                ? 'Be the first to share something with the community.'
                : 'No posts yet. Only Acceptance Pass holders can create posts.'}
            </p>
            {hasPass && (
              <button
                onClick={() => setShowCreateModal(true)}
                className="text-sm px-5 py-2.5 rounded-full font-medium"
                style={{ background: '#7d8c6e', color: '#fff' }}
              >
                Create the first post
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                hasPass={hasPass}
                authenticated={authenticated}
                onVote={handleVote}
                pendingVote={pendingVotePostId === post.id}
              />
            ))}
          </div>
        )}

        {/* Load more */}
        {hasMore && (
          <div className="flex justify-center mt-6">
            <button
              onClick={loadMore}
              disabled={loading}
              className="text-xs px-5 py-2 rounded-full border transition-colors disabled:opacity-50"
              style={{ borderColor: '#e0d8cc', color: '#7d8c6e' }}
            >
              {loading ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </main>

      {/* Create post modal */}
      {showCreateModal && (
        <CreatePostModal
          authToken={authToken}
          hasPass={hasPass}
          onCreated={handlePostCreated}
          onClose={() => setShowCreateModal(false)}
        />
      )}

      {/* First-time onboarding for new pass holders */}
      {showOnboarding && user?.id && (
        <OnboardingModal
          userId={user.id}
          onClose={() => setShowOnboarding(false)}
          onCreatePost={() => setShowCreateModal(true)}
        />
      )}

      {/* Vote error toast */}
      {voteToastError && (
        <div
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-xs font-medium shadow-lg"
          style={{ background: '#3d1a17', color: '#fde8e6', pointerEvents: 'none' }}
        >
          {voteToastError}
        </div>
      )}

      {/* Footer */}
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

function PostCard({
  post,
  hasPass,
  authenticated,
  onVote,
  pendingVote,
}: {
  post: Post;
  hasPass: boolean | null;
  authenticated: boolean;
  onVote: (postId: string, direction: 'up' | 'down') => void;
  pendingVote: boolean;
}) {
  const canVote = authenticated && hasPass === true;

  return (
    <a
      href={`/community/${post.id}`}
      className="block rounded-2xl px-4 py-4 transition-colors group"
      style={{
        background: '#fff',
        border: '1px solid #e0d8cc',
        textDecoration: 'none',
      }}
      onMouseOver={(e) => ((e.currentTarget as HTMLElement).style.borderColor = '#b8ccb0')}
      onMouseOut={(e) => ((e.currentTarget as HTMLElement).style.borderColor = '#e0d8cc')}
    >
      {/* Vote + content layout */}
      <div className="flex gap-3">
        {/* Vote column */}
        <div
          className="flex-shrink-0 pt-0.5"
          onClick={(e) => e.preventDefault()}
        >
          <VoteButton
            votes={post.votes}
            userVote={post.userVote}
            onVote={(dir) => onVote(post.id, dir)}
            disabled={!canVote}
            pending={pendingVote}
            size="sm"
          />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h2
            className="text-sm font-semibold leading-snug mb-1.5 group-hover:underline"
            style={{ color: '#3d4f38', textDecorationColor: '#b8ccb0' }}
          >
            {post.title}
          </h2>
          <p
            className="text-xs leading-relaxed line-clamp-2 mb-3"
            style={{ color: '#7d8c6e', fontFamily: 'Georgia, serif' }}
          >
            {post.body}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: '#b0a898' }}>
            <span>{truncateWallet(post.authorWallet)}</span>
            <span aria-hidden>·</span>
            <span>{formatRelativeTime(post.createdAt)}</span>
            <span aria-hidden>·</span>
            <span className="flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
              </svg>
              {post.replyCount} {post.replyCount === 1 ? 'reply' : 'replies'}
            </span>
          </div>
        </div>
      </div>
    </a>
  );
}
