'use client';

// Re-export from auth-context so existing imports keep working.
export { useAuth, AuthContext, DEFAULT_AUTH } from './auth-context';
export type { AuthState } from './auth-context';
