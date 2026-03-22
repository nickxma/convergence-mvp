/**
 * GET /api/cron/cost-alert — daily OpenAI cost aggregation
 *
 * Vercel Cron: runs at midnight CT (06:00 UTC).
 * Sums estimated_cost_usd for the past 24h and fires Sentry alerts on threshold breach.
 *
 * Thresholds:
 *   > $5  → Sentry warning
 *   > $20 → Sentry error
 *
 * Protected by CRON_SECRET (Vercel Cron sends Authorization: Bearer <CRON_SECRET>).
 */
import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { supabase } from '@/lib/supabase';

const WARN_THRESHOLD_USD = 5;
const ERROR_THRESHOLD_USD = 20;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid cron secret.' } }, { status: 401 });
    }
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const { data, error } = await supabase
    .from('openai_usage')
    .select('estimated_cost_usd')
    .gte('created_at', since.toISOString());

  if (error) {
    console.error('[cost-alert] db_error:', error.message);
    return NextResponse.json({ error: { code: 'DB_ERROR', message: 'Failed to query usage data.' } }, { status: 502 });
  }

  const totalUsd = (data ?? []).reduce((sum, row) => sum + Number(row.estimated_cost_usd ?? 0), 0);

  if (totalUsd >= ERROR_THRESHOLD_USD) {
    Sentry.captureMessage(
      `OpenAI daily cost $${totalUsd.toFixed(4)} exceeded $${ERROR_THRESHOLD_USD} threshold`,
      'error',
    );
    console.error(`[cost-alert] daily_cost=${totalUsd.toFixed(6)} threshold=error`);
  } else if (totalUsd >= WARN_THRESHOLD_USD) {
    Sentry.captureMessage(
      `OpenAI daily cost $${totalUsd.toFixed(4)} exceeded $${WARN_THRESHOLD_USD} threshold`,
      'warning',
    );
    console.warn(`[cost-alert] daily_cost=${totalUsd.toFixed(6)} threshold=warning`);
  } else {
    console.log(`[cost-alert] daily_cost=${totalUsd.toFixed(6)} no_alert`);
  }

  return NextResponse.json({ totalUsd, period: '24h', since: since.toISOString() });
}
