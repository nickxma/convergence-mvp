'use client';

import { PrivyProvider, addRpcUrlOverrideToChain } from '@privy-io/react-auth';
import { arbitrumSepolia } from 'viem/chains';

const rpcUrl =
  process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC ?? 'https://sepolia-rollup.arbitrum.io/rpc';

const arbitrumSepoliaWithRpc = addRpcUrlOverrideToChain(arbitrumSepolia, rpcUrl);

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
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
