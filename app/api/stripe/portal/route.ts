import { NextResponse } from 'next/server';
import { verifyRequest } from '@/lib/privy-auth';
import { getUserSubscription } from '@/lib/subscription';
import type { NextRequest } from 'next/server';

/**
 * POST /api/stripe/portal
 *
 * Creates a Stripe Billing Portal Session and returns the redirect URL.
 *
 * Body (optional):
 *   flow — "cancel" | "pause" | undefined
 *          When "cancel", pre-opens the portal to the subscription cancellation flow.
 *          When "pause",  pre-opens the portal to the subscription pause flow.
 *          Omit for the full portal dashboard.
 *
 * Response:
 *   { url: string }
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY  — Stripe secret key
 *   NEXT_PUBLIC_APP_URL — Base URL for return_url redirect
 */
export async function POST(req: NextRequest) {
  const auth = await verifyRequest(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return NextResponse.json(
      { error: 'Billing not configured — contact support.' },
      { status: 503 },
    );
  }

  const sub = await getUserSubscription(auth.userId);

  if (!sub.stripeCustomerId) {
    return NextResponse.json(
      { error: 'No active subscription found.' },
      { status: 404 },
    );
  }

  const body = await req.json().catch(() => ({})) as { flow?: string };
  const flow = body.flow;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  const params = new URLSearchParams({
    customer: sub.stripeCustomerId,
    return_url: `${appUrl}/profile`,
  });

  // Pre-open a specific portal flow when requested
  if (flow === 'cancel' && sub.stripeSubscriptionId) {
    params.set('flow_data[type]', 'subscription_cancel');
    params.set('flow_data[subscription_cancel][subscription]', sub.stripeSubscriptionId);
  } else if (flow === 'pause' && sub.stripeSubscriptionId) {
    params.set('flow_data[type]', 'subscription_pause');
    params.set('flow_data[subscription_pause][subscription]', sub.stripeSubscriptionId);
  }

  const stripeRes = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!stripeRes.ok) {
    const err = await stripeRes.json().catch(() => ({})) as { error?: { message?: string } };
    console.error('[stripe/portal] Stripe error:', err);
    return NextResponse.json(
      { error: err.error?.message ?? 'Failed to create portal session.' },
      { status: 502 },
    );
  }

  const session = await stripeRes.json() as { url: string };
  return NextResponse.json({ url: session.url });
}
