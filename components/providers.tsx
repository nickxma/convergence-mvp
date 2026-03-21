'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { arbitrumSepolia } from 'viem/chains';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        defaultChain: arbitrumSepolia,
        supportedChains: [arbitrumSepolia],
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
