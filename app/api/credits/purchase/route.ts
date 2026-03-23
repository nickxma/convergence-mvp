/**
 * POST /api/credits/purchase
 *
 * Creates a PYUSD payment session for a credit package purchase.
 * Reuses the same pyusd_payment_sessions table as /api/payments/checkout
 * with fulfillment_type='credit_purchase'.
 *
 * Body:
 *   packageId — credit package id (e.g. "pack_3", "pack_10", "pack_25")
 *
 * Response:
 *   { sessionId, paymentAddress, amountPYUSD, expiresAt, credits }
 *
 * Required env vars:
 *   PYUSD_PAYMENT_ADDRESS — receiving Ethereum address
 */
import { NextResponse } from 'next/server';
import { verifyRequest } from '@/lib/privy-auth';
import { supabase } from '@/lib/supabase';
import type { NextRequest } from 'next/server';

const SESSION_TTL_MINUTES = 30;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await verifyRequest(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const paymentAddress = process.env.PYUSD_PAYMENT_ADDRESS;
  if (!paymentAddress) {
    console.error('[credits/purchase] PYUSD_PAYMENT_ADDRESS is not configured');
    return NextResponse.json({ error: 'Payment not configured — contact support.' }, { status: 503 });
  }

  const body = await req.json().catch(() => ({})) as { packageId?: string };
  const packageId = body.packageId;
  if (!packageId) {
    return NextResponse.json({ error: 'packageId is required.' }, { status: 400 });
  }

  // Fetch package to validate and get price
  const { data: pkg, error: pkgError } = await supabase
    .from('credit_packages')
    .select('id, credits, price_pyusd')
    .eq('id', packageId)
    .eq('active', true)
    .single();

  if (pkgError || !pkg) {
    return NextResponse.json({ error: 'Invalid or unavailable package.' }, { status: 400 });
  }

  const amountPYUSD = String(Number(pkg.price_pyusd).toFixed(6));
  const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('pyusd_payment_sessions')
    .insert({
      user_id: auth.userId,
      payment_address: paymentAddress.toLowerCase(),
      amount_pyusd: amountPYUSD,
      fulfillment_type: 'credit_purchase',
      credit_package_id: packageId,
      expires_at: expiresAt,
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('[credits/purchase] db_insert_error:', error?.message);
    return NextResponse.json({ error: 'Failed to create payment session.' }, { status: 500 });
  }

  return NextResponse.json({
    sessionId: data.id as string,
    paymentAddress,
    amountPYUSD,
    expiresAt,
    credits: pkg.credits as number,
  });
}
