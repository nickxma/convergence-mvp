'use client';

/**
 * CreditBalance
 *
 * Fetches and displays the current user's play credit balance.
 * Renders nothing if unauthenticated or balance is unavailable.
 * Shows a link to /credits when balance is low (< 2).
 *
 * Usage:
 *   <CreditBalance />           — inline chip for nav
 *   <CreditBalance variant="full" /> — full row for play page
 */

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/use-auth';
import Link from 'next/link';

interface CreditBalanceProps {
  variant?: 'chip' | 'full';
}

export function CreditBalance({ variant = 'chip' }: CreditBalanceProps) {
  const { authenticated, getAccessToken } = useAuth();
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;

    async function load() {
      try {
        const token = await getAccessToken();
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch('/api/users/me/credits', { headers });
        if (res.ok && !cancelled) {
          const data = await res.json() as { balance: number };
          setBalance(data.balance);
        }
      } catch {
        // non-critical
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [authenticated, getAccessToken]);

  if (!authenticated || balance === null) return null;

  if (variant === 'chip') {
    return (
      <Link
        href="/credits"
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
        style={{
          background: balance < 2 ? 'var(--warn-bg)' : 'var(--bg-chip)',
          color: balance < 2 ? 'var(--warn-text)' : 'var(--sage-dark)',
          border: `1px solid ${balance < 2 ? 'var(--warn-border)' : 'var(--border)'}`,
          textDecoration: 'none',
        }}
        title="Play credits — click to buy more"
      >
        {/* Token icon */}
        <svg
          aria-hidden="true"
          className="w-3.5 h-3.5 flex-shrink-0"
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <circle cx="8" cy="8" r="7" opacity={0.2} />
          <text x="8" y="11.5" textAnchor="middle" fontSize="8" fontWeight="bold">C</text>
        </svg>
        <span className="tabular-nums">{balance}</span>
        {balance < 2 && (
          <span className="text-[10px] opacity-80">low</span>
        )}
      </Link>
    );
  }

  // variant === 'full'
  return (
    <div
      className="flex items-center justify-between px-4 py-3 rounded-xl"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>
          Play credits
        </span>
        <span
          className="text-lg font-bold tabular-nums"
          style={{ color: balance === 0 ? 'var(--warn-text)' : 'var(--sage-dark)' }}
        >
          {balance}
        </span>
      </div>
      <Link
        href="/credits"
        className="text-xs font-medium px-3 py-1.5 rounded-lg"
        style={{
          background: balance === 0 ? 'var(--sage)' : 'var(--bg-chip)',
          color: balance === 0 ? '#fff' : 'var(--sage-dark)',
          textDecoration: 'none',
        }}
      >
        {balance === 0 ? 'Buy credits' : 'Top up'}
      </Link>
    </div>
  );
}
