'use client';

import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function AuthStatus() {
  const { ready, authenticated, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const router = useRouter();

  useEffect(() => {
    if (ready && !authenticated) {
      router.push('/login');
    }
  }, [ready, authenticated, router]);

  if (!ready || !authenticated) {
    return <div className="text-sm text-zinc-400">Loading...</div>;
  }

  const embeddedWallet = wallets.find((w) => w.walletClientType === 'privy');

  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Convergence</h1>
        <p className="text-sm text-zinc-500">Mindfulness knowledge platform</p>
      </div>

      <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-4 space-y-3 text-sm">
        <div>
          <span className="text-zinc-400">Email</span>
          <p className="font-mono text-xs mt-0.5">{user?.email?.address ?? '—'}</p>
        </div>
        {embeddedWallet && (
          <div>
            <span className="text-zinc-400">Embedded wallet (Arbitrum Sepolia)</span>
            <p className="font-mono text-xs mt-0.5 truncate">{embeddedWallet.address}</p>
          </div>
        )}
      </div>

      <button
        onClick={logout}
        className="w-full rounded-full border border-zinc-200 px-5 py-3 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50"
      >
        Sign out
      </button>
    </div>
  );
}
