import type { Metadata } from 'next';
import { CreditPackagePicker } from './credit-package-picker';
import { supabase } from '@/lib/supabase';

export const metadata: Metadata = {
  title: 'Buy Play Credits — OpenClaw',
  description: 'Purchase PYUSD play credits to use OpenClaw claw machines.',
};

export const dynamic = 'force-dynamic';

export default async function CreditsPage() {
  // Fetch packages server-side for SSR
  const { data } = await supabase
    .from('credit_packages')
    .select('id, label, credits, price_usd, price_pyusd, sort_order')
    .eq('active', true)
    .order('sort_order');

  const packages = (data ?? []).map((row) => ({
    id: row.id as string,
    label: row.label as string,
    credits: row.credits as number,
    priceUSD: Number(row.price_usd),
    pricePYUSD: Number(row.price_pyusd),
  }));

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
          href="/openclaw"
          className="text-sm"
          style={{ color: 'var(--text-muted)' }}
        >
          ← Back to OpenClaw
        </a>
      </header>

      <main className="flex-1 flex flex-col items-center px-6 py-14">
        {/* Header */}
        <div className="w-full max-w-lg text-center mb-10">
          <h1
            className="text-3xl font-semibold tracking-tight"
            style={{ color: 'var(--sage-dark)' }}
          >
            Play Credits
          </h1>
          <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            Credits are spent one per play. Pay with PYUSD — no card required.
          </p>
        </div>

        <CreditPackagePicker packages={packages} />
      </main>

      <footer
        className="px-6 py-6 border-t text-center"
        style={{ borderColor: 'var(--border)' }}
      >
        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
          OpenClaw · PYUSD on Ethereum mainnet ·{' '}
          <a href="/privacy" className="underline underline-offset-2" style={{ color: 'var(--text-muted)' }}>
            Privacy
          </a>
        </p>
      </footer>
    </div>
  );
}
