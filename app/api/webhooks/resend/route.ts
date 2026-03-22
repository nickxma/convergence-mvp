/**
 * POST /api/webhooks/resend
 *
 * Receives Resend email analytics webhook events (bounces, opens, clicks, etc.)
 * and logs them. Bounce and complaint events are forwarded to Sentry.
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
 *   Events: email.bounced, email.complained, email.delivered, email.opened, email.clicked
 */
import * as Sentry from '@sentry/nextjs';
import { NextRequest, NextResponse } from 'next/server';
import { verifyResendSignature } from '@/lib/webhook-verify';
import { WebhookVerificationError } from 'svix';

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
    // Unexpected error during verification — still reject
    console.error('[resend-webhook] Signature verification error:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let event: { type?: string; [key: string]: unknown };
  try {
    event = JSON.parse(rawBody) as { type?: string; [key: string]: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { type } = event;

  // Capture delivery failures in Sentry
  if (type === 'email.bounced' || type === 'email.complained') {
    Sentry.withScope((scope) => {
      scope.setTag('resend.event', type);
      scope.setLevel('warning');
      scope.setContext('resend_webhook', event);
      Sentry.captureMessage(`Resend webhook: ${type}`, 'warning');
    });
  }

  return NextResponse.json({ ok: true });
}
