/**
 * GET /api/users/me/prizes
 *
 * Returns the authenticated user's prize history with tracking links.
 *
 * Auth: valid Privy token.
 *
 * Response: { prizes: Prize[] }
 *
 * Prize fields:
 *   id, sessionId, status, carrier, trackingNumber, trackingUrl,
 *   deliveryStatus, shippedAt, deliveredAt, prizeId, wonAt, createdAt
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { verifyRequest } from '@/lib/privy-auth';

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await verifyRequest(req);
  if (!auth) {
    return errorResponse(401, 'UNAUTHORIZED', 'Valid Privy token required.');
  }

  const { data: shipments, error } = await supabase
    .from('prize_shipments')
    .select(
      'id, session_id, status, carrier, service, tracking_number, tracking_url, ' +
        'delivery_status, shipped_at, delivered_at, prize_meta, created_at',
    )
    .eq('user_id', auth.userId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[users/me/prizes] db_error:', error.message);
    return errorResponse(500, 'DB_ERROR', 'Failed to fetch prizes.');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prizes = (shipments ?? []).map((s: Record<string, any>) => ({
    id: s.id as string,
    sessionId: s.session_id as string,
    status: s.status as string,
    carrier: (s.carrier as string | null) ?? null,
    service: (s.service as string | null) ?? null,
    trackingNumber: (s.tracking_number as string | null) ?? null,
    trackingUrl: (s.tracking_url as string | null) ?? null,
    deliveryStatus: (s.delivery_status as string | null) ?? null,
    shippedAt: (s.shipped_at as string | null) ?? null,
    deliveredAt: (s.delivered_at as string | null) ?? null,
    prizeId: (s.prize_meta as Record<string, unknown> | null)?.prizeId ?? null,
    wonAt: (s.prize_meta as Record<string, unknown> | null)?.wonAt ?? null,
    createdAt: s.created_at as string,
  }));

  return NextResponse.json({ prizes });
}
