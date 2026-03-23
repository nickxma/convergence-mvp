/**
 * POST /api/webhooks/pyusd-transfer
 *
 * Receives Alchemy TOKEN_ACTIVITY webhook events for PYUSD transfers on Ethereum.
 * For each inbound transfer to the payment address:
 *   1. Finds an open (pending, non-expired) session matching toAddress + value.
 *   2. Marks the session paid (with the tx_hash for idempotency).
 *   3. Dispatches fulfillment based on session.fulfillment_type:
 *      - 'subscription'     → upsert_subscription RPC (existing behavior)
 *      - 'credit_purchase'  → add_user_credits RPC (new)
 *
 * Idempotency: duplicate webhook events carrying the same tx_hash are silently
 * accepted (HTTP 200) without re-fulfilling the session.
 *
 * Security: validates x-alchemy-signature (HMAC-SHA256) using
 * ALCHEMY_WEBHOOK_SIGNING_KEY. Unsigned or tampered requests are rejected with 401.
 *
 * Required env vars:
 *   ALCHEMY_WEBHOOK_SIGNING_KEY — signing key from the Alchemy webhook dashboard
 *   PYUSD_CONTRACT_ADDRESS      — PYUSD ERC-20 contract (default: canonical mainnet address)
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const DEFAULT_PYUSD_CONTRACT = '0x6c3ea9036406852006290770BEdFcAbA0e23A0e8';

interface AlchemyActivity {
  fromAddress: string;
  toAddress: string;
  blockNum: string;
  hash: string;
  value: number;
  asset: string;
  rawContract: {
    rawValue: string;
    address: string;
    decimals: number;
  };
  category: string;
  typeTraceAddress?: string;
}

interface AlchemyWebhookEvent {
  webhookId: string;
  id: string;
  createdAt: string;
  type: string;
  event: {
    network: string;
    activity: AlchemyActivity[];
  };
}

function verifyAlchemySignature(rawBody: string, signature: string, signingKey: string): boolean {
  const expected = createHmac('sha256', signingKey).update(rawBody, 'utf8').digest('hex');
  try {
    return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

async function fulfillSubscription(
  userId: string,
  tier: string,
  amountPYUSD: number,
  planId: string | null,
  txHash: string,
): Promise<void> {
  const currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase.rpc('upsert_subscription', {
    p_user_id: userId,
    p_wallet_address: null,
    p_tier: tier,
    p_stripe_subscriber: false,
    p_stripe_customer_id: null,
    p_stripe_subscription_id: null,
    p_subscription_status: 'active',
    p_current_period_end: currentPeriodEnd,
  });

  if (error) {
    throw new Error(`upsert_subscription failed: ${error.message}`);
  }

  // Log payment history for billing page
  await supabase.from('subscription_payment_history').insert({
    user_id: userId,
    plan_id: planId ?? tier,
    amount_pyusd: amountPYUSD,
    tx_hash: txHash,
    period_end: currentPeriodEnd,
  });
}

async function fulfillCreditPurchase(
  userId: string,
  packageId: string,
  txHash: string,
): Promise<void> {
  // Fetch package to get credit count
  const { data: pkg, error: pkgError } = await supabase
    .from('credit_packages')
    .select('credits')
    .eq('id', packageId)
    .single();

  if (pkgError || !pkg) {
    throw new Error(`credit_package not found: ${packageId}`);
  }

  const { error } = await supabase.rpc('add_user_credits', {
    p_user_id: userId,
    p_amount: pkg.credits as number,
  });

  if (error) {
    throw new Error(`add_user_credits failed: ${error.message}`);
  }

  console.info(
    `[pyusd-webhook] credits added user=${userId} package=${packageId} credits=${pkg.credits} tx=${txHash}`,
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const signingKey = process.env.ALCHEMY_WEBHOOK_SIGNING_KEY;
  if (!signingKey) {
    console.error('[pyusd-webhook] ALCHEMY_WEBHOOK_SIGNING_KEY is not configured');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get('x-alchemy-signature') ?? '';

  if (!signature || !verifyAlchemySignature(rawBody, signature, signingKey)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: AlchemyWebhookEvent;
  try {
    payload = JSON.parse(rawBody) as AlchemyWebhookEvent;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (payload.type !== 'TOKEN_ACTIVITY') {
    return NextResponse.json({ ok: true });
  }

  const pyusdContract = (
    process.env.PYUSD_CONTRACT_ADDRESS ?? DEFAULT_PYUSD_CONTRACT
  ).toLowerCase();

  const pyusdActivity = (payload.event?.activity ?? []).filter(
    (a) =>
      a.category === 'token' &&
      a.rawContract?.address?.toLowerCase() === pyusdContract &&
      typeof a.value === 'number' &&
      a.value > 0,
  );

  if (pyusdActivity.length === 0) {
    return NextResponse.json({ ok: true });
  }

  const now = new Date().toISOString();

  for (const activity of pyusdActivity) {
    const txHash = activity.hash.toLowerCase();
    const toAddress = activity.toAddress.toLowerCase();
    const transferValue = activity.value;

    // Idempotency: skip if tx already processed
    const { count: alreadyFulfilled } = await supabase
      .from('pyusd_payment_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('tx_hash', txHash);

    if ((alreadyFulfilled ?? 0) > 0) {
      console.info(`[pyusd-webhook] duplicate tx_hash=${txHash} — skipped`);
      continue;
    }

    // Find matching pending session (include fulfillment_type and credit_package_id)
    const { data: session, error: sessionErr } = await supabase
      .from('pyusd_payment_sessions')
      .select('id, user_id, tier, fulfillment_type, credit_package_id, amount_pyusd')
      .eq('payment_address', toAddress)
      .eq('amount_pyusd', transferValue)
      .eq('status', 'pending')
      .gt('expires_at', now)
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    if (sessionErr || !session) {
      console.info(
        `[pyusd-webhook] no matching session for toAddress=${toAddress} value=${transferValue} tx=${txHash}`,
      );
      continue;
    }

    // Mark session paid
    const { error: updateErr } = await supabase
      .from('pyusd_payment_sessions')
      .update({ status: 'paid', tx_hash: txHash, fulfilled_at: now, updated_at: now })
      .eq('id', session.id)
      .eq('status', 'pending');

    if (updateErr) {
      if (updateErr.code === '23505') {
        console.info(`[pyusd-webhook] tx_hash conflict for session=${session.id} — skipped`);
        continue;
      }
      console.error(`[pyusd-webhook] session_update_error session=${session.id}:`, updateErr.message);
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }

    // Dispatch fulfillment by type
    const fulfillmentType = (session.fulfillment_type as string) ?? 'subscription';

    try {
      if (fulfillmentType === 'credit_purchase') {
        const packageId = session.credit_package_id as string | null;
        if (!packageId) {
          throw new Error('credit_package_id missing on credit_purchase session');
        }
        await fulfillCreditPurchase(session.user_id as string, packageId, txHash);
      } else {
        // subscription (default)
        await fulfillSubscription(
          session.user_id as string,
          (session.tier as string) ?? 'pro',
          Number(session.amount_pyusd),
          null,
          txHash,
        );
      }
      console.info(
        `[pyusd-webhook] fulfilled session=${session.id} type=${fulfillmentType} user=${session.user_id} tx=${txHash}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[pyusd-webhook] fulfillment_error session=${session.id}:`, msg);
    }
  }

  return NextResponse.json({ ok: true });
}
