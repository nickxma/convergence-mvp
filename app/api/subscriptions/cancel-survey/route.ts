/**
 * POST /api/subscriptions/cancel-survey
 *
 * Records a cancellation survey response and computes MRR lost from Stripe.
 *
 * Body:
 *   userId         — Privy user ID (must match the authenticated user)
 *   reason         — short code: price | missing_feature | not_using | switching | other
 *   reasonDetail   — optional free-text elaboration
 *   subscriptionId — Stripe subscription ID
 *
 * Behaviour:
 *   1. Verify Privy auth; reject if userId in body doesn't match token.
 *   2. Validate required fields.
 *   3. Fetch Stripe subscription to compute mrr_lost (unit_amount / 100, annuals ÷ 12).
 *      Fails open — mrr_lost is NULL if Stripe is unavailable or not configured.
 *   4. Insert a row into churn_events.
 *   5. Return { id, mrrLost }.
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY  — Stripe secret key (optional; mrr_lost will be null if absent)
 *
 * DB table:
 *   churn_events (id, user_id, subscription_id, reason, reason_detail, mrr_lost, cancelled_at)
 */
import { NextResponse } from 'next/server';
import { verifyRequest } from '@/lib/privy-auth';
import { supabase } from '@/lib/supabase';
import type { NextRequest } from 'next/server';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CancelSurveyBody {
  userId?: string;
  reason?: string;
  reasonDetail?: string;
  subscriptionId?: string;
}

interface StripeSubscription {
  items?: {
    data?: Array<{
      price?: {
        unit_amount: number | null;
        recurring?: { interval: string };
      };
    }>;
  };
}

// ── Stripe helpers ────────────────────────────────────────────────────────────

const VALID_REASONS = new Set(['price', 'missing_feature', 'not_using', 'switching', 'other']);

/**
 * Fetch MRR lost in USD for a given Stripe subscription.
 * Returns null on any failure so the survey always records, even if Stripe is down.
 */
async function fetchMrrLost(subscriptionId: string, secretKey: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });

    if (!res.ok) {
      console.warn(`[cancel-survey] stripe subscription fetch failed status=${res.status}`);
      return null;
    }

    const sub = (await res.json()) as StripeSubscription;
    const price = sub.items?.data?.[0]?.price;
    if (!price || price.unit_amount === null || price.unit_amount === undefined) {
      return null;
    }

    const amountUsd = price.unit_amount / 100;
    const interval = price.recurring?.interval ?? 'month';

    // Normalise to monthly recurring revenue
    if (interval === 'year') {
      return Math.round((amountUsd / 12) * 100) / 100;
    }

    return Math.round(amountUsd * 100) / 100;
  } catch (err) {
    console.warn('[cancel-survey] stripe error:', err);
    return null;
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await verifyRequest(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: CancelSurveyBody;
  try {
    body = (await req.json()) as CancelSurveyBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { userId, reason, reasonDetail, subscriptionId } = body;

  // Validate required fields
  if (!userId || !reason || !subscriptionId) {
    return NextResponse.json(
      { error: 'Missing required fields: userId, reason, subscriptionId.' },
      { status: 400 },
    );
  }

  // User in body must match authenticated token
  if (userId !== auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!VALID_REASONS.has(reason)) {
    return NextResponse.json(
      { error: `Invalid reason. Must be one of: ${[...VALID_REASONS].join(', ')}.` },
      { status: 400 },
    );
  }

  // Compute MRR lost from Stripe (fails open)
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const mrrLost = stripeKey ? await fetchMrrLost(subscriptionId, stripeKey) : null;

  // Insert churn event
  const { data, error } = await supabase
    .from('churn_events')
    .insert({
      user_id: userId,
      subscription_id: subscriptionId,
      reason,
      reason_detail: reasonDetail ?? null,
      mrr_lost: mrrLost,
    })
    .select('id, mrr_lost')
    .single();

  if (error) {
    console.error('[cancel-survey] db_error:', error.message);
    return NextResponse.json(
      { error: 'Failed to record cancellation survey.' },
      { status: 502 },
    );
  }

  console.log(
    `[cancel-survey] recorded user=${userId} reason=${reason} mrr_lost=${mrrLost ?? 'unknown'}`,
  );

  return NextResponse.json({ id: data.id, mrrLost: data.mrr_lost });
}
