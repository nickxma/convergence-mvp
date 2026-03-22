import { NextResponse } from 'next/server';
import { verifyRequest } from '@/lib/privy-auth';
import { getUserSubscription } from '@/lib/subscription';
import type { NextRequest } from 'next/server';

/**
 * POST /api/stripe/retention-discount
 *
 * Applies a retention coupon to the user's active Stripe subscription.
 * Used by the cancellation exit survey modal ("Would a discount help?").
 *
 * Returns { available: false } if no coupon is configured.
 * Returns { applied: true, message } on success.
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY          — Stripe secret key
 *   STRIPE_RETENTION_COUPON_ID — Stripe coupon ID to apply (e.g. "20_percent_off_forever")
 *                                If absent, the endpoint returns { available: false }.
 */
export async function POST(req: NextRequest) {
  const auth = await verifyRequest(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const couponId = process.env.STRIPE_RETENTION_COUPON_ID;

  if (!stripeKey || !couponId) {
    return NextResponse.json({ available: false });
  }

  const sub = await getUserSubscription(auth.userId);

  if (!sub.stripeSubscriptionId) {
    return NextResponse.json({ available: false });
  }

  const params = new URLSearchParams({
    'discounts[0][coupon]': couponId,
  });

  const stripeRes = await fetch(
    `https://api.stripe.com/v1/subscriptions/${sub.stripeSubscriptionId}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    },
  );

  if (!stripeRes.ok) {
    const err = await stripeRes.json().catch(() => ({})) as { error?: { message?: string } };
    console.error('[retention-discount] Stripe error:', err);
    return NextResponse.json(
      { available: true, applied: false, error: err.error?.message ?? 'Could not apply discount.' },
      { status: 502 },
    );
  }

  console.log(`[retention-discount] applied coupon=${couponId} user=${auth.userId}`);

  return NextResponse.json({
    available: true,
    applied: true,
    message: 'Discount applied! Your next bill will reflect the new price.',
  });
}
