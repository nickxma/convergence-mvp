'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { loadConversations, deleteConversation, type Conversation } from '@/lib/conversations';

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
          <svg
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
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
        month: 'long',
        day: 'numeric',
        year: 'numeric',
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
          <p className="text-lg font-semibold" style={{ color: '#3d4f38' }}>
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

// ── Vote Delegation ────────────────────────────────────────────────────────

interface DelegateInfo {
  walletAddress: string;
  username?: string;
  tokenWeight: number;
}

interface MemberSearchResult {
  walletAddress: string;
  username?: string;
  tokenBalance: number;
  recentVoteCount: number;
}

function DelegateModal({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (query: string) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [member, setMember] = useState<MemberSearchResult | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function doSearch(e: FormEvent) {
    e.preventDefault();
    const q = search.trim();
    if (!q) return;
    setSearchLoading(true);
    setSearchError(null);
    setMember(null);
    try {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) {
        setSearchError('Member not found.');
        return;
      }
      const data = await res.json() as MemberSearchResult;
      setMember(data);
    } catch {
      setSearchError('Search failed. Try again.');
    } finally {
      setSearchLoading(false);
    }
  }

  async function handleConfirm() {
    const q = search.trim();
    if (!q) return;
    setConfirming(true);
    try {
      await onConfirm(q);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.25)' }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Delegate voting power"
      >
        <div
          className="w-full max-w-sm rounded-2xl p-6 flex flex-col gap-5"
          style={{ background: '#faf8f3', border: '1px solid #e0d8cc', boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold" style={{ color: '#2c2c2c' }}>Delegate voting power</h2>
            <button
              onClick={onClose}
              className="w-7 h-7 rounded flex items-center justify-center hover:bg-[#f0ece3]"
              style={{ color: '#7d8c6e' }}
              aria-label="Close"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <p className="text-xs" style={{ color: '#7d8c6e' }}>
            Enter a username or wallet address to search for a member. Your voting weight will be added to theirs for governance proposals.
          </p>

          <form onSubmit={doSearch} className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Username or 0x address…"
              className="flex-1 rounded-xl px-3 py-2 text-sm outline-none"
              style={{
                background: '#f0ece3',
                border: '1px solid #ddd5c8',
                color: '#2c2c2c',
              }}
            />
            <button
              type="submit"
              disabled={!search.trim() || searchLoading}
              className="px-3 py-2 rounded-xl text-xs font-medium transition-opacity disabled:opacity-40"
              style={{ background: '#7d8c6e', color: '#fff' }}
            >
              {searchLoading ? '…' : 'Search'}
            </button>
          </form>

          {searchError && (
            <p className="text-xs" style={{ color: '#c0392b' }}>{searchError}</p>
          )}

          {member && (
            <div
              className="rounded-xl p-3"
              style={{ background: '#f0ece3', border: '1px solid #ddd5c8' }}
            >
              <p className="text-xs font-semibold mb-1" style={{ color: '#3d4f38' }}>
                {member.username ?? member.walletAddress.slice(0, 8) + '…' + member.walletAddress.slice(-4)}
              </p>
              <div className="flex gap-4">
                <span className="text-xs" style={{ color: '#7d8c6e' }}>
                  Token balance: <strong>{member.tokenBalance.toLocaleString()}</strong>
                </span>
                <span className="text-xs" style={{ color: '#7d8c6e' }}>
                  Recent votes: <strong>{member.recentVoteCount}</strong>
                </span>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 py-2 rounded-xl text-xs font-medium"
              style={{ background: '#f0ece3', color: '#5c5248' }}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!search.trim() || confirming}
              className="flex-1 py-2 rounded-xl text-xs font-medium transition-opacity disabled:opacity-40"
              style={{ background: '#7d8c6e', color: '#fff' }}
            >
              {confirming ? 'Delegating…' : 'Confirm delegation'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function DelegationSection({ getAccessToken }: { getAccessToken: () => Promise<string | null> }) {
  const [delegate, setDelegate] = useState<DelegateInfo | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const token = await getAccessToken();
        const res = await fetch('/api/users/me/delegate', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) {
          setDelegate(null);
          return;
        }
        const data = await res.json() as { delegate: DelegateInfo | null };
        setDelegate(data.delegate);
      } catch {
        setDelegate(null);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleDelegate(query: string) {
    setError(null);
    const token = await getAccessToken();
    const res = await fetch('/api/users/me/delegate', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ delegateTo: query }),
    });
    if (!res.ok) {
      const msg = await res.json().then((d: { error?: string }) => d.error).catch(() => null);
      throw new Error(msg ?? 'Delegation failed');
    }
    const data = await res.json() as { delegate: DelegateInfo | null };
    setDelegate(data.delegate);
    setModalOpen(false);
  }

  async function handleRevoke() {
    setRevoking(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch('/api/users/me/delegate', {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Revoke failed');
      setDelegate(null);
    } catch {
      setError('Failed to revoke. Please try again.');
    } finally {
      setRevoking(false);
    }
  }

  return (
    <>
      <section className="mt-10">
        <h2 className="text-sm font-semibold mb-1" style={{ color: '#3d4f38' }}>
          Vote delegation
        </h2>
        <p className="text-xs mb-4" style={{ color: '#9c9080' }}>
          Delegate your governance voting power to a trusted member.
        </p>

        {loading ? (
          <div className="h-16 rounded-xl animate-pulse" style={{ background: '#f5f1e8' }} />
        ) : delegate ? (
          <div
            className="rounded-xl px-4 py-4 flex items-start justify-between gap-3"
            style={{ background: '#f5f1e8', border: '1px solid #e0d8cc' }}
          >
            <div>
              <p className="text-xs font-medium mb-0.5" style={{ color: '#7d8c6e' }}>
                Delegating to
              </p>
              <p className="text-sm font-semibold" style={{ color: '#3d4f38' }}>
                {delegate.username ?? (delegate.walletAddress.slice(0, 8) + '…' + delegate.walletAddress.slice(-4))}
              </p>
              <p className="text-xs mt-0.5" style={{ color: '#9c9080' }}>
                Combined weight: {delegate.tokenWeight.toLocaleString()}
              </p>
            </div>
            <button
              onClick={handleRevoke}
              disabled={revoking}
              className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity disabled:opacity-40"
              style={{ background: '#f0ece3', color: '#c0392b', border: '1px solid #f5c6c0' }}
            >
              {revoking ? 'Revoking…' : 'Revoke'}
            </button>
          </div>
        ) : (
          <div
            className="rounded-xl px-4 py-4 flex items-center justify-between"
            style={{ background: '#f5f1e8', border: '1px solid #e0d8cc' }}
          >
            <p className="text-xs" style={{ color: '#9c9080' }}>
              Not delegating — your vote counts directly.
            </p>
            <button
              onClick={() => setModalOpen(true)}
              className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{ background: '#7d8c6e', color: '#fff' }}
            >
              Delegate
            </button>
          </div>
        )}

        {error && (
          <p className="text-xs mt-2" style={{ color: '#c0392b' }}>{error}</p>
        )}
      </section>

      {modalOpen && (
        <DelegateModal
          onClose={() => setModalOpen(false)}
          onConfirm={handleDelegate}
        />
      )}
    </>
  );
}

// ── Linked Wallets ──────────────────────────────────────────────────────────────

interface LinkedWallet {
  address: string;
  chain_id: number;
  is_primary: boolean;
  verified_at: string;
}

function LinkedWalletsSection({
  getAccessToken,
  embeddedAddress,
}: {
  getAccessToken: () => Promise<string | null>;
  embeddedAddress: string | null;
}) {
  const { linkWallet, unlinkWallet } = usePrivy();
  const [wallets, setWallets] = useState<LinkedWallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const fetchWallets = useCallback(async () => {
    const token = await getAccessToken();
    const res = await fetch('/api/users/me/wallets', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return;
    const data = (await res.json()) as { wallets: LinkedWallet[] };
    setWallets(data.wallets);
  }, [getAccessToken]);

  // Seed the embedded wallet on mount so it always appears.
  useEffect(() => {
    async function init() {
      if (!embeddedAddress) { setLoading(false); return; }
      try {
        const token = await getAccessToken();
        await fetch('/api/users/me/wallets', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ address: embeddedAddress }),
        });
        await fetchWallets();
      } catch {
        // ignore seed errors
      } finally {
        setLoading(false);
      }
    }
    void init();
  }, [embeddedAddress]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleLinkWallet() {
    setLinking(true);
    setError(null);
    try {
      linkWallet();
      // After Privy's modal closes, the user's linkedAccounts will include the new wallet.
      // We poll once after a short delay to pick it up, then sync to our backend.
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await fetchWallets();
    } catch {
      setError('Failed to link wallet. Please try again.');
    } finally {
      setLinking(false);
    }
  }

  async function handleSetPrimary(address: string) {
    setActionInProgress(address);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/users/me/wallets/${address}/set-primary`, {
        method: 'PATCH',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(d.error?.message ?? 'Failed to set primary.');
      }
      await fetchWallets();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to set primary wallet.');
    } finally {
      setActionInProgress(null);
    }
  }

  async function handleRemove(address: string) {
    setActionInProgress(address);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/users/me/wallets/${address}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(d.error?.message ?? 'Failed to remove wallet.');
      }
      // Also unlink from Privy (best-effort; embedded wallet cannot be unlinked)
      try { await unlinkWallet(address); } catch { /* ignore — embedded wallets can't be unlinked */ }
      await fetchWallets();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove wallet.');
    } finally {
      setActionInProgress(null);
    }
  }

  const short = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold" style={{ color: '#3d4f38' }}>
          Linked wallets
        </h2>
        <button
          onClick={handleLinkWallet}
          disabled={linking}
          className="text-xs px-3 py-1.5 rounded-lg font-medium transition-opacity disabled:opacity-40"
          style={{ background: '#7d8c6e', color: '#fff' }}
        >
          {linking ? 'Connecting…' : '+ Add wallet'}
        </button>
      </div>
      <p className="text-xs mb-4" style={{ color: '#9c9080' }}>
        Link additional wallets to aggregate token balances for access and governance.
      </p>

      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background: '#f5f1e8' }} />
          ))}
        </div>
      ) : wallets.length === 0 ? (
        <div
          className="rounded-xl px-4 py-4 text-center"
          style={{ background: '#f5f1e8', border: '1px solid #e0d8cc' }}
        >
          <p className="text-xs" style={{ color: '#9c9080' }}>No wallets linked yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {wallets.map((w) => (
            <div
              key={w.address}
              className="rounded-xl px-4 py-3 flex items-center justify-between gap-3"
              style={{ background: '#f5f1e8', border: '1px solid #e0d8cc' }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p
                    className="text-xs font-mono truncate"
                    style={{ color: '#3d4f38' }}
                    title={w.address}
                  >
                    {short(w.address)}
                  </p>
                  {w.is_primary && (
                    <span
                      className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded font-medium"
                      style={{ background: '#b8ccb0', color: '#3d4f38' }}
                    >
                      Primary
                    </span>
                  )}
                </div>
                <p className="text-xs mt-0.5" style={{ color: '#9c9080' }}>
                  Arbitrum · verified {new Date(w.verified_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {!w.is_primary && (
                  <button
                    onClick={() => handleSetPrimary(w.address)}
                    disabled={actionInProgress === w.address}
                    className="text-xs px-2 py-1 rounded-lg transition-opacity disabled:opacity-40"
                    style={{ background: '#e8e0d5', color: '#5a6b52' }}
                  >
                    Set primary
                  </button>
                )}
                {!w.is_primary && (
                  <button
                    onClick={() => handleRemove(w.address)}
                    disabled={actionInProgress === w.address}
                    className="text-xs px-2 py-1 rounded-lg transition-opacity disabled:opacity-40"
                    style={{ background: '#f5ece8', color: '#c0392b', border: '1px solid #f5c6c0' }}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="text-xs mt-2" style={{ color: '#c0392b' }}>{error}</p>
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const { ready, authenticated, user, logout, getAccessToken } = usePrivy();
  const router = useRouter();

  const userId = user?.id ?? null;
  const email = user?.email?.address ?? null;
  const walletAddress = user?.wallet?.address ?? null;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [copied, setCopied] = useState(false);

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
            className="flex items-center gap-1.5 text-xs"
            style={{ color: '#7d8c6e' }}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
          className="text-xs px-3 py-1.5 rounded-full border transition-colors"
          style={{ borderColor: '#e0d8cc', color: '#7d8c6e' }}
        >
          Sign out
        </button>
      </header>

      <main className="flex-1 px-5 py-8 max-w-lg mx-auto w-full">
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
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                    Copied
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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

        <DelegationSection getAccessToken={getAccessToken} />

        <LinkedWalletsSection
          getAccessToken={getAccessToken}
          embeddedAddress={walletAddress}
        />

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
                    className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-1 rounded transition-opacity"
                    style={{ color: '#9c9080' }}
                    aria-label="Delete"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
