import { headers } from 'next/headers';
import type { Metadata } from 'next';
import {
  getFxRates,
  localeToCurrency,
  parseAcceptLanguage,
  convertPrice,
} from '@/lib/fx-rates';
import { PricingCards } from './pricing-cards';
import { PYUSDPlanSection } from './pyusd-plan-section';
import { supabase } from '@/lib/supabase';

export const metadata: Metadata = {
  title: 'Pricing — Convergence',
  description: 'Unlock unlimited Q&A, community access, and wallet features with Convergence Pro.',
};

// Always dynamic — we read Accept-Language to personalise the currency.
export const dynamic = 'force-dynamic';

export default async function PricingPage() {
  const headersList = await headers();
  const acceptLang = headersList.get('accept-language');
  const locale = parseAcceptLanguage(acceptLang);
  const currency = localeToCurrency(locale);
  const rates = await getFxRates();

  // Fetch PYUSD plans for the PYUSD section
  const { data: planRows } = await supabase
    .from('subscription_plans')
    .select('id, name, description, features, price_monthly_pyusd, sort_order')
    .eq('active', true)
    .order('sort_order');

  const pyusdPlans = (planRows ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    description: row.description as string | null,
    features: (row.features as string[]) ?? [],
    priceMonthlyPYUSD: Number(row.price_monthly_pyusd),
    sortOrder: row.sort_order as number,
  }));

  const monthlyUsd = Number(process.env.NEXT_PUBLIC_PRO_PRICE_MONTHLY ?? '12');
  const annualUsd = Number(process.env.NEXT_PUBLIC_PRO_PRICE_ANNUAL ?? '96');

  const isUsd = currency === 'USD';
  const monthlyDisplay = isUsd ? `$${monthlyUsd}` : convertPrice(monthlyUsd, currency, rates);
  const annualDisplay = isUsd ? `$${annualUsd}` : convertPrice(annualUsd, currency, rates);
  const annualMonthlyDisplay = isUsd
    ? `$${Math.round(annualUsd / 12)}`
    : convertPrice(Math.round(annualUsd / 12), currency, rates);
  const annualSavings = Math.round((1 - annualUsd / (monthlyUsd * 12)) * 100);

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
          style={{ color: 'var(--sage-dark)' }}
        >
          Convergence
        </a>
        <a
          href="/"
          className="text-sm transition-colors"
          style={{ color: 'var(--text-muted)' }}
          onMouseOver={undefined}
        >
          ← Back
        </a>
      </header>

      {/* Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        <div className="w-full max-w-lg mx-auto text-center mb-10">
          <h1
            className="text-3xl font-semibold tracking-tight"
            style={{ color: 'var(--sage-dark)' }}
          >
            Simple, honest pricing
          </h1>
          <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--sage)' }}>
            One plan. Everything included. Cancel whenever.
          </p>
        </div>

        <PricingCards
          currency={currency}
          monthlyDisplay={monthlyDisplay}
          annualDisplay={annualDisplay}
          annualMonthlyDisplay={annualMonthlyDisplay}
          annualSavings={annualSavings}
          showApproxNote={!isUsd}
        />

        {pyusdPlans.length > 0 && (
          <PYUSDPlanSection plans={pyusdPlans} />
        )}
      </main>

      {/* Footer */}
      <footer
        className="px-6 py-6 border-t text-center"
        style={{ borderColor: 'var(--border)' }}
      >
        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
          Convergence · Paradox of Acceptance ·{' '}
          <a
            href="/privacy"
            className="underline underline-offset-2"
            style={{ color: 'var(--text-muted)' }}
          >
            Privacy
          </a>{' '}
          ·{' '}
          <a
            href="/terms"
            className="underline underline-offset-2"
            style={{ color: 'var(--text-muted)' }}
          >
            Terms
          </a>
        </p>
      </footer>
    </div>
  );
}
