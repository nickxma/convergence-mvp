/**
 * GET /api/cron/prize-fulfillment
 *
 * Vercel cron job that drains the prize_shipments queue. For each pending
 * shipment:
 *   1. Validate address and generate a shipping label via EasyPost.
 *   2. Update prize_shipments with label_url, tracking_number, carrier, etc.
 *   3. Send a confirmation email to the winner via Resend.
 *   4. Set status to 'shipped'.
 *
 * No-op when EASYPOST_API_KEY is absent.
 *
 * Auth: CRON_SECRET header.
 *
 * Parcel defaults: PRIZE_WEIGHT_OZ (default 16 oz), PRIZE_LENGTH_IN,
 * PRIZE_WIDTH_IN, PRIZE_HEIGHT_IN env vars.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { createAndBuyShipment, ShippingAddress } from '@/lib/easypost';
import { Resend } from 'resend';

const BATCH_SIZE = 5;

interface ShipmentRow {
  id: string;
  session_id: string;
  user_id: string;
  address: ShippingAddress | null;
  prize_meta: Record<string, unknown> | null;
}

function getParcel() {
  return {
    weightOz: parseFloat(process.env.PRIZE_WEIGHT_OZ ?? '16'),
    lengthIn: process.env.PRIZE_LENGTH_IN ? parseFloat(process.env.PRIZE_LENGTH_IN) : undefined,
    widthIn: process.env.PRIZE_WIDTH_IN ? parseFloat(process.env.PRIZE_WIDTH_IN) : undefined,
    heightIn: process.env.PRIZE_HEIGHT_IN ? parseFloat(process.env.PRIZE_HEIGHT_IN) : undefined,
  };
}

async function sendConfirmationEmail(
  resendKey: string,
  toAddress: ShippingAddress,
  trackingNumber: string,
  trackingUrl: string,
  carrier: string,
): Promise<void> {
  const fromEmail =
    process.env.EMAIL_FROM ?? process.env.RESEND_FROM ?? 'prizes@openclaw.io';

  const resend = new Resend(resendKey);
  await resend.emails.send({
    from: fromEmail,
    to: toAddress.name
      ? `${toAddress.name} <${toAddress.name}>`
      : (toAddress as unknown as { email?: string }).email ?? '',
    subject: '🎉 Your OpenClaw prize is on its way!',
    html: `
      <p>Hi ${toAddress.name ?? 'winner'},</p>
      <p>Your prize has been shipped! Here are your tracking details:</p>
      <ul>
        <li><strong>Carrier:</strong> ${carrier}</li>
        <li><strong>Tracking number:</strong> ${trackingNumber}</li>
        <li><strong>Track your package:</strong> <a href="${trackingUrl}">${trackingUrl}</a></li>
      </ul>
      <p>Thanks for playing OpenClaw!</p>
    `,
  });
}

async function processFulfillment(
  shipment: ShipmentRow,
  easypostKey: string,
  resendKey: string | null,
): Promise<void> {
  // Claim atomically
  const { data: claimed } = await supabase
    .from('prize_shipments')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', shipment.id)
    .eq('status', 'pending')
    .select('id');

  if (!claimed || claimed.length === 0) {
    console.log(`[prize-fulfillment] skip shipment=${shipment.id} — already claimed`);
    return;
  }

  if (!shipment.address) {
    throw new Error('No shipping address on shipment');
  }

  const parcel = getParcel();
  const bought = await createAndBuyShipment(shipment.address, parcel, easypostKey);

  const now = new Date().toISOString();
  await supabase
    .from('prize_shipments')
    .update({
      status: 'shipped',
      carrier: bought.carrier,
      service: bought.service,
      label_url: bought.labelUrl,
      tracking_number: bought.trackingNumber,
      tracking_url: bought.trackingUrl,
      rate_cents: bought.rateCents,
      easypost_shipment_id: bought.easypostShipmentId,
      delivery_status: 'pre_transit',
      shipped_at: now,
      updated_at: now,
    })
    .eq('id', shipment.id);

  // Send confirmation email if Resend key and email available
  const recipientEmail =
    (shipment.address as unknown as { email?: string }).email ??
    (shipment.prize_meta as unknown as { email?: string } | null)?.email ??
    null;

  if (resendKey && recipientEmail) {
    try {
      await sendConfirmationEmail(
        resendKey,
        { ...shipment.address, name: shipment.address.name ?? '' },
        bought.trackingNumber,
        bought.trackingUrl,
        bought.carrier,
      );
    } catch (emailErr) {
      // Non-fatal — label was bought; log and continue
      console.error(
        `[prize-fulfillment] email_error shipment=${shipment.id}:`,
        emailErr instanceof Error ? emailErr.message : emailErr,
      );
    }
  }

  console.info(
    `[prize-fulfillment] shipped shipment=${shipment.id} ` +
      `carrier=${bought.carrier} tracking=${bought.trackingNumber}`,
  );
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const easypostKey = process.env.EASYPOST_API_KEY;
  if (!easypostKey) {
    return NextResponse.json({ skipped: true, reason: 'EASYPOST_NOT_CONFIGURED' });
  }

  const resendKey = process.env.RESEND_API_KEY ?? null;

  const { data: shipments, error: fetchErr } = await supabase
    .from('prize_shipments')
    .select('id, session_id, user_id, address, prize_meta')
    .eq('status', 'pending')
    .not('address', 'is', null)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (fetchErr) {
    console.error('[prize-fulfillment] fetch_error:', fetchErr.message);
    return NextResponse.json({ error: 'DB query failed' }, { status: 502 });
  }

  if (!shipments || shipments.length === 0) {
    return NextResponse.json({ processed: 0, failed: 0 });
  }

  let processed = 0;
  let failed = 0;

  for (const shipment of shipments as ShipmentRow[]) {
    try {
      await processFulfillment(shipment, easypostKey, resendKey);
      processed++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[prize-fulfillment] error shipment=${shipment.id}:`, errMsg);
      await supabase
        .from('prize_shipments')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', shipment.id);
      failed++;
    }
  }

  return NextResponse.json({ processed, failed });
}
