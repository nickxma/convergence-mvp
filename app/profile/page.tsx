'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { loadConversations, deleteConversation, type Conversation } from '@/lib/conversations';

interface ReferralStats {
  code: string | null;
  inviteCount: number;
  joinedCount: number;
  referralUrl: string | null;
}

function WalletExplainer() {
  return (
    <div
      className="rounded-2xl p-5 mt-6"
      style={{ background: '#f0ece3', border: '1px solid #ddd5c8' }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5"
          style={{ background: '#e8e0d5' }}
        >
          <svg aria-hidden="true"
            className="w-4 h-4"
            style={{ color: '#7d8c6e' }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
            />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold mb-2" style={{ color: '#3d4f38' }}>
            You have an Ethereum wallet
          </p>
          <p className="text-xs leading-relaxed" style={{ color: '#5c5248' }}>
            When you signed in with email, Convergence automatically created an Ethereum wallet for you
            on the Arbitrum network — a fast, low-cost Ethereum Layer 2. You own this wallet;
            your keys are secured via Privy.
          </p>
          <p className="text-xs leading-relaxed mt-2" style={{ color: '#5c5248' }}>
            Right now the wallet is used to give you a unique on-chain identity. In future versions,
            it will enable token-gated content, on-chain reputation, and other Web3 features.
          </p>
          <a
            href="https://arbitrum.io"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs mt-3 font-medium"
            style={{ color: '#7d8c6e' }}
          >
            Learn about Arbitrum
            <svg aria-hidden="true" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </a>
        </div>
      </div>
    </div>
  );
}

function ConversationStats({ conversations }: { conversations: Conversation[] }) {
  const totalQuestions = conversations.reduce(
    (sum, c) => sum + c.messages.filter((m) => m.role === 'user').length,
    0
  );
  const lastActive = conversations[0]?.updatedAt
    ? new Date(conversations[0].updatedAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })
    : null;

  return (
    <div className="grid grid-cols-3 gap-3 mt-4">
      {[
        { label: 'Conversations', value: conversations.length },
        { label: 'Questions asked', value: totalQuestions },
        { label: 'Last active', value: lastActive ?? '—' },
      ].map(({ label, value }) => (
        <div
          key={label}
          className="rounded-xl p-3 text-center"
          style={{ background: '#f5f1e8', border: '1px solid #e0d8cc' }}
        >
          <p className="text-base font-semibold" style={{ color: '#3d4f38' }}>
            {value}
          </p>
          <p className="text-xs mt-0.5" style={{ color: '#9c9080' }}>
            {label}
          </p>
        </div>
      ))}
    </div>
  );
}

export default function ProfilePage() {
  const { ready, authenticated, user, logout, getAccessToken } = usePrivy();
  const router = useRouter();

  const userId = user?.id ?? null;
  const email = user?.email?.address ?? null;
  const walletAddress = user?.wallet?.address ?? null;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [copied, setCopied] = useState(false);
  const [referralStats, setReferralStats] = useState<ReferralStats | null>(null);
  const [refUrlCopied, setRefUrlCopied] = useState(false);

  useEffect(() => {
    if (ready && !authenticated) {
      router.replace('/');
    }
  }, [ready, authenticated, router]);

  useEffect(() => {
    if (userId) {
      setConversations(loadConversations(userId));
    }
  }, [userId]);

  // Fetch referral stats + attempt to record conversion if ref cookie is present
  useEffect(() => {
    if (!authenticated) return;

    void (async () => {
      try {
        const accessToken = await getAccessToken();
        if (!accessToken) return;
        const headers = { Authorization: `Bearer ${accessToken}` };

        // Attempt conversion (idempotent — server checks for ref cookie)
        fetch('/api/referral/convert', { method: 'POST', headers, credentials: 'include' }).catch(() => null);

        // Fetch referral code + stats in parallel
        const [codeRes, statsRes] = await Promise.all([
          fetch('/api/referral', { headers }),
          fetch('/api/referral/stats', { headers }),
        ]);

        const codeData = codeRes.ok ? await codeRes.json() : null;
        const statsData = statsRes.ok ? await statsRes.json() : null;

        setReferralStats({
          code: codeData?.code ?? statsData?.code ?? null,
          inviteCount: statsData?.inviteCount ?? 0,
          joinedCount: statsData?.joinedCount ?? 0,
          referralUrl: codeData?.referralUrl ?? null,
        });
      } catch {
        // Non-critical — swallow silently
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  function copyReferralUrl() {
    if (!referralStats?.referralUrl) return;
    navigator.clipboard.writeText(referralStats.referralUrl).then(() => {
      setRefUrlCopied(true);
      setTimeout(() => setRefUrlCopied(false), 2000);
    });
  }

  function twitterShareUrl() {
    if (!referralStats?.referralUrl) return '#';
    const text = encodeURIComponent(
      `I've been using this Waking Up Q&A — try it free: ${referralStats.referralUrl}`,
    );
    return `https://twitter.com/intent/tweet?text=${text}`;
  }

  function copyAddress() {
    if (!walletAddress) return;
    navigator.clipboard.writeText(walletAddress).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleDeleteConversation(id: string) {
    if (!userId) return;
    deleteConversation(userId, id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
  }

  if (!ready || !authenticated) {
    return (
      <div className="flex flex-1 items-center justify-center" style={{ background: '#faf8f3' }}>
        <div className="text-sm" style={{ color: '#9c9080' }}>Loading…</div>
      </div>
    );
  }

  const shortAddress = walletAddress
    ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`
    : null;

  return (
    <div className="flex flex-col min-h-full" style={{ background: '#faf8f3' }}>
      {/* Header */}
      <header
        className="flex items-center justify-between px-5 py-3 border-b flex-shrink-0"
        style={{ borderColor: '#e0d8cc', background: '#faf8f3' }}
      >
        <div className="flex items-center gap-3">
          <a
            href="/"
            className="flex items-center gap-1.5 text-xs min-h-[44px]"
            style={{ color: '#7d8c6e' }}
          >
            <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Back
          </a>
          <span className="text-sm font-semibold tracking-tight" style={{ color: '#3d4f38' }}>
            Profile
          </span>
        </div>
        <button
          onClick={logout}
          className="text-xs px-3 min-h-[44px] inline-flex items-center rounded-full border transition-colors"
          style={{ borderColor: '#e0d8cc', color: '#7d8c6e' }}
        >
          Sign out
        </button>
      </header>

      <main id="main-content" className="flex-1 px-5 py-8 max-w-lg mx-auto w-full">
        {/* Identity section */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-semibold"
              style={{ background: '#e8e0d5', color: '#5a6b52' }}
            >
              {email ? email[0].toUpperCase() : '?'}
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: '#2c2c2c' }}>
                {email ?? 'Unknown'}
              </p>
              <p className="text-xs mt-0.5" style={{ color: '#9c9080' }}>
                Convergence member
              </p>
            </div>
          </div>

          {/* Wallet address */}
          {walletAddress && (
            <div
              className="rounded-xl px-4 py-3 flex items-center justify-between gap-3"
              style={{ background: '#f5f1e8', border: '1px solid #e0d8cc' }}
            >
              <div className="min-w-0">
                <p className="text-xs font-medium mb-0.5" style={{ color: '#7d8c6e' }}>
                  Ethereum wallet · Arbitrum
                </p>
                <p
                  className="text-xs font-mono truncate"
                  style={{ color: '#3d4f38' }}
                  title={walletAddress}
                >
                  {walletAddress}
                </p>
              </div>
              <button
                onClick={copyAddress}
                className="flex-shrink-0 flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg transition-colors"
                style={{
                  background: copied ? '#b8ccb0' : '#e8e0d5',
                  color: copied ? '#fff' : '#5a6b52',
                }}
              >
                {copied ? (
                  <>
                    <svg aria-hidden="true" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                    Copied
                  </>
                ) : (
                  <>
                    <svg aria-hidden="true" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
                    </svg>
                    Copy
                  </>
                )}
              </button>
            </div>
          )}

          <WalletExplainer />
        </section>

        {/* Activity section */}
        <section className="mt-10">
          <h2 className="text-sm font-semibold mb-1" style={{ color: '#3d4f38' }}>
            Your activity
          </h2>
          <ConversationStats conversations={conversations} />
        </section>

        {/* Referral — invite a friend */}
        <section className="mt-10">
          <h2 className="text-sm font-semibold mb-3" style={{ color: '#3d4f38' }}>
            Invite a friend
          </h2>

          {/* Stats card */}
          {referralStats && referralStats.joinedCount > 0 && (
            <div
              className="rounded-xl px-4 py-3 mb-3 flex items-center gap-4"
              style={{ background: '#eef4ea', border: '1px solid #c8dcbe' }}
            >
              <div className="text-center">
                <p className="text-base font-semibold" style={{ color: '#3d5c34' }}>
                  {referralStats.inviteCount}
                </p>
                <p className="text-xs mt-0.5" style={{ color: '#5a7a50' }}>
                  invited
                </p>
              </div>
              <div className="w-px self-stretch" style={{ background: '#c8dcbe' }} />
              <div className="text-center">
                <p className="text-base font-semibold" style={{ color: '#3d5c34' }}>
                  {referralStats.joinedCount}
                </p>
                <p className="text-xs mt-0.5" style={{ color: '#5a7a50' }}>
                  joined
                </p>
              </div>
            </div>
          )}

          {/* Share link */}
          {referralStats?.referralUrl ? (
            <div
              className="rounded-xl px-4 py-3"
              style={{ background: '#f5f1e8', border: '1px solid #e0d8cc' }}
            >
              <p className="text-xs mb-2" style={{ color: '#7d8c6e' }}>
                Your invite link
              </p>
              <div className="flex items-center gap-2">
                <p
                  className="flex-1 text-xs font-mono truncate"
                  style={{ color: '#3d4f38' }}
                  title={referralStats.referralUrl}
                >
                  {referralStats.referralUrl}
                </p>
                <button
                  onClick={copyReferralUrl}
                  className="flex-shrink-0 flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg transition-colors"
                  style={{
                    background: refUrlCopied ? '#b8ccb0' : '#e8e0d5',
                    color: refUrlCopied ? '#fff' : '#5a6b52',
                  }}
                >
                  {refUrlCopied ? (
                    <>
                      <svg aria-hidden="true" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                      Copied
                    </>
                  ) : (
                    <>
                      <svg aria-hidden="true" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
                      </svg>
                      Copy
                    </>
                  )}
                </button>
              </div>
              <a
                href={twitterShareUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium transition-colors"
                style={{ color: '#7d8c6e' }}
              >
                <svg aria-hidden="true" className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.26 5.632zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                Share on X
              </a>
            </div>
          ) : (
            <div
              className="rounded-xl px-4 py-3"
              style={{ background: '#f5f1e8', border: '1px solid #e0d8cc' }}
            >
              <p className="text-xs" style={{ color: '#9c9080' }}>Loading your invite link…</p>
            </div>
          )}
        </section>

        {/* Conversation history */}
        {conversations.length > 0 && (
          <section className="mt-10">
            <h2 className="text-sm font-semibold mb-3" style={{ color: '#3d4f38' }}>
              Past conversations
            </h2>
            <div className="space-y-2">
              {conversations.map((c) => (
                <div
                  key={c.id}
                  className="group flex items-start justify-between gap-3 rounded-xl px-4 py-3"
                  style={{ background: '#f5f1e8', border: '1px solid #e0d8cc' }}
                >
                  <a href="/" className="flex-1 min-w-0 block" onClick={() => {}}>
                    <p className="text-xs font-medium leading-snug" style={{ color: '#3d4f38' }}>
                      {c.title}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: '#9c9080' }}>
                      {c.messages.filter((m) => m.role === 'user').length} question
                      {c.messages.filter((m) => m.role === 'user').length !== 1 ? 's' : ''} ·{' '}
                      {new Date(c.updatedAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </p>
                  </a>
                  <button
                    onClick={() => handleDeleteConversation(c.id)}
                    className="flex-shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center rounded transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
                    style={{ color: '#9c9080' }}
                    aria-label={`Delete conversation: ${c.title}`}
                  >
                    <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
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
