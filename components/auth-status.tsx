'use client';

import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;

function ChainBadge({ chainId }: { chainId: number | undefined }) {
  const isCorrectChain = chainId === ARBITRUM_SEPOLIA_CHAIN_ID;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        isCorrectChain
          ? 'bg-green-50 text-green-700'
          : 'bg-amber-50 text-amber-700'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          isCorrectChain ? 'bg-green-500' : 'bg-amber-500'
        }`}
      />
      {isCorrectChain ? 'Arbitrum Sepolia' : chainId ? `Chain ${chainId}` : 'Not connected'}
    </span>
  );
}

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
  const chainId = embeddedWallet?.chainId
    ? parseInt(embeddedWallet.chainId.replace('eip155:', ''), 10)
    : undefined;

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
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">Wallet</span>
              <ChainBadge chainId={chainId} />
            </div>
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
