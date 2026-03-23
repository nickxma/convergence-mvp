'use client';

/**
 * PYUSDPlanSection
 *
 * Shows the PYUSD-native subscription plan comparison table on /pricing.
 * Sits below the existing Stripe pricing cards as an alternative payment method.
 * Clicking a paid plan opens the PYUSDCheckoutModal for that tier.
 */

import { useState } from 'react';
import { track } from '@vercel/analytics';
import { useAuth } from '@/lib/use-auth';
import { PYUSDCheckoutModal } from '@/components/pyusd-checkout-modal';

interface SubscriptionPlan {
  id: string;
  name: string;
  description: string | null;
  features: string[];
  priceMonthlyPYUSD: number;
}

interface PYUSDPlanSectionProps {
  plans: SubscriptionPlan[];
}

export function PYUSDPlanSection({ plans }: PYUSDPlanSectionProps) {
  const { authenticated } = useAuth();
  const [checkoutTier, setCheckoutTier] = useState<'pro' | 'team' | null>(null);

  function handleSelect(plan: SubscriptionPlan) {
    if (plan.id === 'free') return;
    if (!authenticated) {
      window.location.href = `/login?redirect=/pricing`;
      return;
    }
    track('pyusd_plan_selected', { planId: plan.id });
    setCheckoutTier(plan.id as 'pro' | 'team');
  }

  return (
    <>
      <div className="w-full max-w-2xl mx-auto mt-14">
        {/* Section header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
          <div className="flex items-center gap-2">
            <span
              className="text-[11px] font-bold px-2 py-0.5 rounded tracking-wide"
              style={{ background: '#0044ff', color: '#fff' }}
            >
              PYUSD
            </span>
            <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
              Pay with PYUSD stablecoin
            </p>
          </div>
          <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
        </div>

        <p className="text-center text-xs mb-6" style={{ color: 'var(--text-faint)' }}>
          No credit card. Pay on-chain with PYUSD on Ethereum mainnet. 30-day rolling periods.
        </p>

        {/* Plan comparison grid */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {plans.map((plan) => {
            const isFree = plan.id === 'free';
            const isPro = plan.id === 'pro';

            return (
              <div
                key={plan.id}
                className="rounded-2xl border flex flex-col p-5 gap-4"
                style={{
                  background: 'var(--bg-surface)',
                  borderColor: isPro ? 'var(--sage)' : 'var(--border)',
                  boxShadow: isPro ? '0 0 0 2px var(--sage)' : undefined,
                  position: 'relative',
                }}
              >
                {isPro && (
                  <span
                    className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-bold px-2.5 py-0.5 rounded-full tracking-wide whitespace-nowrap"
                    style={{ background: 'var(--sage)', color: '#fff' }}
                  >
                    Most popular
                  </span>
                )}

                {/* Plan name + price */}
                <div>
                  <div
                    className="text-[10px] font-bold px-2 py-0.5 rounded tracking-wide inline-block mb-2"
                    style={{
                      background: isFree ? 'var(--bg-chip)' : isPro ? '#7c3aed' : '#1d4ed8',
                      color: isFree ? 'var(--text-muted)' : '#fff',
                    }}
                  >
                    {plan.name.toUpperCase()}
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span
                      className="text-2xl font-bold tabular-nums"
                      style={{ color: 'var(--sage-dark)' }}
                    >
                      {isFree ? 'Free' : `${plan.priceMonthlyPYUSD.toFixed(2)}`}
                    </span>
                    {!isFree && (
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        PYUSD/mo
                      </span>
                    )}
                  </div>
                  {plan.description && (
                    <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                      {plan.description}
                    </p>
                  )}
                </div>

                {/* Features */}
                <ul className="flex-1 space-y-1.5">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                      <svg
                        aria-hidden="true"
                        className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        style={{ color: isFree ? 'var(--text-faint)' : 'var(--sage)' }}
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                          clipRule="evenodd"
                        />
                      </svg>
                      {feature}
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <button
                  onClick={() => handleSelect(plan)}
                  disabled={isFree}
                  className="w-full py-2.5 rounded-xl text-sm font-medium transition-opacity disabled:opacity-40 disabled:cursor-default"
                  style={{
                    background: isFree ? 'var(--bg-chip)' : isPro ? 'var(--sage)' : 'var(--sage-dark)',
                    color: isFree ? 'var(--text-muted)' : '#fff',
                  }}
                >
                  {isFree ? 'Current plan' : `Pay ${plan.priceMonthlyPYUSD.toFixed(2)} PYUSD/mo`}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Checkout modal */}
      {checkoutTier && (
        <PYUSDCheckoutModal
          mode="subscription"
          tier={checkoutTier}
          onClose={() => setCheckoutTier(null)}
          onSuccess={() => {
            setCheckoutTier(null);
            // Soft reload to reflect new plan
            window.location.href = '/account/billing';
          }}
        />
      )}
    </>
  );
}
