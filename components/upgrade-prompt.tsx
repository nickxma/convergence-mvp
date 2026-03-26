'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { track } from '@vercel/analytics';
import { useAuth } from '@/lib/use-auth';
import type { FeatureKey } from '@/hooks/use-pro-gate';
import { localeToCurrency, CURRENCY_SYMBOLS } from '@/lib/fx-rates';
import type { FxRates, SupportedCurrency } from '@/lib/fx-rates';
import { PYUSDCheckoutModal } from '@/components/pyusd-checkout-modal';

export interface UpgradePromptProps {
  /** The feature the user tried to access — matches FeatureKey from useProGate */
  feature: FeatureKey | string;
  onClose: () => void;
}

const FEATURE_LABELS: Record<string, string> = {
  'qa_unlimited': 'unlimited Q&A',
  'community_post': 'community posting',
  'dms': 'direct messages',
  'wallet': 'wallet features',
  'session_notes': 'session notes',
  // legacy key used internally by qa-interface
  'unlimited_qa': 'unlimited Q&A',
  'compare_teachers': 'teacher comparison (3+ teachers)',
};

const PRO_BULLETS = [
  {
    icon: (
      <svg aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
      </svg>
    ),
    title: 'Unlimited Q&A',
    body: 'Ask as many questions as you want, with fresh answers that bypass the semantic cache.',
  },
  {
    icon: (
      <svg aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
      </svg>
    ),
    title: 'Full community access',
    body: 'Create posts, send direct messages, and engage with the entire community.',
  },
  {
    icon: (
      <svg aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 0 0-2.25-2.25H15a3 3 0 1 1-6 0H5.25A2.25 2.25 0 0 1 3 12m18 0v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6m18 0V9M3 12V9m18-3a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 9m18 0V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v3" />
      </svg>
    ),
    title: 'Wallet & token features',
    body: 'Unlock wallet-gated content, token governance, and Ethereum-based access controls.',
  },
];

type BillingInterval = 'monthly' | 'annual';

const MONTHLY_PRICE_USD = Number(process.env.NEXT_PUBLIC_PRO_PRICE_MONTHLY ?? '12');
const ANNUAL_PRICE_USD = Number(process.env.NEXT_PUBLIC_PRO_PRICE_ANNUAL ?? '96');

function formatPrice(usdAmount: number, currency: SupportedCurrency, rates: FxRates | null): string {
  if (!rates || currency === 'USD') return `$${usdAmount}`;
  const converted = Math.round(usdAmount * rates[currency]);
  return `${CURRENCY_SYMBOLS[currency]}${converted}`;
}

export function UpgradePrompt({ feature, onClose }: UpgradePromptProps) {
  const { getAccessToken } = useAuth();
  const [billing, setBilling] = useState<BillingInterval>('monthly');
  const [loading, setLoading] = useState<'upgrade' | 'trial' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPYUSD, setShowPYUSD] = useState(false);
  const [currency, setCurrency] = useState<SupportedCurrency>('USD');
  const [fxRates, setFxRates] = useState<FxRates | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const featureLabel = FEATURE_LABELS[feature] ?? feature;

  // Detect locale → currency, fetch FX rates
  useEffect(() => {
    const detected = localeToCurrency(navigator.language ?? 'en-US');
    setCurrency(detected);
    if (detected !== 'USD') {
      fetch('/api/fx/rates')
        .then((r) => r.ok ? r.json() : null)
        .then((data: { rates: FxRates } | null) => {
          if (data?.rates) setFxRates(data.rates);
        })
        .catch(() => { /* silently fall back to USD display */ });
    }
  }, []);

  // Track impression on mount
  useEffect(() => {
    track('upgrade_prompt_impression', { feature });
  }, [feature]);

  // Escape to dismiss
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  // Focus trap
  const handleFocusTrap = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button, [href], input, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }, []);

  async function startCheckout(withTrial: boolean) {
    const action = withTrial ? 'trial' : 'upgrade';
    setLoading(action);
    setError(null);

    track(withTrial ? 'upgrade_prompt_trial_click' : 'upgrade_prompt_cta_click', {
      feature,
      billing,
    });

    try {
      const token = await getAccessToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers,
        body: JSON.stringify({ billing, trial: withTrial }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? 'Checkout unavailable — try again.');
        return;
      }

      const { url } = await res.json() as { url: string };
      window.location.href = url;
    } catch {
      setError('Network error — check your connection and try again.');
    } finally {
      setLoading(null);
    }
  }

  const monthlyDisplay = `${formatPrice(MONTHLY_PRICE_USD, currency, fxRates)}/mo`;
  const annualDisplay = `${formatPrice(ANNUAL_PRICE_USD, currency, fxRates)}/yr`;
  const annualMonthlyRaw = Math.round(ANNUAL_PRICE_USD / 12);
  const annualMonthly = formatPrice(annualMonthlyRaw, currency, fxRates);
  const annualSavings = Math.round((1 - ANNUAL_PRICE_USD / (MONTHLY_PRICE_USD * 12)) * 100);
  const showApproxNote = currency !== 'USD' && fxRates !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="upgrade-prompt-title"
        onKeyDown={handleFocusTrap}
        className="w-full max-w-md rounded-2xl flex flex-col"
        style={{ background: 'var(--bg)', boxShadow: '0 24px 64px rgba(0,0,0,0.18)' }}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between px-5 pt-5 pb-4"
        >
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded tracking-wide"
                style={{ background: '#7c3aed', color: '#fff' }}
              >
                PRO
              </span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                required
              </span>
            </div>
            <h2
              id="upgrade-prompt-title"
              className="text-base font-semibold leading-snug"
              style={{ color: 'var(--sage-dark)' }}
            >
              Unlock {featureLabel}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="p-1.5 rounded-lg -mt-0.5 -mr-0.5 flex-shrink-0"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Dismiss"
          >
            <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Value props */}
        <div className="px-5 pb-4 space-y-3">
          {PRO_BULLETS.map((b) => (
            <div key={b.title} className="flex items-start gap-2.5">
              <span style={{ color: 'var(--sage)' }}>{b.icon}</span>
              <div>
                <p className="text-xs font-medium" style={{ color: 'var(--text)' }}>{b.title}</p>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>{b.body}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Billing toggle */}
        <div
          className="mx-5 mb-4 flex items-center rounded-lg p-0.5"
          style={{ background: 'var(--bg-chip)' }}
          role="group"
          aria-label="Billing interval"
        >
          {(['monthly', 'annual'] as const).map((interval) => (
            <button
              key={interval}
              onClick={() => setBilling(interval)}
              className="flex-1 py-1.5 rounded-md text-xs font-medium transition-all"
              aria-pressed={billing === interval}
              style={
                billing === interval
                  ? { background: 'var(--bg)', color: 'var(--sage-dark)', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }
                  : { color: 'var(--text-muted)' }
              }
            >
              {interval === 'monthly' ? (
                `Monthly — ${monthlyDisplay}`
              ) : (
                <span className="flex items-center justify-center gap-1.5">
                  Annual — {annualMonthly}/mo
                  {annualSavings > 0 && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                      style={{ background: '#dcfce7', color: '#15803d' }}
                    >
                      Save {annualSavings}%
                    </span>
                  )}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <p
            className="mx-5 mb-3 text-xs px-3 py-2 rounded-lg"
            style={{ background: 'var(--error-bg)', color: 'var(--error-text)', border: '1px solid var(--error-border)' }}
          >
            {error}
          </p>
        )}

        {/* CTAs */}
        <div className="px-5 pb-5 space-y-2">
          <button
            onClick={() => startCheckout(false)}
            disabled={loading !== null}
            className="w-full py-2.5 rounded-xl text-sm font-medium transition-opacity"
            style={{ background: 'var(--sage)', color: '#fff', opacity: loading !== null ? 0.7 : 1 }}
          >
            {loading === 'upgrade'
              ? 'Redirecting…'
              : billing === 'monthly'
                ? `Upgrade to Pro — ${monthlyDisplay}`
                : `Upgrade to Pro — ${annualDisplay}`}
          </button>

          <button
            onClick={() => startCheckout(true)}
            disabled={loading !== null}
            className="w-full py-2 rounded-xl text-xs font-medium transition-opacity"
            style={{
              background: 'var(--bg-surface)',
              color: 'var(--sage-dark)',
              border: '1px solid var(--border)',
              opacity: loading !== null ? 0.7 : 1,
            }}
          >
            {loading === 'trial' ? 'Redirecting…' : 'Start 14-day free trial'}
          </button>

          <p className="text-center text-[10px]" style={{ color: 'var(--text-faint)' }}>
            Cancel anytime. No charge during trial.
          </p>
          {showApproxNote && (
            <p className="text-center text-[10px]" style={{ color: 'var(--text-faint)' }}>
              Billed in USD — shown price is approximate.
            </p>
          )}

          {/* PYUSD divider */}
          <div className="flex items-center gap-2 pt-1">
            <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
            <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>or pay with crypto</span>
            <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
          </div>

          <button
            onClick={() => {
              track('upgrade_prompt_pyusd_click', { feature });
              setShowPYUSD(true);
            }}
            disabled={loading !== null}
            className="w-full py-2 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition-opacity"
            style={{
              background: 'var(--bg-surface)',
              color: 'var(--text-muted)',
              border: '1px solid var(--border)',
              opacity: loading !== null ? 0.7 : 1,
            }}
          >
            <span
              className="text-[9px] font-bold px-1.5 py-0.5 rounded"
              style={{ background: '#0044ff', color: '#fff' }}
            >
              PYUSD
            </span>
            Pay with PYUSD
          </button>
        </div>
      </div>
      {showPYUSD && (
        <PYUSDCheckoutModal
          tier="pro"
          onClose={() => setShowPYUSD(false)}
          onSuccess={onClose}
        />
      )}
    </div>
  );
}
