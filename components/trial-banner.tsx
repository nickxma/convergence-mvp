'use client';

import { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';

const SESSION_KEY = 'trial_banner_dismissed';

interface TrialInfo {
  subscriptionStatus: string | null;
  trialEnd: string | null;
}

/**
 * Returns the number of full days remaining until `trialEnd`.
 * Returns 0 if already past.
 */
function daysRemaining(trialEnd: string): number {
  const ms = new Date(trialEnd).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

/** Color scheme based on urgency. */
function urgencyStyles(days: number): { bg: string; border: string; text: string; ctaText: string } {
  if (days === 0) {
    return {
      bg: '#fef2f2',
      border: '#fecaca',
      text: '#991b1b',
      ctaText: 'Upgrade now to keep Pro access',
    };
  }
  if (days <= 1) {
    return {
      bg: '#fef2f2',
      border: '#fecaca',
      text: '#991b1b',
      ctaText: 'Manage subscription',
    };
  }
  if (days <= 3) {
    return {
      bg: '#fffbeb',
      border: '#fde68a',
      text: '#92400e',
      ctaText: 'Manage subscription',
    };
  }
  return {
    bg: '#eff6ff',
    border: '#bfdbfe',
    text: '#1e40af',
    ctaText: 'Manage subscription',
  };
}

/**
 * TrialBanner — shown at the top of every page for users currently in a Stripe trial.
 *
 * Urgency levels:
 *   7+ days: blue/neutral
 *   ≤ 3 days: amber warning
 *   ≤ 1 day: red urgent
 *   0 days (expired, not yet downgraded): red urgent, "Upgrade now to keep Pro access"
 *
 * Dismiss is stored in sessionStorage so it re-appears on the next visit.
 * Hidden for active, free, and cancelled users.
 */
export function TrialBanner() {
  const { authenticated, getAccessToken } = usePrivy();
  const [trial, setTrial] = useState<TrialInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [loadingPortal, setLoadingPortal] = useState(false);

  useEffect(() => {
    if (!authenticated) return;

    // Check sessionStorage dismissal
    if (sessionStorage.getItem(SESSION_KEY) === '1') {
      setDismissed(true);
      return;
    }

    void (async () => {
      try {
        const token = await getAccessToken();
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch('/api/subscriptions/me', { headers });
        if (!res.ok) return;
        const data = await res.json() as TrialInfo;
        if (data.subscriptionStatus === 'trialing') {
          setTrial(data);
        }
      } catch {
        // non-critical
      }
    })();
  }, [authenticated, getAccessToken]);

  function handleDismiss() {
    sessionStorage.setItem(SESSION_KEY, '1');
    setDismissed(true);
  }

  async function handleManage() {
    setLoadingPortal(true);
    try {
      const token = await getAccessToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/stripe/portal', { method: 'POST', headers, body: '{}' });
      if (res.ok) {
        const { url } = await res.json() as { url: string };
        window.location.href = url;
        return;
      }
    } catch { /* fall through */ }
    setLoadingPortal(false);
  }

  if (!trial || dismissed) return null;

  const days = trial.trialEnd ? daysRemaining(trial.trialEnd) : 0;
  const styles = urgencyStyles(days);

  const message =
    days === 0
      ? 'Your free trial has ended.'
      : `Your free trial ends in ${days} day${days === 1 ? '' : 's'} \u2014 Add a payment method to continue.`;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs"
      style={{
        background: styles.bg,
        borderBottom: `1px solid ${styles.border}`,
        color: styles.text,
      }}
    >
      <span className="flex-1">{message}</span>

      <button
        onClick={handleManage}
        disabled={loadingPortal}
        className="flex-shrink-0 text-xs font-medium underline underline-offset-2 transition-opacity"
        style={{ color: styles.text, opacity: loadingPortal ? 0.6 : 1 }}
      >
        {loadingPortal ? 'Opening\u2026' : styles.ctaText}
      </button>

      <button
        onClick={handleDismiss}
        aria-label="Dismiss trial banner"
        className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full transition-opacity"
        style={{ color: styles.text }}
      >
        <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
