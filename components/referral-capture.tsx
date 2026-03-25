'use client';

/**
 * ReferralCapture
 *
 * Invisible component mounted in the root layout.
 * Reads the `ref` query param from the URL, persists it in localStorage,
 * and registers the referral via POST /api/referrals/register once the
 * user is authenticated.
 *
 * Registration is idempotent (the server no-ops if already referred).
 * After successful registration (or a definitive failure), the stored
 * ref code is cleared so we don't keep retrying.
 */

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/use-auth';

const STORAGE_KEY = 'olu_ref';

export function ReferralCapture() {
  const params = useSearchParams();
  const { authenticated, getAccessToken } = useAuth();

  // Step 1: persist ref code from URL into localStorage
  useEffect(() => {
    const code = params.get('ref');
    if (code && /^[A-Z0-9]{4,12}$/i.test(code)) {
      try {
        localStorage.setItem(STORAGE_KEY, code.toUpperCase());
      } catch {
        // storage unavailable — skip
      }
    }
  }, [params]);

  // Step 2: register once authenticated
  useEffect(() => {
    if (!authenticated) return;

    let code: string | null = null;
    try {
      code = localStorage.getItem(STORAGE_KEY);
    } catch {
      return;
    }
    if (!code) return;

    async function register() {
      try {
        const token = await getAccessToken();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch('/api/referrals/register', {
          method: 'POST',
          headers,
          body: JSON.stringify({ code }),
        });

        if (res.ok || res.status === 400) {
          // 200 (registered or skipped) or 400 (bad code) — either way, clear it
          try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
        }
      } catch {
        // network error — leave in storage, retry next session
      }
    }

    void register();
  }, [authenticated, getAccessToken]);

  return null;
}
