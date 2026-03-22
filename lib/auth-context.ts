'use client';

import { createContext, useContext } from 'react';

/**
 * Minimal auth state shared across all pages.
 * In production this is populated from Privy; in E2E tests from window.__PRIVY_MOCK.
 */
export interface AuthState {
  ready: boolean;
  authenticated: boolean;
  user: { id?: string; wallet?: { address: string }; email?: { address: string } } | null;
  getAccessToken: () => Promise<string | null>;
  login: () => void;
  logout: () => Promise<void>;
}

export const DEFAULT_AUTH: AuthState = {
  ready: false,
  authenticated: false,
  user: null,
  getAccessToken: () => Promise.resolve(null),
  login: () => {},
  logout: () => Promise.resolve(),
};

export const AuthContext = createContext<AuthState>(DEFAULT_AUTH);

/** Reads from AuthContext — populated by Providers (production) or MockAuthBridge (tests). */
export function useAuth(): AuthState {
  return useContext(AuthContext);
}
