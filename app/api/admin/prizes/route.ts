/**
 * GET /api/admin/prizes
 *
 * List all prize shipments with session and machine info.
 * Query params:
 *   status   — filter by status (pending, processing, shipped, delivered, failed)
 *   limit    — max rows (default 50, max 200)
 *   offset   — pagination offset (default 0)
 *
 * Auth: Bearer ADMIN_WALLET
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { supabase } from '@/lib/supabase';

const VALID_STATUSES = new Set(['pending', 'processing', 'shipped', 'delivered', 'failed']);

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return errorResponse(403, 'FORBIDDEN', 'Admin access required.');
  }

  const url = req.nextUrl;
  const statusFilter = url.searchParams.get('status');
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

  if (statusFilter && !VALID_STATUSES.has(statusFilter)) {
    return errorResponse(400, 'BAD_REQUEST', `status must be one of: ${[...VALID_STATUSES].join(', ')}.`);
  }

  let query = supabase
    .from('prize_shipments')
    .select(`
      id, session_id, user_id, status,
      carrier, service, tracking_number, tracking_url, label_url, rate_cents,
      delivery_status, shipped_at, delivered_at, created_at, updated_at,
      address, prize_meta, easypost_shipment_id
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (statusFilter) {
    query = query.eq('status', statusFilter);
  }

  const { data, error, count } = await query;

  if (error) {
    console.error('[admin/prizes] list_error:', error.message);
    return errorResponse(500, 'DB_ERROR', 'Failed to fetch prizes.');
  }

  return NextResponse.json({ prizes: data ?? [], total: count ?? 0, limit, offset });
}
