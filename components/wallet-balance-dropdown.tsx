'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPublicClient, http, formatEther, formatUnits, type Address } from 'viem';
import { arbitrumSepolia } from 'viem/chains';

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const;

const CACHE_TTL_MS = 60_000;

type AccessTier = 'full' | 'subscriber' | 'guest';
type SubscriptionTier = 'free' | 'pro' | 'team';

interface BalanceData {
  ethBalance: string;
  tokenBalance: string;
  accessTier: AccessTier;
  subscriptionTier: SubscriptionTier;
  fetchedAt: number;
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

const TIER_STYLE: Record<AccessTier, { background: string; color: string }> = {
  full: { background: '#dcfce7', color: '#15803d' },
  subscriber: { background: '#dbeafe', color: '#1d4ed8' },
  guest: { background: 'var(--bg-chip)', color: 'var(--text-muted)' },
};

const TIER_LABEL: Record<AccessTier, string> = {
  full: 'Access: Full',
  subscriber: 'Access: Subscriber',
  guest: 'Access: Guest',
};

export function WalletBalanceDropdown({
  walletAddress,
  getAccessToken,
}: {
  walletAddress: string;
  getAccessToken: () => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<BalanceData | null>(null);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchBalances = useCallback(async () => {
    setLoading(true);
    try {
      const tokenContractAddress = process.env
        .NEXT_PUBLIC_TOKEN_CONTRACT_ADDRESS as Address | undefined;
      const requiredAmount = Number(process.env.NEXT_PUBLIC_REQUIRED_TOKEN_AMOUNT ?? '0');
      const rpcUrl =
        process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC ??
        'https://sepolia-rollup.arbitrum.io/rpc';

      const client = createPublicClient({
        chain: arbitrumSepolia,
        transport: http(rpcUrl),
      });

      let ethDisplay = '---';
      let tokenDisplay = '---';
      let tokenAmount = 0;
      let isSubscriber = false;
      let subscriptionTier: SubscriptionTier = 'free';

      // ETH balance
      try {
        const raw = await client.getBalance({ address: walletAddress as Address });
        ethDisplay = `${parseFloat(formatEther(raw)).toFixed(4)} ETH`;
      } catch {
        ethDisplay = '---';
      }

      // Token balance
      if (tokenContractAddress) {
        try {
          const [rawBalance, decimals] = await Promise.all([
            client.readContract({
              address: tokenContractAddress,
              abi: ERC20_ABI,
              functionName: 'balanceOf',
              args: [walletAddress as Address],
            }),
            client.readContract({
              address: tokenContractAddress,
              abi: ERC20_ABI,
              functionName: 'decimals',
            }),
          ]);
          tokenAmount = parseFloat(formatUnits(rawBalance as bigint, decimals as number));
          tokenDisplay = `${tokenAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} tokens`;
        } catch {
          tokenDisplay = '---';
        }
      }

      // Subscription tier (from /api/subscriptions/me)
      try {
        const token = await getAccessToken();
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch('/api/subscriptions/me', { headers });
        if (res.ok) {
          const json = await res.json();
          subscriptionTier = (json.tier as SubscriptionTier) ?? 'free';
          isSubscriber = subscriptionTier === 'pro' || subscriptionTier === 'team';
        }
      } catch {
        // ignore — treat as free tier
      }

      // Access tier
      let accessTier: AccessTier = 'guest';
      if (requiredAmount > 0 && tokenAmount >= requiredAmount) {
        accessTier = 'full';
      } else if (isSubscriber) {
        accessTier = 'subscriber';
      }

      setData({ ethBalance: ethDisplay, tokenBalance: tokenDisplay, accessTier, subscriptionTier, fetchedAt: Date.now() });
    } finally {
      setLoading(false);
    }
  }, [walletAddress, getAccessToken]);

  // Fetch when dropdown opens (respect 60s cache)
  useEffect(() => {
    if (!open) return;
    if (data && Date.now() - data.fetchedAt < CACHE_TTL_MS) return;
    fetchBalances();
  }, [open, data, fetchBalances]);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const tier = data?.accessTier ?? 'guest';
  const isPro = data?.subscriptionTier === 'pro' || data?.subscriptionTier === 'team';

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="hidden sm:flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors flex-shrink-0"
        style={{ borderColor: 'var(--border)', color: 'var(--sage)' }}
        aria-label="Wallet balance"
        aria-expanded={open}
        aria-haspopup="true"
      >
        {/* Wallet icon */}
        <svg aria-hidden="true" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 0 0-2.25-2.25H15a3 3 0 1 1-6 0H5.25A2.25 2.25 0 0 1 3 12m18 0v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6m18 0V9M3 12V9m18-3a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 9m18 0V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v3" />
        </svg>
        {truncateAddress(walletAddress)}
        {isPro && (
          <span
            className="text-[10px] font-bold px-1 py-0.5 rounded"
            style={{ background: '#7c3aed', color: '#fff', letterSpacing: '0.04em' }}
          >
            PRO
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1.5 z-50 rounded-xl border shadow-lg p-3 w-52"
          style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
        >
          {/* Full address */}
          <p
            className="font-mono text-xs truncate pb-2 border-b"
            style={{ color: 'var(--text-muted)', borderColor: 'var(--border)' }}
          >
            {walletAddress}
          </p>

          <div className="pt-2 space-y-1.5">
            {/* ETH balance */}
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>ETH</span>
              {loading ? (
                <span
                  className="h-3 w-16 rounded animate-pulse"
                  style={{ background: 'var(--bg-chip)', display: 'inline-block' }}
                />
              ) : (
                <span className="text-xs font-medium tabular-nums" style={{ color: 'var(--sage-dark)' }}>
                  {data?.ethBalance ?? '---'}
                </span>
              )}
            </div>

            {/* Token balance */}
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Tokens</span>
              {loading ? (
                <span
                  className="h-3 w-16 rounded animate-pulse"
                  style={{ background: 'var(--bg-chip)', display: 'inline-block' }}
                />
              ) : (
                <span className="text-xs font-medium tabular-nums" style={{ color: 'var(--sage-dark)' }}>
                  {data?.tokenBalance ?? '---'}
                </span>
              )}
            </div>

            {/* Access tier / Pro badge */}
            <div className="pt-0.5 flex items-center gap-1.5">
              {loading ? (
                <span
                  className="h-5 w-28 rounded-full animate-pulse inline-block"
                  style={{ background: 'var(--bg-chip)' }}
                />
              ) : (
                <>
                  <span
                    className="inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium"
                    style={TIER_STYLE[tier]}
                  >
                    {TIER_LABEL[tier]}
                  </span>
                  {isPro && (
                    <span
                      className="inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded"
                      style={{ background: '#7c3aed', color: '#fff', letterSpacing: '0.04em' }}
                    >
                      PRO
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
