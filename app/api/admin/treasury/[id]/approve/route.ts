/**
 * POST /api/admin/treasury/:id/approve
 *
 * Records an admin approval (with optional cryptographic signature) for a
 * high-value PYUSD refund dispute that is in 'reviewing' status. Admin-only.
 *
 * Each admin may approve once (unique constraint on dispute_id + approver_id).
 * When the approval count reaches PYUSD_REFUND_REQUIRED_APPROVALS (default 2),
 * the on-chain refund is executed automatically.
 *
 * Body (all optional):
 *   signature — hex string representing admin's cryptographic sign-off
 *
 * Response:
 *   { status, approvalsReceived, approvalsRequired }          — quorum not yet met
 *   { status: "resolved", action: "refund", txHash }          — quorum met, refund executed
 *
 * On quorum:
 *   - Sends PYUSD on-chain via lib/pyusd-refund.ts
 *   - Marks pyusd_payment_session as 'refunded'
 *   - Sends confirmation email to user via Resend
 *   - Notifies admin approvers via Resend (ADMIN_NOTIFICATION_EMAILS)
 *   - Logs all actions to admin_audit_log
 *
 * Required env vars (for on-chain execution):
 *   TREASURY_PRIVATE_KEY              — treasury wallet private key
 *   ETH_RPC_URL                       — Ethereum RPC endpoint
 *   RESEND_API_KEY                    — Resend API key for email
 *   RESEND_FROM_EMAIL                 — sender address (default: noreply@convergence.app)
 *   PYUSD_REFUND_REQUIRED_APPROVALS   — approvals needed (default: 2)
 *   ADMIN_NOTIFICATION_EMAILS         — comma-separated admin emails for notifications (optional)
 */
import { NextResponse } from 'next/server';
import { isAdminRequest, getAdminWallet } from '@/lib/admin-auth';
import { supabase } from '@/lib/supabase';
import { sendPYUSDRefund } from '@/lib/pyusd-refund';
import { logAudit } from '@/lib/admin-audit-log';
import type { NextRequest } from 'next/server';

function getRequiredApprovals(): number {
  return parseInt(process.env.PYUSD_REFUND_REQUIRED_APPROVALS ?? '2', 10);
}

// ── Email helpers ─────────────────────────────────────────────────────────────

async function sendUserRefundEmail(
  userId: string,
  amountPYUSD: string,
  txHash: string,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const from = process.env.RESEND_FROM_EMAIL ?? 'noreply@convergence.app';
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [from], // fallback until user email lookup is implemented
        subject: 'Your PYUSD refund has been processed',
        html: `
          <p>Your refund of <strong>${amountPYUSD} PYUSD</strong> has been processed.</p>
          <p>Transaction: <code>${txHash}</code></p>
          <p>The funds will appear in your wallet once the transaction is confirmed on-chain.</p>
        `,
        tags: [{ name: 'type', value: 'refund_confirmation' }],
      }),
    });
  } catch {
    /* non-blocking */
  }
  void userId; // userId available for future Privy email lookup
}

async function notifyAdminApprovers(
  disputeId: string,
  amountPYUSD: string,
  txHash: string,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const rawEmails = process.env.ADMIN_NOTIFICATION_EMAILS ?? '';
  if (!apiKey || !rawEmails.trim()) return;

  const emails = rawEmails
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);

  if (emails.length === 0) return;

  const from = process.env.RESEND_FROM_EMAIL ?? 'noreply@convergence.app';
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: emails,
        subject: 'Treasury: PYUSD refund executed',
        html: `
          <p>A high-value PYUSD refund reached quorum and was executed on-chain.</p>
          <p><strong>Dispute ID:</strong> <code>${disputeId}</code></p>
          <p><strong>Amount:</strong> ${amountPYUSD} PYUSD</p>
          <p><strong>Transaction:</strong> <code>${txHash}</code></p>
        `,
        tags: [{ name: 'type', value: 'treasury_refund_executed' }],
      }),
    });
  } catch {
    /* non-blocking */
  }
}

async function notifyPendingApproval(
  disputeId: string,
  amountPYUSD: string,
  approvalsReceived: number,
  approvalsRequired: number,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const rawEmails = process.env.ADMIN_NOTIFICATION_EMAILS ?? '';
  if (!apiKey || !rawEmails.trim()) return;

  const emails = rawEmails
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);

  if (emails.length === 0) return;

  const from = process.env.RESEND_FROM_EMAIL ?? 'noreply@convergence.app';
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: emails,
        subject: `Treasury: refund approval needed (${approvalsReceived}/${approvalsRequired})`,
        html: `
          <p>A high-value PYUSD refund requires your approval.</p>
          <p><strong>Dispute ID:</strong> <code>${disputeId}</code></p>
          <p><strong>Amount:</strong> ${amountPYUSD} PYUSD</p>
          <p><strong>Approvals:</strong> ${approvalsReceived} of ${approvalsRequired} received</p>
          <p>Review and approve at <a href="/admin/treasury">/admin/treasury</a>.</p>
        `,
        tags: [{ name: 'type', value: 'treasury_approval_needed' }],
      }),
    });
  } catch {
    /* non-blocking */
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id: disputeId } = await params;
  const adminWallet = getAdminWallet(req) ?? 'unknown';

  let body: { signature?: string } = {};
  try {
    body = await req.json();
  } catch {
    // body is optional
  }
  const signature = typeof body.signature === 'string' ? body.signature.trim() : null;

  // Fetch dispute (must be in reviewing state)
  const { data: dispute, error: fetchErr } = await supabase
    .from('pyusd_disputes')
    .select(
      `id, payment_session_id, user_id, refund_address, status,
       pyusd_payment_sessions!inner(amount_pyusd)`,
    )
    .eq('id', disputeId)
    .eq('status', 'reviewing')
    .single();

  if (fetchErr || !dispute) {
    return NextResponse.json(
      { error: 'Dispute not found or not in reviewing status' },
      { status: 404 },
    );
  }

  const amountPYUSD = String(
    (dispute.pyusd_payment_sessions as unknown as { amount_pyusd: string }).amount_pyusd,
  );
  const requiredApprovals = getRequiredApprovals();

  // Record approval with optional signature (idempotent on wallet)
  const upsertPayload: Record<string, unknown> = {
    dispute_id: disputeId,
    approver_id: adminWallet,
  };
  if (signature) upsertPayload.signature = signature;

  const { error: approvalErr } = await supabase
    .from('pyusd_refund_approvals')
    .upsert(upsertPayload, { onConflict: 'dispute_id,approver_id' });

  if (approvalErr) {
    console.error('[treasury/approve] upsert_error:', approvalErr.message);
    return NextResponse.json({ error: 'Failed to record approval' }, { status: 500 });
  }

  // Count current approvals
  const { count: approvalCount } = await supabase
    .from('pyusd_refund_approvals')
    .select('id', { count: 'exact', head: true })
    .eq('dispute_id', disputeId);

  const current = approvalCount ?? 0;

  logAudit({
    actorId: adminWallet,
    actorRole: 'admin',
    action: 'dispute.refund_approved',
    targetId: disputeId,
    targetType: 'pyusd_dispute',
    metadata: { amountPYUSD, approvalsReceived: current, requiredApprovals, signature: signature ?? undefined },
  });

  if (current < requiredApprovals) {
    // Notify remaining approvers (non-blocking)
    notifyPendingApproval(disputeId, amountPYUSD, current, requiredApprovals).catch(() => undefined);

    return NextResponse.json({
      status: 'reviewing',
      approvalsReceived: current,
      approvalsRequired: requiredApprovals,
    });
  }

  // Quorum met — execute on-chain refund
  try {
    const { txHash } = await sendPYUSDRefund(dispute.refund_address, amountPYUSD);

    const now = new Date().toISOString();

    await supabase
      .from('pyusd_disputes')
      .update({
        status: 'resolved',
        action_taken: 'refund',
        refund_tx_hash: txHash,
        resolved_at: now,
        resolved_by: adminWallet,
        updated_at: now,
      })
      .eq('id', disputeId);

    await supabase
      .from('pyusd_payment_sessions')
      .update({ status: 'refunded', updated_at: now })
      .eq('id', dispute.payment_session_id);

    // Notify user and admins (non-blocking)
    sendUserRefundEmail(dispute.user_id, amountPYUSD, txHash).catch(() => undefined);
    notifyAdminApprovers(disputeId, amountPYUSD, txHash).catch(() => undefined);

    logAudit({
      actorId: adminWallet,
      actorRole: 'admin',
      action: 'dispute.refund_executed',
      targetId: disputeId,
      targetType: 'pyusd_dispute',
      metadata: { txHash, amountPYUSD, refundAddress: dispute.refund_address },
    });

    return NextResponse.json({ status: 'resolved', action: 'refund', txHash });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[treasury/approve] on-chain refund failed:', msg);
    return NextResponse.json({ error: 'On-chain refund failed', detail: msg }, { status: 502 });
  }
}
