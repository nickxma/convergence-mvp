/**
 * GET /api/cron/trial-reminders
 *
 * Daily Vercel cron (13:00 UTC) — sends trial-expiry reminder emails 3 days
 * before a user's trial ends.
 *
 * Logic:
 *   1. Query subscriptions where status = 'trialing'
 *          AND trial_end BETWEEN now() AND now() + 3 days
 *          AND trial_reminder_sent IS NULL
 *   2. For each user, fetch the Stripe customer to get email + default PM status.
 *   3a. If no confirmed payment method → send "trial_ending" email:
 *         trial end date · what they'll lose · CTA to add a payment method
 *   3b. If payment method confirmed → send "all_set" email:
 *         "All set — you'll be charged $X on DATE"
 *   4. Set trial_reminder_sent = now() to prevent duplicate sends.
 *
 * Guards:
 *   - RESEND_API_KEY must be set — email sends are skipped if absent.
 *   - CRON_SECRET protects the endpoint (same pattern as /api/cron/cost-alert).
 *   - Each row is marked before continuing so a partial run never double-sends.
 *
 * Required env vars:
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — Supabase service-role client
 *   STRIPE_SECRET_KEY                         — Stripe secret key
 *   RESEND_API_KEY                             — Resend API key
 *   RESEND_FROM_EMAIL                          — "From" address (default: noreply@convergence-mvp.app)
 *   NEXT_PUBLIC_APP_URL                        — Base URL for CTA links
 *   CRON_SECRET                                — Optional; enforced when set
 */
import * as Sentry from '@sentry/nextjs';
import { Resend } from 'resend';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TrialingSubscription {
  id: string;
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  trial_end: string;
}

interface StripeCustomer {
  email: string | null;
  invoice_settings?: {
    default_payment_method: string | null;
  };
}

interface StripeSubscription {
  default_payment_method: string | null;
  items?: {
    data?: Array<{
      price?: {
        unit_amount: number | null;
        currency: string;
        recurring?: { interval: string };
      };
    }>;
  };
}

interface StripeApiError {
  error?: { message?: string };
}

// ── Stripe helpers ─────────────────────────────────────────────────────────────

async function stripeGet<T>(path: string, secretKey: string): Promise<T | null> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as StripeApiError;
    console.warn(`[trial-reminders] stripe GET /${path} failed:`, err.error?.message);
    return null;
  }
  return res.json() as Promise<T>;
}

/**
 * Returns { email, hasPaymentMethod, amountCents, currency } for a subscription.
 * Falls back gracefully — missing data won't block the email send.
 */
async function fetchStripeInfo(
  stripeSecretKey: string,
  customerId: string | null,
  subscriptionId: string | null,
): Promise<{
  email: string | null;
  hasPaymentMethod: boolean;
  amountCents: number | null;
  currency: string;
}> {
  let email: string | null = null;
  let hasPaymentMethod = false;
  let amountCents: number | null = null;
  let currency = 'usd';

  if (customerId) {
    const customer = await stripeGet<StripeCustomer>(`customers/${customerId}`, stripeSecretKey);
    if (customer) {
      email = customer.email ?? null;
      hasPaymentMethod = Boolean(customer.invoice_settings?.default_payment_method);
    }
  }

  if (subscriptionId) {
    const sub = await stripeGet<StripeSubscription>(`subscriptions/${subscriptionId}`, stripeSecretKey);
    if (sub) {
      // A subscription with a default_payment_method always has one attached
      if (sub.default_payment_method) hasPaymentMethod = true;

      const price = sub.items?.data?.[0]?.price;
      if (price) {
        amountCents = price.unit_amount;
        currency = price.currency ?? 'usd';
      }
    }
  }

  return { email, hasPaymentMethod, amountCents, currency };
}

// ── Email helpers ──────────────────────────────────────────────────────────────

function formatCurrency(amountCents: number | null, currency: string): string {
  if (amountCents === null) return 'your plan amount';
  const amount = amountCents / 100;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount);
  } catch {
    return `${currency.toUpperCase()} ${amount.toFixed(2)}`;
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return iso;
  }
}

const PRO_FEATURES = [
  'Unlimited Q&A questions',
  'All courses and learning content',
  'Community post creation',
  'Session notes',
  'Wallet features',
];

function buildTrialEndingEmail(trialEndDate: string, appUrl: string): { subject: string; html: string } {
  const dateStr = formatDate(trialEndDate);
  const featureList = PRO_FEATURES.map((f) => `<li>${f}</li>`).join('\n');
  const ctaUrl = `${appUrl}/settings/billing`;

  return {
    subject: `Your trial ends ${dateStr} — confirm your payment method`,
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Your trial is ending soon</title>
</head>
<body style="margin:0;padding:0;background:#fafaf9;font-family:Georgia,serif;color:#1c1c1c;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0"
               style="background:#fff;border-radius:8px;padding:40px 48px;max-width:560px;">
          <tr>
            <td>
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:normal;letter-spacing:-0.3px;">
                Your Pro trial ends soon
              </h1>
              <p style="margin:0 0 24px;color:#666;font-size:14px;">
                Your 14-day free trial expires on <strong>${dateStr}</strong>.
              </p>

              <p style="margin:0 0 12px;font-size:15px;">
                To keep access to Pro features, please confirm your payment method before your trial ends:
              </p>
              <ul style="margin:0 0 24px;padding-left:20px;font-size:15px;line-height:1.7;">
                ${featureList}
              </ul>

              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 32px;">
                <tr>
                  <td style="background:#1c1c1c;border-radius:6px;">
                    <a href="${ctaUrl}"
                       style="display:inline-block;padding:14px 28px;color:#fff;font-family:Georgia,serif;
                              font-size:15px;text-decoration:none;letter-spacing:0.2px;">
                      Confirm payment method →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:13px;color:#999;line-height:1.6;">
                If you don't confirm a payment method before ${dateStr}, your account will revert to the
                free tier automatically. No charges will be made without your payment details on file.
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

function buildAllSetEmail(
  trialEndDate: string,
  amountCents: number | null,
  currency: string,
): { subject: string; html: string } {
  const dateStr = formatDate(trialEndDate);
  const amountStr = formatCurrency(amountCents, currency);

  return {
    subject: `All set — you'll be charged ${amountStr} on ${dateStr}`,
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>You're all set</title>
</head>
<body style="margin:0;padding:0;background:#fafaf9;font-family:Georgia,serif;color:#1c1c1c;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0"
               style="background:#fff;border-radius:8px;padding:40px 48px;max-width:560px;">
          <tr>
            <td>
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:normal;letter-spacing:-0.3px;">
                You're all set
              </h1>
              <p style="margin:0 0 24px;color:#666;font-size:14px;">
                Your payment method is confirmed.
              </p>

              <p style="margin:0 0 24px;font-size:15px;line-height:1.7;">
                Your 14-day Pro trial ends on <strong>${dateStr}</strong>. After that, you'll be
                automatically charged <strong>${amountStr}</strong> — no action needed.
              </p>

              <p style="margin:0;font-size:13px;color:#999;line-height:1.6;">
                You can manage your subscription at any time from your account settings.
                Questions? Reply to this email.
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
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://convergence-mvp.app';
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'noreply@convergence-mvp.app';

  // Query trialing users whose trial ends within the next 3 days and haven't been reminded
  const now = new Date();
  const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const { data: rows, error: queryError } = await supabase
    .from('subscriptions')
    .select('id, user_id, stripe_customer_id, stripe_subscription_id, trial_end')
    .eq('subscription_status', 'trialing')
    .gte('trial_end', now.toISOString())
    .lte('trial_end', in3Days.toISOString())
    .is('trial_reminder_sent', null);

  if (queryError) {
    console.error('[trial-reminders] db_error:', queryError.message);
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: 'Failed to query trialing subscriptions.' } },
      { status: 502 },
    );
  }

  const subscriptions = (rows ?? []) as TrialingSubscription[];

  if (subscriptions.length === 0) {
    console.log('[trial-reminders] no_reminders_due');
    return NextResponse.json({ sent: 0, skipped: 0 });
  }

  let sent = 0;
  let skipped = 0;

  for (const sub of subscriptions) {
    // Mark as sent immediately — before the email call — so a crash mid-loop
    // doesn't cause double-sends on the next run.
    const { error: markError } = await supabase
      .from('subscriptions')
      .update({ trial_reminder_sent: new Date().toISOString() })
      .eq('id', sub.id)
      .is('trial_reminder_sent', null); // idempotency guard

    if (markError) {
      console.error(`[trial-reminders] mark_error user=${sub.user_id}:`, markError.message);
      skipped++;
      continue;
    }

    if (!resendApiKey) {
      console.warn(`[trial-reminders] RESEND_API_KEY not set — skipping email for user=${sub.user_id}`);
      skipped++;
      continue;
    }

    // Fetch Stripe info for email + payment method status
    const { email, hasPaymentMethod, amountCents, currency } = stripeSecretKey
      ? await fetchStripeInfo(stripeSecretKey, sub.stripe_customer_id, sub.stripe_subscription_id)
      : { email: null, hasPaymentMethod: false, amountCents: null, currency: 'usd' };

    if (!email) {
      console.warn(`[trial-reminders] no_email user=${sub.user_id} customer=${sub.stripe_customer_id ?? 'none'}`);
      skipped++;
      continue;
    }

    const { subject, html } = hasPaymentMethod
      ? buildAllSetEmail(sub.trial_end, amountCents, currency)
      : buildTrialEndingEmail(sub.trial_end, appUrl);

    try {
      const resend = new Resend(resendApiKey);
      await resend.emails.send({
        from: `Convergence <${fromEmail}>`,
        to: email,
        subject,
        html,
      });
      sent++;
      console.log(`[trial-reminders] sent user=${sub.user_id} type=${hasPaymentMethod ? 'all_set' : 'trial_ending'}`);
    } catch (err) {
      console.error(`[trial-reminders] resend_error user=${sub.user_id}:`, err);
      Sentry.withScope((scope) => {
        scope.setTag('cron', 'trial-reminders');
        scope.setContext('subscription', { userId: sub.user_id, subscriptionId: sub.id });
        Sentry.captureException(err);
      });
      skipped++;
    }
  }

  console.log(`[trial-reminders] done sent=${sent} skipped=${skipped} total=${subscriptions.length}`);
  return NextResponse.json({ sent, skipped, total: subscriptions.length });
}
