/**
 * POST /api/subscriptions/cancel
 *
 * Sets cancel_at_period_end = true on the user's active subscription.
 * Access remains active until currentPeriodEnd — no immediate downgrade.
 *
 * Response: { ok: true, cancelAtPeriodEnd: true, currentPeriodEnd: string }
 */
import { NextResponse } from 'next/server';
import { verifyRequest } from '@/lib/privy-auth';
import { supabase } from '@/lib/supabase';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await verifyRequest(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: sub, error: fetchErr } = await supabase
    .from('subscriptions')
    .select('id, tier, current_period_end, cancel_at_period_end')
    .eq('user_id', auth.userId)
    .single();

  if (fetchErr || !sub) {
    return NextResponse.json({ error: 'No active subscription found.' }, { status: 404 });
  }

  if ((sub.tier as string) === 'free') {
    return NextResponse.json({ error: 'Free plan cannot be cancelled.' }, { status: 400 });
  }

  if (sub.cancel_at_period_end) {
    // Already scheduled for cancellation
    return NextResponse.json({
      ok: true,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: sub.current_period_end,
    });
  }

  const { error: updateErr } = await supabase
    .from('subscriptions')
    .update({ cancel_at_period_end: true, updated_at: new Date().toISOString() })
    .eq('id', sub.id);

  if (updateErr) {
    console.error('[subscriptions/cancel] update_error:', updateErr.message);
    return NextResponse.json({ error: 'Failed to schedule cancellation.' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    cancelAtPeriodEnd: true,
    currentPeriodEnd: sub.current_period_end,
  });
}
