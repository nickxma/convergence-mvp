'use client';

import { useState, useCallback } from 'react';
import { track } from '@vercel/analytics';
import { PYUSDCheckoutModal } from '@/components/pyusd-checkout-modal';
import { useAuth } from '@/lib/use-auth';

interface CreditPackage {
  id: string;
  label: string;
  credits: number;
  priceUSD: number;
  pricePYUSD: number;
}

interface CreditPackagePickerProps {
  packages: CreditPackage[];
}

export function CreditPackagePicker({ packages }: CreditPackagePickerProps) {
  const { authenticated } = useAuth();
  const [selectedPackage, setSelectedPackage] = useState<CreditPackage | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoaded, setBalanceLoaded] = useState(false);

  // Fetch balance once on mount if authenticated
  const fetchBalance = useCallback(async () => {
    if (!authenticated || balanceLoaded) return;
    try {
      const res = await fetch('/api/users/me/credits');
      if (res.ok) {
        const data = await res.json() as { balance: number };
        setBalance(data.balance);
      }
    } catch {
      // non-critical
    }
    setBalanceLoaded(true);
  }, [authenticated, balanceLoaded]);

  // Run on first render
  if (authenticated && !balanceLoaded) {
    void fetchBalance();
  }

  function handleSelect(pkg: CreditPackage) {
    if (!authenticated) {
      // Redirect to login with return URL
      window.location.href = `/login?redirect=/credits`;
      return;
    }
    track('credits_package_selected', { packageId: pkg.id, credits: pkg.credits });
    setSelectedPackage(pkg);
  }

  function handleSuccess() {
    // Refresh balance
    setBalanceLoaded(false);
    void fetchBalance();
  }

  // Best value is the largest pack
  const bestValueId = packages.reduce(
    (best, pkg) =>
      pkg.credits / pkg.pricePYUSD > (best ? best.credits / best.pricePYUSD : 0) ? pkg : best,
    null as CreditPackage | null,
  )?.id;

  return (
    <>
      {/* Current balance */}
      {authenticated && balanceLoaded && (
        <div
          className="w-full max-w-lg mb-6 flex items-center justify-between px-4 py-3 rounded-xl"
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
          }}
        >
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Your balance
          </span>
          <span className="text-sm font-semibold" style={{ color: 'var(--sage-dark)' }}>
            {balance ?? 0} {(balance ?? 0) === 1 ? 'credit' : 'credits'}
          </span>
        </div>
      )}

      {/* Package grid */}
      <div className="w-full max-w-lg grid grid-cols-1 gap-4 sm:grid-cols-3">
        {packages.map((pkg) => {
          const isBestValue = pkg.id === bestValueId && packages.length > 1;
          const perCreditPYUSD = (pkg.pricePYUSD / pkg.credits).toFixed(2);

          return (
            <div
              key={pkg.id}
              className="relative rounded-2xl border flex flex-col p-5 gap-3"
              style={{
                background: 'var(--bg-surface)',
                borderColor: isBestValue ? 'var(--sage)' : 'var(--border)',
                boxShadow: isBestValue ? '0 0 0 2px var(--sage)' : undefined,
              }}
            >
              {isBestValue && (
                <span
                  className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-bold px-2.5 py-0.5 rounded-full tracking-wide whitespace-nowrap"
                  style={{ background: 'var(--sage)', color: '#fff' }}
                >
                  Best value
                </span>
              )}

              {/* Credit count */}
              <div className="text-center">
                <p
                  className="text-3xl font-bold tabular-nums"
                  style={{ color: 'var(--sage-dark)' }}
                >
                  {pkg.credits}
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {pkg.credits === 1 ? 'play' : 'plays'}
                </p>
              </div>

              {/* Price */}
              <div className="text-center">
                <p className="text-lg font-semibold" style={{ color: 'var(--text)' }}>
                  {pkg.pricePYUSD.toFixed(2)}{' '}
                  <span className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
                    PYUSD
                  </span>
                </p>
                <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                  ${pkg.priceUSD.toFixed(2)} USD · {perCreditPYUSD} per play
                </p>
              </div>

              <button
                onClick={() => handleSelect(pkg)}
                className="w-full py-2.5 rounded-xl text-sm font-medium transition-opacity"
                style={{
                  background: isBestValue ? 'var(--sage)' : 'var(--bg-chip)',
                  color: isBestValue ? '#fff' : 'var(--sage-dark)',
                }}
              >
                Buy {pkg.credits} {pkg.credits === 1 ? 'credit' : 'credits'}
              </button>
            </div>
          );
        })}
      </div>

      {/* How it works */}
      <div
        className="w-full max-w-lg mt-8 px-5 py-4 rounded-xl"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
      >
        <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>
          How it works
        </p>
        <ol className="space-y-1.5">
          {[
            'Select a credit pack above.',
            'Send the exact PYUSD amount to the payment address shown (30-minute window).',
            'Credits are added automatically once the transfer confirms on-chain.',
            'Each OpenClaw play costs 1 credit.',
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              <span
                className="flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-semibold mt-0.5"
                style={{ background: 'var(--bg-chip)', color: 'var(--sage-dark)' }}
              >
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </div>

      {/* Checkout modal */}
      {selectedPackage && (
        <PYUSDCheckoutModal
          mode="credits"
          packageId={selectedPackage.id}
          creditLabel={selectedPackage.label}
          onClose={() => setSelectedPackage(null)}
          onSuccess={handleSuccess}
        />
      )}
    </>
  );
}
