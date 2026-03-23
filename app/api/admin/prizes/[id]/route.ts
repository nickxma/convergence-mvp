/**
 * GET   /api/admin/prizes/:id  — get single prize shipment detail
 * PATCH /api/admin/prizes/:id  — update prize shipment (mark shipped, update status)
 *
 * Auth: Bearer ADMIN_WALLET
 *
 * PATCH body (all optional):
 *   status           'pending'|'processing'|'shipped'|'delivered'|'failed'
 *   trackingNumber   string
 *   trackingUrl      string
 *   labelUrl         string
 *   carrier          string
 *   deliveryStatus   string
 *
 * Setting status to 'shipped' automatically records shipped_at timestamp.
 * Setting status to 'delivered' automatically records delivered_at timestamp.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { supabase } from '@/lib/supabase';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_STATUSES = new Set(['pending', 'processing', 'shipped', 'delivered', 'failed']);
const VALID_DELIVERY_STATUSES = new Set([
  'pre_transit', 'in_transit', 'out_for_delivery', 'delivered', 'error',
]);

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return errorResponse(403, 'FORBIDDEN', 'Admin access required.');
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return errorResponse(400, 'BAD_REQUEST', 'Invalid prize shipment id.');
  }

  const { data, error } = await supabase
    .from('prize_shipments')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) {
    return errorResponse(404, 'NOT_FOUND', 'Prize shipment not found.');
  }

  return NextResponse.json({ prize: data });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return errorResponse(403, 'FORBIDDEN', 'Admin access required.');
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return errorResponse(400, 'BAD_REQUEST', 'Invalid prize shipment id.');
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'BAD_REQUEST', 'Invalid JSON body.');
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (body.status !== undefined) {
    if (!VALID_STATUSES.has(body.status as string)) {
      return errorResponse(400, 'BAD_REQUEST', `status must be one of: ${[...VALID_STATUSES].join(', ')}.`);
    }
    updates.status = body.status;
    if (body.status === 'shipped' && !body.shippedAt) {
      updates.shipped_at = new Date().toISOString();
    }
    if (body.status === 'delivered' && !body.deliveredAt) {
      updates.delivered_at = new Date().toISOString();
    }
  }
  if (body.trackingNumber !== undefined) updates.tracking_number = body.trackingNumber;
  if (body.trackingUrl !== undefined) updates.tracking_url = body.trackingUrl;
  if (body.labelUrl !== undefined) updates.label_url = body.labelUrl;
  if (body.carrier !== undefined) updates.carrier = body.carrier;
  if (body.deliveryStatus !== undefined) {
    if (!VALID_DELIVERY_STATUSES.has(body.deliveryStatus as string)) {
      return errorResponse(400, 'BAD_REQUEST', 'Invalid deliveryStatus value.');
    }
    updates.delivery_status = body.deliveryStatus;
  }

  if (Object.keys(updates).length === 1) {
    return errorResponse(400, 'BAD_REQUEST', 'No valid fields to update.');
  }

  const { data: updated, error: updateErr } = await supabase
    .from('prize_shipments')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (updateErr) {
    if (updateErr.code === 'PGRST116') {
      return errorResponse(404, 'NOT_FOUND', 'Prize shipment not found.');
    }
    console.error('[admin/prizes/patch] db_error:', updateErr.message);
    return errorResponse(500, 'DB_ERROR', 'Failed to update prize shipment.');
  }

  return NextResponse.json({ prize: updated });
}
