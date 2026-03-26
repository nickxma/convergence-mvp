'use client';

import { createContext, useContext } from 'react';

/**
 * Minimal auth state the community pages need.
 * In production this is populated from Privy; in E2E tests from window.__PRIVY_MOCK.
 */
export interface AuthState {
  ready: boolean;
  authenticated: boolean;
  user: { id?: string; wallet?: { address: string } } | null;
  getAccessToken: () => Promise<string | null>;
}

export const DEFAULT_AUTH: AuthState = {
  ready: false,
  authenticated: false,
  user: null,
  getAccessToken: () => Promise.resolve(null),
};

export const AuthContext = createContext<AuthState>(DEFAULT_AUTH);

/** Reads from AuthContext — populated by Providers (production) or MockAuthBridge (tests). */
export function useAuth(): AuthState {
  return useContext(AuthContext);
}
