/**
 * POST /api/webhooks/easypost
 *
 * EasyPost webhook endpoint for tracker events.
 * Updates prize_shipments.delivery_status when a tracking event is received.
 *
 * EasyPost sends events as JSON with { description: 'tracker.updated', result: Tracker }.
 * The Tracker object has { tracking_code, status, shipment_id? }.
 *
 * Security: EasyPost webhook secret validation via HMAC-SHA256.
 * Set EASYPOST_WEBHOOK_SECRET to the secret configured in your EasyPost dashboard.
 * When not set, the endpoint is open (OK for early dev; enforce in production).
 *
 * Idempotent — safe for EasyPost's at-least-once delivery.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { supabase } from '@/lib/supabase';

// Map EasyPost tracker statuses to our delivery_status enum
const STATUS_MAP: Record<string, string> = {
  pre_transit: 'pre_transit',
  in_transit: 'in_transit',
  out_for_delivery: 'out_for_delivery',
  delivered: 'delivered',
  error: 'error',
  failure: 'error',
  return_to_sender: 'error',
  unknown: 'in_transit',
};

function verifySignature(body: string, sigHeader: string, secret: string): boolean {
  const expected = createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('hex');
  // EasyPost sends "sha256=<hex>" format
  const provided = sigHeader.replace(/^sha256=/, '');
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(provided, 'hex');
    if (a.length !== b.length) return false;
    // Constant-time comparison
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();

  // Signature verification when secret is configured
  const webhookSecret = process.env.EASYPOST_WEBHOOK_SECRET;
  if (webhookSecret) {
    const sig = req.headers.get('x-hmac-signature') ?? req.headers.get('x-easypost-signature') ?? '';
    if (!sig || !verifySignature(rawBody, sig, webhookSecret)) {
      console.warn('[webhooks/easypost] invalid_signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const description = payload.description as string | undefined;
  if (!description?.startsWith('tracker.')) {
    // Acknowledge non-tracker events silently
    return NextResponse.json({ ok: true });
  }

  const tracker = payload.result as Record<string, unknown> | undefined;
  if (!tracker) return NextResponse.json({ ok: true });

  const easypostStatus = (tracker.status as string | undefined) ?? 'unknown';
  const deliveryStatus = STATUS_MAP[easypostStatus] ?? 'in_transit';
  const trackingCode = tracker.tracking_code as string | undefined;
  // EasyPost tracker may also carry shipment_id
  const shipmentId = (tracker.shipment_id ?? tracker.easypost_id) as string | undefined;

  if (!trackingCode && !shipmentId) {
    console.warn('[webhooks/easypost] missing tracking_code and shipment_id');
    return NextResponse.json({ ok: true });
  }

  // Find the shipment by easypost_shipment_id or tracking_number
  let query = supabase
    .from('prize_shipments')
    .select('id, status')
    .limit(1);

  if (shipmentId) {
    query = query.eq('easypost_shipment_id', shipmentId);
  } else if (trackingCode) {
    query = query.eq('tracking_number', trackingCode);
  }

  const { data: rows } = await query;
  const row = rows?.[0];

  if (!row) {
    console.warn(
      `[webhooks/easypost] shipment_not_found trackingCode=${trackingCode} shipmentId=${shipmentId}`,
    );
    return NextResponse.json({ ok: true }); // 200 to prevent EasyPost retries
  }

  const now = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    delivery_status: deliveryStatus,
    updated_at: now,
  };

  if (deliveryStatus === 'delivered' && row.status !== 'delivered') {
    updatePayload.status = 'delivered';
    updatePayload.delivered_at = now;
  }

  await supabase
    .from('prize_shipments')
    .update(updatePayload)
    .eq('id', row.id as string);

  console.info(
    `[webhooks/easypost] updated shipment=${row.id} ` +
      `deliveryStatus=${deliveryStatus} rawStatus=${easypostStatus}`,
  );

  return NextResponse.json({ ok: true });
}
