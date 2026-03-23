'use client';

/**
 * /account/billing — Billing management page.
 *
 * Shows:
 *  - Current plan + tier badge
 *  - Next renewal date (or "Cancels on …" if cancel_at_period_end)
 *  - PYUSD payment history (last 10 payments)
 *  - Cancel subscription button (schedules end-of-period cancellation)
 *  - Upgrade CTA for free users → opens PYUSDCheckoutModal
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/use-auth';
import { PYUSDCheckoutModal } from '@/components/pyusd-checkout-modal';
import Link from 'next/link';

interface SubscriptionInfo {
  tier: string;
  planId: string | null;
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  stripeSubscriber: boolean;
}

interface PaymentRecord {
  id: string;
  planId: string | null;
  amountPYUSD: number;
  txHash: string | null;
  paidAt: string;
  periodEnd: string | null;
}

type Phase = 'loading' | 'ready' | 'error';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function TierBadge({ tier }: { tier: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    free:  { bg: 'var(--bg-chip)',  color: 'var(--text-muted)' },
    pro:   { bg: '#7c3aed',         color: '#fff' },
    team:  { bg: '#1d4ed8',         color: '#fff' },
  };
  const style = colors[tier] ?? colors.free;
  return (
    <span
      className="text-[10px] font-bold px-2 py-0.5 rounded tracking-wide uppercase"
      style={style}
    >
      {tier}
    </span>
  );
}

export function BillingClient() {
  const { authenticated, getAccessToken } = useAuth();
  const [phase, setPhase] = useState<Phase>('loading');
  const [sub, setSub] = useState<SubscriptionInfo | null>(null);
  const [history, setHistory] = useState<PaymentRecord[]>([]);
  const [showCheckout, setShowCheckout] = useState<'pro' | 'team' | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!authenticated) return;
    setPhase('loading');
    try {
      const token = await getAccessToken();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/account/billing', { headers });
      if (!res.ok) { setPhase('error'); return; }
      const data = await res.json() as { subscription: SubscriptionInfo; history: PaymentRecord[] };
      setSub(data.subscription);
      setHistory(data.history);
      setPhase('ready');
    } catch {
      setPhase('error');
    }
  }, [authenticated, getAccessToken]);

  useEffect(() => { void load(); }, [load]);

  if (!authenticated) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'var(--bg)' }}
      >
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          <Link href="/login?redirect=/account/billing" style={{ color: 'var(--sage-dark)' }}>
            Sign in
          </Link>{' '}
          to view your billing.
        </p>
      </div>
    );
  }

  async function handleCancel() {
    setCancelError(null);
    setCancelling(true);
    try {
      const token = await getAccessToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/subscriptions/cancel', { method: 'POST', headers });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setCancelError(body.error ?? 'Failed to cancel — try again.');
      } else {
        await load();
      }
    } catch {
      setCancelError('Network error — try again.');
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      {/* Nav */}
      <header
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        <a
          href="/"
          className="text-sm font-semibold tracking-tight"
          style={{ color: 'var(--sage-dark)', textDecoration: 'none' }}
        >
          Convergence
        </a>
        <a
          href="/account"
          className="text-sm"
          style={{ color: 'var(--text-muted)', textDecoration: 'none' }}
        >
          ← Account
        </a>
      </header>

      <main className="flex-1 max-w-xl mx-auto w-full px-6 py-12 space-y-8">
        <h1 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--sage-dark)' }}>
          Billing
        </h1>

        {phase === 'loading' && (
          <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            <div
              className="w-4 h-4 rounded-full border-2 animate-spin"
              style={{ borderColor: 'var(--border)', borderTopColor: 'var(--sage)' }}
            />
            Loading…
          </div>
        )}

        {phase === 'error' && (
          <p className="text-sm" style={{ color: 'var(--error-text)' }}>
            Failed to load billing info.{' '}
            <button
              onClick={() => void load()}
              className="underline"
              style={{ color: 'var(--sage-dark)' }}
            >
              Retry
            </button>
          </p>
        )}

        {phase === 'ready' && sub && (
          <>
            {/* ── Current plan ─────────────────────────────────────────── */}
            <section
              className="rounded-2xl border p-6 space-y-4"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
                    Current plan
                  </p>
                  <div className="flex items-center gap-2">
                    <TierBadge tier={sub.tier} />
                    {sub.status && (
                      <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                        {sub.status}
                      </span>
                    )}
                  </div>
                </div>

                {sub.tier === 'free' && (
                  <button
                    onClick={() => setShowCheckout('pro')}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg"
                    style={{ background: 'var(--sage)', color: '#fff' }}
                  >
                    Upgrade to Pro
                  </button>
                )}
              </div>

              {/* Renewal / cancellation info */}
              {sub.currentPeriodEnd && (
                <div
                  className="px-3 py-2.5 rounded-lg text-xs"
                  style={{
                    background: sub.cancelAtPeriodEnd ? 'var(--warn-bg)' : 'var(--bg-chip)',
                    color: sub.cancelAtPeriodEnd ? 'var(--warn-text)' : 'var(--text-muted)',
                    border: sub.cancelAtPeriodEnd ? '1px solid var(--warn-border)' : 'none',
                  }}
                >
                  {sub.cancelAtPeriodEnd
                    ? `Access ends on ${fmtDate(sub.currentPeriodEnd)}. Your plan will not renew.`
                    : `Renews on ${fmtDate(sub.currentPeriodEnd)}`}
                </div>
              )}

              {/* Cancel CTA (paid plans only, not already cancelling, not Stripe-managed) */}
              {sub.tier !== 'free' && !sub.cancelAtPeriodEnd && !sub.stripeSubscriber && (
                <div className="pt-1">
                  {cancelError && (
                    <p className="text-xs mb-2" style={{ color: 'var(--error-text)' }}>
                      {cancelError}
                    </p>
                  )}
                  <button
                    onClick={() => void handleCancel()}
                    disabled={cancelling}
                    className="text-xs px-3 py-1.5 rounded-lg transition-opacity"
                    style={{
                      background: 'var(--bg)',
                      color: 'var(--text-muted)',
                      border: '1px solid var(--border)',
                      opacity: cancelling ? 0.6 : 1,
                    }}
                  >
                    {cancelling ? 'Cancelling…' : 'Cancel subscription'}
                  </button>
                  <p className="mt-1 text-[10px]" style={{ color: 'var(--text-faint)' }}>
                    Access continues until the end of the current period.
                  </p>
                </div>
              )}

              {/* Stripe-managed notice */}
              {sub.stripeSubscriber && (
                <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                  Your subscription is managed via Stripe.{' '}
                  <a
                    href="/api/stripe/portal"
                    style={{ color: 'var(--sage-dark)' }}
                  >
                    Manage in Stripe →
                  </a>
                </p>
              )}
            </section>

            {/* ── Payment history ───────────────────────────────────────── */}
            <section className="space-y-3">
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                PYUSD payment history
              </h2>

              {history.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                  No PYUSD payments yet.{' '}
                  {sub.tier === 'free' && (
                    <button
                      onClick={() => setShowCheckout('pro')}
                      className="underline"
                      style={{ color: 'var(--sage-dark)' }}
                    >
                      Upgrade with PYUSD
                    </button>
                  )}
                </p>
              ) : (
                <div
                  className="rounded-xl border overflow-hidden"
                  style={{ borderColor: 'var(--border)' }}
                >
                  {history.map((record, i) => (
                    <div
                      key={record.id}
                      className="flex items-start justify-between px-4 py-3 text-xs gap-3"
                      style={{
                        borderTop: i > 0 ? `1px solid var(--border)` : undefined,
                        background: 'var(--bg-surface)',
                      }}
                    >
                      <div className="space-y-0.5">
                        <div className="font-medium" style={{ color: 'var(--text)' }}>
                          {record.planId
                            ? `${record.planId.charAt(0).toUpperCase() + record.planId.slice(1)} plan`
                            : 'Subscription'}
                        </div>
                        <div style={{ color: 'var(--text-faint)' }}>
                          {fmtDate(record.paidAt)}
                          {record.periodEnd && ` · through ${fmtDate(record.periodEnd)}`}
                        </div>
                        {record.txHash && (
                          <div
                            className="font-mono truncate"
                            style={{ color: 'var(--text-faint)', maxWidth: 200 }}
                            title={record.txHash}
                          >
                            tx: {record.txHash.slice(0, 10)}…
                          </div>
                        )}
                      </div>
                      <div
                        className="font-semibold tabular-nums whitespace-nowrap"
                        style={{ color: 'var(--sage-dark)' }}
                      >
                        {record.amountPYUSD.toFixed(2)} PYUSD
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {/* Checkout modal */}
      {showCheckout && (
        <PYUSDCheckoutModal
          mode="subscription"
          tier={showCheckout}
          onClose={() => setShowCheckout(null)}
          onSuccess={() => {
            setShowCheckout(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
