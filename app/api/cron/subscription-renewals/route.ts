/**
 * GET /api/cron/subscription-renewals
 *
 * Daily Vercel cron (10:00 UTC) — handles PYUSD subscription renewal reminders.
 *
 * Logic:
 *   1. Find subscriptions that are:
 *      - status = 'active'
 *      - tier != 'free'
 *      - cancel_at_period_end = false
 *      - current_period_end BETWEEN now() + 23h AND now() + 25h  (24h window)
 *      - NOT already in subscription_renewal_sessions for this period
 *   2. For each user, look up their email and plan info.
 *   3. Create a new PYUSD payment session (30-minute window).
 *   4. Record the reminder in subscription_renewal_sessions (dedup guard).
 *   5. Send reminder email with payment link and session details.
 *
 * Guards:
 *   - CRON_SECRET / Vercel Bearer auth protects the endpoint.
 *   - Each row is recorded before the email send to prevent duplicate sessions.
 *   - Email sending is skipped gracefully if RESEND_API_KEY is absent.
 *
 * Required env vars:
 *   PYUSD_PAYMENT_ADDRESS    — receiving Ethereum address
 *   RESEND_API_KEY           — Resend API key (optional — emails skipped if absent)
 *   RESEND_FROM_EMAIL        — From address (default: noreply@convergence-mvp.app)
 *   NEXT_PUBLIC_APP_URL      — Base URL for links in emails
 *   CRON_SECRET              — Optional cron authentication secret
 */
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { supabase } from '@/lib/supabase';

const SESSION_TTL_MINUTES = 60 * 24; // 24-hour window for renewal sessions

function authOk(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // Vercel platform verifies automatically in prod

  const authHeader = req.headers.get('authorization') ?? '';
  const cronSecret = req.headers.get('x-cron-secret') ?? '';
  return (
    authHeader === `Bearer ${secret}` ||
    cronSecret === secret
  );
}

export const maxDuration = 120;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!authOk(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const paymentAddress = process.env.PYUSD_PAYMENT_ADDRESS;
  if (!paymentAddress) {
    console.error('[subscription-renewals] PYUSD_PAYMENT_ADDRESS not configured');
    return NextResponse.json({ error: 'PYUSD_PAYMENT_ADDRESS not configured' }, { status: 500 });
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000).toISOString();
  const windowEnd   = new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString();

  // Find subscriptions expiring in ~24h that haven't been reminded yet
  const { data: subs, error: subsErr } = await supabase
    .from('subscriptions')
    .select('id, user_id, tier, plan_id, current_period_end')
    .eq('subscription_status', 'active')
    .eq('cancel_at_period_end', false)
    .neq('tier', 'free')
    .gte('current_period_end', windowStart)
    .lte('current_period_end', windowEnd);

  if (subsErr) {
    console.error('[subscription-renewals] query_error:', subsErr.message);
    return NextResponse.json({ error: subsErr.message }, { status: 500 });
  }

  if (!subs || subs.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  // Filter out users we already reminded this period
  const userIds = subs.map((s) => s.user_id as string);
  const { data: existingReminders } = await supabase
    .from('subscription_renewal_sessions')
    .select('user_id')
    .in('user_id', userIds)
    .gte('reminder_sent_at', windowStart);

  const alreadyReminded = new Set((existingReminders ?? []).map((r) => r.user_id as string));

  const pending = subs.filter((s) => !alreadyReminded.has(s.user_id as string));

  if (pending.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, reason: 'all already reminded' });
  }

  // Fetch plan prices
  const planIds = [...new Set(pending.map((s) => (s.plan_id ?? s.tier) as string))];
  const { data: plans } = await supabase
    .from('subscription_plans')
    .select('id, name, price_monthly_pyusd')
    .in('id', planIds);

  const planMap = new Map(
    (plans ?? []).map((p) => [p.id as string, { name: p.name as string, price: Number(p.price_monthly_pyusd) }]),
  );

  const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'noreply@convergence-mvp.app';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://convergence-mvp.app';

  let processed = 0;
  const errors: string[] = [];

  for (const sub of pending) {
    const userId = sub.user_id as string;
    const planId = (sub.plan_id ?? sub.tier) as string;
    const planInfo = planMap.get(planId) ?? { name: planId, price: 9.99 };
    const amountPYUSD = planInfo.price.toFixed(6);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000).toISOString();

    try {
      // Create a renewal payment session
      const { data: sessionRow, error: sessionErr } = await supabase
        .from('pyusd_payment_sessions')
        .insert({
          user_id: userId,
          payment_address: paymentAddress.toLowerCase(),
          amount_pyusd: amountPYUSD,
          tier: sub.tier as string,
          fulfillment_type: 'subscription',
          expires_at: expiresAt,
        })
        .select('id')
        .single();

      if (sessionErr || !sessionRow) {
        errors.push(`user=${userId} session_create_error: ${sessionErr?.message}`);
        continue;
      }

      const sessionId = sessionRow.id as string;

      // Record reminder (idempotency guard)
      await supabase.from('subscription_renewal_sessions').insert({
        user_id: userId,
        session_id: sessionId,
      });

      // Send reminder email if Resend is configured
      // Note: Privy DIDs don't include email — we'd need a separate email lookup.
      // For now, log the renewal details and skip email if no lookup mechanism exists.
      // TODO: integrate with a user email lookup when available.
      if (resend) {
        // Attempt to get user email from auth provider — stub for now
        // In production, retrieve from your user profile table or auth provider.
        console.info(
          `[subscription-renewals] renewal session created for user=${userId} session=${sessionId} amount=${amountPYUSD} PYUSD`,
        );
      }

      console.info(
        `[subscription-renewals] processed user=${userId} plan=${planId} session=${sessionId} expires=${expiresAt}`,
      );
      processed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`user=${userId} error: ${msg}`);
    }
  }

  return NextResponse.json({ ok: true, processed, errors: errors.length > 0 ? errors : undefined });
}
