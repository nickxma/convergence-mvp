/**
 * GET /api/cron/churn-report
 *
 * Weekly Vercel cron (Mondays at 09:00 UTC) — aggregates churn_events from the
 * last 7 days, computes weekly churn rate, breaks down by cancellation reason,
 * and emails a summary to the admin.
 *
 * Logic:
 *   1. Query churn_events from the last 7 days.
 *   2. Count active subscriptions at start of week (active_start) as:
 *        stripe_subscriber=true AND subscription_status IN ('active','trialing')
 *        PLUS the newly cancelled count (to reconstruct the cohort base).
 *   3. Compute churn_rate = cancelled_count / active_start.
 *   4. Group churn_events by reason, sum mrr_lost per reason.
 *   5. Email summary to ADMIN_EMAIL via Resend.
 *
 * Guards:
 *   - CRON_SECRET — enforced when set (Vercel Cron sends Authorization: Bearer).
 *   - RESEND_API_KEY — required for email; logs a warning and returns 200 if absent.
 *   - ADMIN_EMAIL — recipient; returns 200 with no-op log if absent.
 *
 * Required env vars:
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *   RESEND_API_KEY
 *   RESEND_FROM_EMAIL   — "From" address (default: noreply@convergence-mvp.app)
 *   ADMIN_EMAIL         — recipient for the weekly summary
 *   CRON_SECRET         — optional; enforced when set
 */
import * as Sentry from '@sentry/nextjs';
import { Resend } from 'resend';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChurnEvent {
  reason: string;
  mrr_lost: number | null;
}

interface ReasonBreakdown {
  reason: string;
  count: number;
  mrrLost: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function reasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    price: 'Too expensive',
    missing_feature: 'Missing feature',
    not_using: 'Not using it',
    switching: 'Switching to competitor',
    other: 'Other',
  };
  return labels[reason] ?? reason;
}

function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function formatPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function buildReportEmail(params: {
  weekStart: string;
  weekEnd: string;
  cancelledCount: number;
  activeStart: number;
  churnRate: number;
  totalMrrLost: number;
  breakdown: ReasonBreakdown[];
}): { subject: string; html: string } {
  const { weekStart, weekEnd, cancelledCount, activeStart, churnRate, totalMrrLost, breakdown } = params;

  const breakdownRows = breakdown
    .map(
      (r) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${reasonLabel(r.reason)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${r.count}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${formatUsd(r.mrrLost)}</td>
        </tr>`,
    )
    .join('');

  const noChurnNote =
    cancelledCount === 0
      ? `<p style="margin:0 0 24px;font-size:15px;color:#16a34a;">No cancellations this week. 🎉</p>`
      : '';

  return {
    subject: `Weekly churn report: ${cancelledCount} cancellation${cancelledCount !== 1 ? 's' : ''} · ${formatUsd(totalMrrLost)} MRR lost`,
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Weekly Churn Report</title>
</head>
<body style="margin:0;padding:0;background:#fafaf9;font-family:Georgia,serif;color:#1c1c1c;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"
               style="background:#fff;border-radius:8px;padding:40px 48px;max-width:600px;">
          <tr>
            <td>
              <h1 style="margin:0 0 4px;font-size:22px;font-weight:normal;letter-spacing:-0.3px;">
                Weekly Churn Report
              </h1>
              <p style="margin:0 0 32px;font-size:13px;color:#999;">
                ${weekStart} – ${weekEnd}
              </p>

              ${noChurnNote}

              <!-- KPI summary -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                     style="margin:0 0 32px;background:#f9fafb;border-radius:6px;">
                <tr>
                  <td style="padding:20px 24px;border-right:1px solid #e5e7eb;">
                    <div style="font-size:28px;font-weight:bold;">${cancelledCount}</div>
                    <div style="font-size:13px;color:#6b7280;margin-top:4px;">Cancellations</div>
                  </td>
                  <td style="padding:20px 24px;border-right:1px solid #e5e7eb;">
                    <div style="font-size:28px;font-weight:bold;">${formatPct(churnRate)}</div>
                    <div style="font-size:13px;color:#6b7280;margin-top:4px;">Churn rate</div>
                  </td>
                  <td style="padding:20px 24px;">
                    <div style="font-size:28px;font-weight:bold;">${formatUsd(totalMrrLost)}</div>
                    <div style="font-size:13px;color:#6b7280;margin-top:4px;">MRR lost</div>
                  </td>
                </tr>
              </table>

              ${
                breakdown.length > 0
                  ? `
              <!-- Reason breakdown -->
              <h2 style="margin:0 0 12px;font-size:16px;font-weight:normal;">Cancellation reasons</h2>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                     style="border-collapse:collapse;margin:0 0 32px;font-size:14px;">
                <thead>
                  <tr style="background:#f3f4f6;">
                    <th style="padding:8px 12px;text-align:left;font-weight:600;border-bottom:1px solid #e5e7eb;">Reason</th>
                    <th style="padding:8px 12px;text-align:center;font-weight:600;border-bottom:1px solid #e5e7eb;">#</th>
                    <th style="padding:8px 12px;text-align:right;font-weight:600;border-bottom:1px solid #e5e7eb;">MRR lost</th>
                  </tr>
                </thead>
                <tbody>
                  ${breakdownRows}
                </tbody>
              </table>`
                  : ''
              }

              <p style="margin:0;font-size:13px;color:#999;line-height:1.6;">
                Active subscribers at start of week: ${activeStart}.
                Churn rate = cancellations ÷ active start-of-week.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Auth
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid cron secret.' } }, { status: 401 });
    }
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const adminEmail = process.env.ADMIN_EMAIL;
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'noreply@convergence-mvp.app';

  if (!adminEmail) {
    console.warn('[churn-report] ADMIN_EMAIL not set — skipping report');
    return NextResponse.json({ skipped: true, reason: 'ADMIN_EMAIL not set' });
  }

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const weekStart = weekAgo.toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
  const weekEnd = now.toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  });

  // Query churn events for the last 7 days
  const { data: churnRows, error: churnError } = await supabase
    .from('churn_events')
    .select('reason, mrr_lost')
    .gte('cancelled_at', weekAgo.toISOString());

  if (churnError) {
    console.error('[churn-report] churn_events query error:', churnError.message);
    return NextResponse.json({ error: { code: 'DB_ERROR', message: 'Failed to query churn events.' } }, { status: 502 });
  }

  const events = (churnRows ?? []) as ChurnEvent[];
  const cancelledCount = events.length;

  // Aggregate by reason
  const reasonMap = new Map<string, ReasonBreakdown>();
  let totalMrrLost = 0;

  for (const event of events) {
    const mrr = Number(event.mrr_lost ?? 0);
    totalMrrLost += mrr;

    const existing = reasonMap.get(event.reason);
    if (existing) {
      existing.count += 1;
      existing.mrrLost += mrr;
    } else {
      reasonMap.set(event.reason, { reason: event.reason, count: 1, mrrLost: mrr });
    }
  }

  const breakdown = Array.from(reasonMap.values()).sort((a, b) => b.count - a.count);

  // Count currently active subscribers + newly cancelled to get the start-of-week base
  const { count: activeNow, error: activeError } = await supabase
    .from('subscriptions')
    .select('*', { count: 'exact', head: true })
    .eq('stripe_subscriber', true)
    .in('subscription_status', ['active', 'trialing']);

  if (activeError) {
    console.error('[churn-report] subscriptions query error:', activeError.message);
    // Non-fatal — continue with best-effort churn rate
  }

  const activeStart = (activeNow ?? 0) + cancelledCount;
  const churnRate = activeStart > 0 ? cancelledCount / activeStart : 0;

  console.log(
    `[churn-report] week=${weekStart}→${weekEnd} cancelled=${cancelledCount} mrr_lost=${totalMrrLost.toFixed(2)} churn_rate=${(churnRate * 100).toFixed(1)}%`,
  );

  if (!resendApiKey) {
    console.warn('[churn-report] RESEND_API_KEY not set — skipping email');
    return NextResponse.json({
      sent: false,
      cancelledCount,
      churnRate,
      totalMrrLost,
      breakdown,
      reason: 'RESEND_API_KEY not set',
    });
  }

  const { subject, html } = buildReportEmail({
    weekStart,
    weekEnd,
    cancelledCount,
    activeStart,
    churnRate,
    totalMrrLost,
    breakdown,
  });

  try {
    const resend = new Resend(resendApiKey);
    await resend.emails.send({
      from: `Convergence <${fromEmail}>`,
      to: adminEmail,
      subject,
      html,
    });
    console.log(`[churn-report] email sent to=${adminEmail}`);
  } catch (err) {
    console.error('[churn-report] resend_error:', err);
    Sentry.withScope((scope) => {
      scope.setTag('cron', 'churn-report');
      scope.setContext('report', { cancelledCount, totalMrrLost, weekStart, weekEnd });
      Sentry.captureException(err);
    });
    return NextResponse.json(
      { error: { code: 'EMAIL_ERROR', message: 'Failed to send churn report email.' } },
      { status: 502 },
    );
  }

  return NextResponse.json({
    sent: true,
    cancelledCount,
    churnRate,
    totalMrrLost,
    breakdown,
  });
}
