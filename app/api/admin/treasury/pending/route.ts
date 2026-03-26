/**
 * GET /api/admin/treasury/pending
 *
 * Returns PYUSD refund disputes awaiting multi-sig approval. Admin-only.
 * A dispute appears here when it is in 'reviewing' status — i.e. the refund
 * amount exceeds PYUSD_REFUND_THRESHOLD and at least one admin has already
 * cast a vote via the resolve or approve endpoints.
 *
 * Response:
 *   { pending: PendingApproval[], total: number }
 *
 * PendingApproval:
 *   id, payment_session_id, user_id, reason, refund_address,
 *   amount_pyusd, payment_tx_hash, created_at, updated_at,
 *   approvals_received, approvals_required,
 *   approvers: [{ approver_id, approved_at, signature }]
 */
import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { supabase } from '@/lib/supabase';
import type { NextRequest } from 'next/server';

function getRequiredApprovals(): number {
  return parseInt(process.env.PYUSD_REFUND_REQUIRED_APPROVALS ?? '2', 10);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const requiredApprovals = getRequiredApprovals();

  // Fetch disputes in 'reviewing' status with payment session amount
  const { data: disputes, error: disputesErr } = await supabase
    .from('pyusd_disputes')
    .select(
      `id, payment_session_id, user_id, reason, refund_address, status, created_at, updated_at,
       pyusd_payment_sessions!inner(amount_pyusd, tx_hash)`,
    )
    .eq('status', 'reviewing')
    .order('created_at', { ascending: false });

  if (disputesErr) {
    console.error('[treasury/pending] disputes_query_error:', disputesErr.message);
    return NextResponse.json({ error: 'Failed to fetch pending approvals' }, { status: 500 });
  }

  if (!disputes || disputes.length === 0) {
    return NextResponse.json({ pending: [], total: 0 });
  }

  // Fetch all approvals for these disputes in one query
  const disputeIds = disputes.map((d) => d.id);

  const { data: approvals, error: approvalsErr } = await supabase
    .from('pyusd_refund_approvals')
    .select('dispute_id, approver_id, signature, created_at')
    .in('dispute_id', disputeIds)
    .order('created_at', { ascending: true });

  if (approvalsErr) {
    console.error('[treasury/pending] approvals_query_error:', approvalsErr.message);
    return NextResponse.json({ error: 'Failed to fetch approval records' }, { status: 500 });
  }

  // Group approvals by dispute
  const approvalsByDispute = new Map<string, Array<{ approver_id: string; approved_at: string; signature: string | null }>>();
  for (const a of approvals ?? []) {
    const list = approvalsByDispute.get(a.dispute_id) ?? [];
    list.push({ approver_id: a.approver_id, approved_at: a.created_at, signature: a.signature ?? null });
    approvalsByDispute.set(a.dispute_id, list);
  }

  const pending = disputes.map((d) => {
    const session = d.pyusd_payment_sessions as unknown as { amount_pyusd: string; tx_hash: string } | null;
    const disputeApprovals = approvalsByDispute.get(d.id) ?? [];
    return {
      id: d.id,
      payment_session_id: d.payment_session_id,
      user_id: d.user_id,
      reason: d.reason,
      refund_address: d.refund_address,
      amount_pyusd: session?.amount_pyusd ?? '0',
      payment_tx_hash: session?.tx_hash ?? null,
      status: d.status,
      created_at: d.created_at,
      updated_at: d.updated_at,
      approvals_received: disputeApprovals.length,
      approvals_required: requiredApprovals,
      approvers: disputeApprovals,
    };
  });

  return NextResponse.json({ pending, total: pending.length });
}
