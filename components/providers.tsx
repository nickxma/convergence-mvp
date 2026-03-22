'use client';

import { useEffect, useRef, useState } from 'react';
import { PrivyProvider, addRpcUrlOverrideToChain, usePrivy } from '@privy-io/react-auth';
import { track } from '@vercel/analytics';
import { arbitrumSepolia } from 'viem/chains';
import { AuthContext, DEFAULT_AUTH, type AuthState } from '@/lib/auth-context';
import { ThemeProvider } from '@/lib/theme-context';

const rpcUrl =
  process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC ?? 'https://sepolia-rollup.arbitrum.io/rpc';

const arbitrumSepoliaWithRpc = addRpcUrlOverrideToChain(arbitrumSepolia, rpcUrl);

// ── Production bridge: reads real Privy state into AuthContext ───────────────

function PrivyAuthBridge({ children }: { children: React.ReactNode }) {
  const privy = usePrivy();
  const prevAuthenticated = useRef<boolean | null>(null);

  useEffect(() => {
    if (privy.ready && privy.authenticated && prevAuthenticated.current === false) {
      track('wallet_connected');
    }
    if (privy.ready) {
      prevAuthenticated.current = privy.authenticated;
    }
  }, [privy.ready, privy.authenticated]);

  const value: AuthState = {
    ready: privy.ready,
    authenticated: privy.authenticated,
    user: privy.user as AuthState['user'],
    getAccessToken: privy.getAccessToken,
    login: privy.login,
    logout: privy.logout,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ── Test bridge: reads window.__PRIVY_MOCK into AuthContext ──────────────────
// Used when NEXT_PUBLIC_PRIVY_APP_ID is not set (E2E test runs).

interface PrivyMock {
  ready?: boolean;
  authenticated?: boolean;
  user?: AuthState['user'];
  getAccessToken?: () => Promise<string | null>;
  login?: () => void;
  logout?: () => Promise<void>;
}

declare global {
  interface Window {
    __PRIVY_MOCK?: PrivyMock;
  }
}

function MockAuthBridge({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState>(() => {
    if (typeof window !== 'undefined' && window.__PRIVY_MOCK) {
      const m = window.__PRIVY_MOCK;
      return {
        ready: m.ready ?? false,
        authenticated: m.authenticated ?? false,
        user: m.user ?? null,
        getAccessToken: m.getAccessToken ?? DEFAULT_AUTH.getAccessToken,
        login: m.login ?? DEFAULT_AUTH.login,
        logout: m.logout ?? DEFAULT_AUTH.logout,
      };
    }
    return DEFAULT_AUTH;
  });

  useEffect(() => {
    const m = window.__PRIVY_MOCK;
    if (!m) return;
    setAuth({
      ready: m.ready ?? false,
      authenticated: m.authenticated ?? false,
      user: m.user ?? null,
      getAccessToken: m.getAccessToken ?? DEFAULT_AUTH.getAccessToken,
      login: m.login ?? DEFAULT_AUTH.login,
      logout: m.logout ?? DEFAULT_AUTH.logout,
    });
  }, []);

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

// ── Root provider ─────────────────────────────────────────────────────────────

export function Providers({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    // Do not render children before PrivyProvider is set up.
    // Any child calling usePrivy() outside PrivyProvider throws and crashes the page.
    return null;
  }

  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  if (!appId) {
    // No Privy configured — use mock bridge (handles E2E tests via window.__PRIVY_MOCK)
    return (
      <ThemeProvider>
        <MockAuthBridge>{children}</MockAuthBridge>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
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
        <PrivyAuthBridge>{children}</PrivyAuthBridge>
      </PrivyProvider>
    </ThemeProvider>
  );
}
