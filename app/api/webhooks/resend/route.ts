/**
 * POST /api/webhooks/resend
 *
 * Receives Resend email analytics webhook events (bounces, opens, clicks, etc.),
 * persists them to the email_events table for the newsletter analytics dashboard,
 * and forwards delivery failures to Sentry.
 *
 * Security: Validates svix-id / svix-timestamp / svix-signature headers using
 * RESEND_WEBHOOK_SECRET. Requests with invalid or missing signatures are rejected
 * with 401. Payloads with timestamps older than 5 minutes are also rejected
 * (enforced by svix internally).
 *
 * Resend webhook docs:
 *   https://resend.com/docs/dashboard/webhooks/introduction
 *
 * Registration:
 *   Resend dashboard → Webhooks → Add
 *   URL: https://convergence-mvp.vercel.app/api/webhooks/resend
 *   Events: email.bounced, email.complained, email.delivered, email.opened, email.clicked, email.unsubscribed
 */
import * as Sentry from '@sentry/nextjs';
import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { verifyResendSignature } from '@/lib/webhook-verify';
import { WebhookVerificationError } from 'svix';
import { supabase } from '@/lib/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ResendEventData {
  created_at?: string;
  email_id?: string;
  from?: string;
  to?: string[];
  subject?: string;
  tags?: Array<{ name: string; value: string }>;
  click?: { link?: string };
}

interface ResendEvent {
  type?: string;
  created_at?: string;
  data?: ResendEventData;
  [key: string]: unknown;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Derive a stable campaign_id from the event data.
 * Prefers a Resend tag named "campaign_id"; falls back to a sha256 of the
 * lowercased subject so the same newsletter send always maps to the same ID.
 */
function deriveCampaignId(data: ResendEventData): string | null {
  const tag = data.tags?.find((t) => t.name === 'campaign_id');
  if (tag?.value) return tag.value;
  if (data.subject) {
    return createHash('sha256').update(data.subject.toLowerCase().trim()).digest('hex').slice(0, 16);
  }
  return null;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[resend-webhook] RESEND_WEBHOOK_SECRET is not configured');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const rawBody = await req.text();

  const svixId = req.headers.get('svix-id') ?? '';
  const svixTimestamp = req.headers.get('svix-timestamp') ?? '';
  const svixSignature = req.headers.get('svix-signature') ?? '';

  try {
    verifyResendSignature(
      rawBody,
      { 'svix-id': svixId, 'svix-timestamp': svixTimestamp, 'svix-signature': svixSignature },
      secret,
    );
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
    console.error('[resend-webhook] Signature verification error:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(rawBody) as ResendEvent;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { type, data = {} } = event;

  // Capture delivery failures in Sentry
  if (type === 'email.bounced' || type === 'email.complained') {
    Sentry.withScope((scope) => {
      scope.setTag('resend.event', type);
      scope.setLevel('warning');
      scope.setContext('resend_webhook', event as Record<string, unknown>);
      Sentry.captureMessage(`Resend webhook: ${type}`, 'warning');
    });
  }

  // Persist event to email_events table for the newsletter analytics dashboard.
  // Strip the "email." prefix so stored values are: delivered, opened, clicked, etc.
  const eventType = type?.startsWith('email.') ? type.slice(6) : (type ?? 'unknown');
  const resendMessageId = data.email_id ?? svixId; // svixId as fallback to avoid null
  const toEmail = data.to?.[0] ?? null;
  const campaignId = deriveCampaignId(data);
  const campaignName = data.subject ?? null;
  const clickLink = data.click?.link ?? null;
  const eventAt = data.created_at ? new Date(data.created_at).toISOString() : null;

  const { error: dbError } = await supabase.from('email_events').insert({
    event_at: eventAt,
    resend_message_id: resendMessageId,
    event_type: eventType,
    to_email: toEmail,
    campaign_name: campaignName,
    campaign_id: campaignId,
    click_link: clickLink,
    raw: event as Record<string, unknown>,
  });

  if (dbError) {
    // Conflict = duplicate (unique index hit) — idempotent, not an error.
    if (dbError.code !== '23505') {
      console.error('[resend-webhook] db_insert_error:', dbError.message);
      // Still return 200 so Resend does not retry — the event was validated.
    }
  }

  return NextResponse.json({ ok: true });
}
