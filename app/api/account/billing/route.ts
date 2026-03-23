/**
 * GET /api/account/billing
 *
 * Returns the current user's billing status for the /account/billing page:
 *   - current plan + tier
 *   - next renewal date (currentPeriodEnd)
 *   - cancel_at_period_end flag
 *   - last 10 PYUSD payment history entries
 *
 * Response: { subscription, history }
 */
import { NextResponse } from 'next/server';
import { verifyRequest } from '@/lib/privy-auth';
import { supabase } from '@/lib/supabase';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await verifyRequest(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [subResult, historyResult] = await Promise.all([
    supabase
      .from('subscriptions')
      .select('tier, plan_id, subscription_status, current_period_end, cancel_at_period_end, stripe_subscriber')
      .eq('user_id', auth.userId)
      .single(),

    supabase
      .from('subscription_payment_history')
      .select('id, plan_id, amount_pyusd, tx_hash, paid_at, period_end')
      .eq('user_id', auth.userId)
      .order('paid_at', { ascending: false })
      .limit(10),
  ]);

  const sub = subResult.data;
  const history = historyResult.data ?? [];

  return NextResponse.json({
    subscription: sub
      ? {
          tier: sub.tier,
          planId: sub.plan_id,
          status: sub.subscription_status,
          currentPeriodEnd: sub.current_period_end,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          stripeSubscriber: sub.stripe_subscriber,
        }
      : {
          tier: 'free',
          planId: 'free',
          status: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          stripeSubscriber: false,
        },
    history: history.map((h) => ({
      id: h.id,
      planId: h.plan_id,
      amountPYUSD: Number(h.amount_pyusd),
      txHash: h.tx_hash,
      paidAt: h.paid_at,
      periodEnd: h.period_end,
    })),
  });
}
