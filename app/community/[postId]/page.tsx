'use client';

import { useState, useEffect, use, useRef } from 'react';
import { useAuth } from '@/lib/use-auth';
import {
  type PostDetail,
  type Reply,
  MOCK_POSTS,
  MOCK_REPLIES,
  truncateWallet,
  formatRelativeTime,
  fetchPost,
  createReply,
  checkTokenGate,
  voteOnPost,
  voteOnReply,
  TokenGateError,
} from '@/lib/community';
import { VoteButton } from '@/components/vote-button';

export default function PostPage({
  params,
}: {
  params: Promise<{ postId: string }>;
}) {
  const { postId } = use(params);
  const { ready, authenticated, user, getAccessToken } = useAuth();
  const walletAddress = user?.wallet?.address ?? null;

  const [post, setPost] = useState<PostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasPass, setHasPass] = useState<boolean | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);

  const [replyBody, setReplyBody] = useState('');
  const [submittingReply, setSubmittingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  // 'post' = the post itself is pending; replyId = that reply is pending
  const [pendingVoteId, setPendingVoteId] = useState<string | null>(null);
  const [voteToastError, setVoteToastError] = useState<string | null>(null);

  const MAX_REPLY = 2000;

  // Load post (real API or mock fallback)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetchPost(postId)
      .then((data) => {
        if (!cancelled) setPost(data);
      })
      .catch(() => {
        // API not ready — use mock data
        if (!cancelled) {
          const mockPost = MOCK_POSTS.find((p) => p.id === postId);
          if (mockPost) {
            const mockReplies = MOCK_REPLIES.filter((r) => r.postId === postId);
            setPost({ ...mockPost, replies: mockReplies });
          } else {
            // Unknown id — show first mock post for scaffold
            setPost({ ...MOCK_POSTS[0], replies: MOCK_REPLIES.filter((r) => r.postId === MOCK_POSTS[0].id) });
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [postId]);

  // Check token gate
  useEffect(() => {
    if (!walletAddress) {
      setHasPass(null);
      return;
    }
    checkTokenGate(walletAddress).then(setHasPass).catch(() => setHasPass(false));
  }, [walletAddress]);

  // Auth token
  useEffect(() => {
    if (!authenticated) {
      setAuthToken(null);
      return;
    }
    getAccessToken().then(setAuthToken).catch(() => setAuthToken(null));
  }, [authenticated, getAccessToken]);

  function handlePostVote(direction: 'up' | 'down') {
    if (!post || !authToken || pendingVoteId) return;

    const savedVotes = post.votes;
    const savedUserVote = post.userVote;

    // Optimistic update
    setPost((prev) => {
      if (!prev) return prev;
      const prevVote = prev.userVote;
      let delta = 0;
      let nextVote: 'up' | 'down' | null = direction;
      if (prevVote === direction) {
        delta = direction === 'up' ? -1 : 1;
        nextVote = null;
      } else if (prevVote === null) {
        delta = direction === 'up' ? 1 : -1;
      } else {
        delta = direction === 'up' ? 2 : -2;
      }
      return { ...prev, votes: prev.votes + delta, userVote: nextVote };
    });
    setPendingVoteId('post');

    voteOnPost(post.id, direction, authToken)
      .catch((err) => {
        setPost((prev) =>
          prev ? { ...prev, votes: savedVotes, userVote: savedUserVote } : prev,
        );
        if (!(err instanceof TokenGateError)) {
          setVoteToastError('Vote failed. Please try again.');
          setTimeout(() => setVoteToastError(null), 3500);
        }
      })
      .finally(() => setPendingVoteId(null));
  }

  function handleReplyVote(replyId: string, direction: 'up' | 'down') {
    if (!post || !authToken || pendingVoteId) return;

    const replyBefore = post.replies.find((r) => r.id === replyId);
    const savedVotes = replyBefore?.votes ?? 0;
    const savedUserVote = replyBefore?.userVote ?? null;

    setPost((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        replies: prev.replies.map((r) => {
          if (r.id !== replyId) return r;
          const prevVote = r.userVote;
          let delta = 0;
          let nextVote: 'up' | 'down' | null = direction;
          if (prevVote === direction) {
            delta = direction === 'up' ? -1 : 1;
            nextVote = null;
          } else if (prevVote === null) {
            delta = direction === 'up' ? 1 : -1;
          } else {
            delta = direction === 'up' ? 2 : -2;
          }
          return { ...r, votes: r.votes + delta, userVote: nextVote };
        }),
      };
    });
    setPendingVoteId(replyId);

    voteOnReply(post.id, replyId, direction, authToken)
      .catch((err) => {
        setPost((prev) =>
          prev
            ? {
                ...prev,
                replies: prev.replies.map((r) =>
                  r.id === replyId ? { ...r, votes: savedVotes, userVote: savedUserVote } : r,
                ),
              }
            : prev,
        );
        if (!(err instanceof TokenGateError)) {
          setVoteToastError('Vote failed. Please try again.');
          setTimeout(() => setVoteToastError(null), 3500);
        }
      })
      .finally(() => setPendingVoteId(null));
  }

  async function handleReplySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!post || !replyBody.trim() || submittingReply) return;

    if (hasPass === false) {
      setReplyError('Acceptance Pass required to reply.');
      return;
    }
    if (!authToken) {
      setReplyError('You must be signed in to reply.');
      return;
    }

    setSubmittingReply(true);
    setReplyError(null);

    try {
      const reply = await createReply(post.id, replyBody.trim(), authToken);
      setPost((prev) => prev ? { ...prev, replies: [...prev.replies, reply], replyCount: prev.replyCount + 1 } : prev);
      setReplyBody('');
    } catch (err) {
      if (err instanceof TokenGateError) {
        setReplyError('Your wallet does not hold an Acceptance Pass.');
      } else {
        // Mock success while API is in development
        const mockReply: Reply = {
          id: `mock-reply-${Date.now()}`,
          postId: post.id,
          authorWallet: walletAddress ?? '0x0000…',
          body: replyBody.trim(),
          createdAt: new Date().toISOString(),
          votes: 0,
          userVote: null,
        };
        setPost((prev) =>
          prev ? { ...prev, replies: [...prev.replies, mockReply], replyCount: prev.replyCount + 1 } : prev,
        );
        setReplyBody('');
      }
    } finally {
      setSubmittingReply(false);
    }
  }

  const canReply = authenticated && hasPass === true;

  if (!ready || loading) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-screen" style={{ background: '#faf8f3' }}>
        <div className="text-sm" style={{ color: '#9c9080' }}>Loading…</div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen" style={{ background: '#faf8f3' }}>
        <p className="text-sm font-medium" style={{ color: '#3d4f38' }}>Post not found</p>
        <a href="/community" className="mt-3 text-xs" style={{ color: '#7d8c6e' }}>
          ← Back to community
        </a>
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
          <a href="/community" className="flex items-center gap-1.5 text-xs" style={{ color: '#7d8c6e' }}>
            <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Community
          </a>
        </div>
        {walletAddress && hasPass !== null && (
          <span
            className="hidden sm:inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full"
            style={
              hasPass
                ? { background: '#d4e6cc', color: '#3d4f38', border: '1px solid #b8ccb0' }
                : { background: '#f0ece3', color: '#9c9080', border: '1px solid #e0d8cc' }
            }
          >
            {hasPass ? 'Pass holder' : 'Read only'}
          </span>
        )}
      </header>

      {/* Token gate banner */}
      {authenticated && hasPass === false && (
        <div
          className="px-5 py-3 border-b text-xs flex flex-wrap items-center gap-x-3 gap-y-1.5"
          style={{ background: '#fef9ec', borderColor: '#f0d88a', color: '#7a6220' }}
        >
          <span className="flex-1 min-w-0">
            <strong>Read-only mode</strong> — get an Acceptance Pass to reply and vote.
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

      <main id="main-content" className="flex-1 max-w-2xl w-full mx-auto px-4 py-6">
        {/* Post */}
        <article
          className="rounded-2xl px-5 py-5 mb-6"
          style={{ background: '#fff', border: '1px solid #e0d8cc' }}
        >
          <div className="flex gap-3">
            {/* Vote */}
            <div className="flex-shrink-0 pt-1">
              <VoteButton
                votes={post.votes}
                userVote={post.userVote}
                onVote={handlePostVote}
                disabled={!canReply}
                pending={pendingVoteId === 'post'}
              />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold leading-snug mb-3" style={{ color: '#3d4f38' }}>
                {post.title}
              </h1>
              <p
                className="text-sm leading-relaxed mb-4 whitespace-pre-wrap"
                style={{ color: '#2c2c2c', fontFamily: 'Georgia, serif' }}
              >
                {post.body}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: '#b0a898' }}>
                <span>{truncateWallet(post.authorWallet)}</span>
                <span aria-hidden>·</span>
                <span>{formatRelativeTime(post.createdAt)}</span>
                <span aria-hidden>·</span>
                <span>{post.replyCount} {post.replyCount === 1 ? 'reply' : 'replies'}</span>
              </div>
            </div>
          </div>
        </article>

        {/* Replies */}
        {post.replies.length > 0 && (
          <section className="mb-6">
            <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: '#9c9080' }}>
              {post.replies.length} {post.replies.length === 1 ? 'Reply' : 'Replies'}
            </h2>
            <div className="space-y-3">
              {post.replies.map((reply) => (
                <ReplyCard
                  key={reply.id}
                  reply={reply}
                  canVote={canReply}
                  onVote={(dir) => handleReplyVote(reply.id, dir)}
                  pendingVote={pendingVoteId === reply.id}
                />
              ))}
            </div>
          </section>
        )}

        {/* Reply form */}
        <section>
          {!authenticated ? (
            <div
              className="rounded-2xl px-5 py-4 text-sm text-center"
              style={{ background: '#f0ece3', border: '1px solid #ddd5c8' }}
            >
              <p className="text-xs" style={{ color: '#7d8c6e' }}>
                <a href="/login" className="font-medium underline underline-offset-2">Sign in</a>
                {' '}to join the discussion.
              </p>
            </div>
          ) : hasPass === false ? (
            <div
              className="rounded-2xl px-5 py-4"
              style={{ background: '#f0ece3', border: '1px solid #ddd5c8' }}
            >
              <p className="text-xs font-medium mb-1" style={{ color: '#5c5248' }}>
                Get an Acceptance Pass to contribute
              </p>
              <p className="text-xs leading-relaxed mb-3" style={{ color: '#9c9080' }}>
                Only pass holders can reply and vote. You can still read all discussions.
              </p>
              <a
                href="https://opensea.io/collection/acceptance-pass"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium"
                style={{ background: '#7d8c6e', color: '#fff' }}
              >
                <svg aria-hidden="true" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
                Get an Acceptance Pass
              </a>
            </div>
          ) : (
            <form onSubmit={handleReplySubmit}>
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: '#9c9080' }}>
                Your reply
              </h3>
              <div
                className="rounded-2xl px-4 py-3"
                style={{ background: '#fff', border: '1px solid #e0d8cc' }}
              >
                <textarea
                  ref={replyRef}
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value.slice(0, MAX_REPLY))}
                  placeholder="Share your perspective…"
                  rows={4}
                  maxLength={MAX_REPLY}
                  disabled={submittingReply}
                  className="w-full resize-none text-sm leading-relaxed bg-transparent outline-none placeholder-zinc-400"
                  style={{ color: '#2c2c2c', fontFamily: 'Georgia, serif' }}
                />
                {replyBody.length > MAX_REPLY * 0.85 && (
                  <p
                    className="text-xs mt-1"
                    style={{ color: replyBody.length >= MAX_REPLY ? '#c0392b' : '#b0a898' }}
                  >
                    {replyBody.length} / {MAX_REPLY}
                  </p>
                )}
              </div>

              {replyError && (
                <p className="text-xs mt-2 rounded-lg px-3 py-2" style={{ background: '#fde8e6', color: '#c0392b' }}>
                  {replyError}
                </p>
              )}

              <div className="flex justify-end mt-3">
                <button
                  type="submit"
                  disabled={!replyBody.trim() || submittingReply}
                  className="text-xs px-4 min-h-[44px] rounded-full font-medium transition-opacity disabled:opacity-40"
                  style={{ background: '#7d8c6e', color: '#fff' }}
                >
                  {submittingReply ? 'Posting…' : 'Reply'}
                </button>
              </div>
            </form>
          )}
        </section>
      </main>

      {/* Vote error toast */}
      {voteToastError && (
        <div
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-xs font-medium shadow-lg"
          style={{ background: '#3d1a17', color: '#fde8e6', pointerEvents: 'none' }}
        >
          {voteToastError}
        </div>
      )}

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

function ReplyCard({
  reply,
  canVote,
  onVote,
  pendingVote,
}: {
  reply: Reply;
  canVote: boolean;
  onVote: (direction: 'up' | 'down') => void;
  pendingVote: boolean;
}) {
  return (
    <div
      className="rounded-2xl px-4 py-4"
      style={{ background: '#fff', border: '1px solid #e8e0d5' }}
    >
      <div className="flex gap-3">
        {/* Vote */}
        <div className="flex-shrink-0 pt-0.5">
          <VoteButton
            votes={reply.votes}
            userVote={reply.userVote}
            onVote={onVote}
            disabled={!canVote}
            pending={pendingVote}
            size="sm"
          />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p
            className="text-sm leading-relaxed mb-2 whitespace-pre-wrap"
            style={{ color: '#2c2c2c', fontFamily: 'Georgia, serif' }}
          >
            {reply.body}
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" style={{ color: '#b0a898' }}>
            <span>{truncateWallet(reply.authorWallet)}</span>
            <span aria-hidden>·</span>
            <span>{formatRelativeTime(reply.createdAt)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
