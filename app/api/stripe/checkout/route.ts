import { NextResponse } from 'next/server';
import { verifyRequest } from '@/lib/privy-auth';
import type { NextRequest } from 'next/server';

/**
 * POST /api/stripe/checkout
 *
 * Creates a Stripe Checkout Session and returns the redirect URL.
 *
 * Body:
 *   billing  — "monthly" | "annual"   (default: "monthly")
 *   trial    — boolean                 (default: false)
 *              When true, applies a 14-day free trial period (OLU-469).
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY          — Stripe secret key (sk_live_... / sk_test_...)
 *   STRIPE_PRICE_ID_MONTHLY    — Stripe price ID for the monthly plan
 *   STRIPE_PRICE_ID_ANNUAL     — Stripe price ID for the annual plan
 *   NEXT_PUBLIC_APP_URL        — Base URL for success/cancel redirects
 */
export async function POST(req: NextRequest) {
  const auth = await verifyRequest(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const monthlyPriceId = process.env.STRIPE_PRICE_ID_MONTHLY;
  const annualPriceId = process.env.STRIPE_PRICE_ID_ANNUAL;

  if (!stripeKey || !monthlyPriceId || !annualPriceId) {
    return NextResponse.json(
      { error: 'Stripe not configured — contact support.' },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({})) as {
    billing?: string;
    trial?: boolean;
  };

  const billing = body.billing === 'annual' ? 'annual' : 'monthly';
  const withTrial = body.trial === true;
  const priceId = billing === 'annual' ? annualPriceId : monthlyPriceId;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  const params = new URLSearchParams({
    'mode': 'subscription',
    'payment_method_types[0]': 'card',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    'success_url': `${appUrl}/?subscription_updated=1`,
    'cancel_url': `${appUrl}/`,
    'metadata[user_id]': auth.userId,
    'metadata[wallet_address]': auth.walletAddress,
    'client_reference_id': auth.userId,
  });

  // 14-day free trial — OLU-469 will wire up the webhook handling
  if (withTrial) {
    params.set('subscription_data[trial_period_days]', '14');
  }

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!stripeRes.ok) {
    const err = await stripeRes.json().catch(() => ({})) as { error?: { message?: string } };
    console.error('[stripe/checkout] Stripe error:', err);
    return NextResponse.json(
      { error: err.error?.message ?? 'Failed to create checkout session.' },
      { status: 502 }
    );
  }

  const session = await stripeRes.json() as { url: string };
  return NextResponse.json({ url: session.url });
}
