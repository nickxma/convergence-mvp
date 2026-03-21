'use client';

import { useEffect, useState } from 'react';
import { PrivyProvider, addRpcUrlOverrideToChain } from '@privy-io/react-auth';
import { arbitrumSepolia } from 'viem/chains';

const rpcUrl =
  process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC ?? 'https://sepolia-rollup.arbitrum.io/rpc';

const arbitrumSepoliaWithRpc = addRpcUrlOverrideToChain(arbitrumSepolia, rpcUrl);

export function Providers({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <>{children}</>;
  }

  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) {
    return <>{children}</>;
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        defaultChain: arbitrumSepoliaWithRpc,
        supportedChains: [arbitrumSepoliaWithRpc],
        loginMethods: ['email'],
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'users-without-wallets',
          },
        },
        appearance: {
          theme: 'light',
          accentColor: '#7d8c6e',
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
