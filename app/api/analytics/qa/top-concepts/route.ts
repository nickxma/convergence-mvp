/**
 * GET /api/analytics/qa/top-concepts — Top concept nodes by corpus coverage
 *
 * Auth: Authorization: Bearer <ADMIN_WALLET>
 *
 * Query params:
 *   days  — look-back window in days (default 30, max 365)
 *
 * Response:
 *   concepts  — array of { name, count } sorted by count desc
 *   days      — effective look-back window
 *   total     — sum of all concept chunk counts in window
 *
 * Note: "count" reflects how many corpus chunks reference each concept
 * (chunk_count on the concepts table). Concepts are filtered by updated_at
 * within the requested window so the chart reflects recent knowledge-base state.
 * Per-query concept tracking requires OLU-623 instrumentation in /api/ask.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-auth';

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return errorResponse(401, 'UNAUTHORIZED', 'Admin access required.');
  }

  const { searchParams } = new URL(req.url);
  const rawDays = parseInt(searchParams.get('days') ?? '30', 10);
  const days = Number.isFinite(rawDays) ? Math.min(Math.max(rawDays, 1), 365) : 30;

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('concepts')
    .select('name, chunk_count')
    .gte('updated_at', since)
    .gt('chunk_count', 0)
    .order('chunk_count', { ascending: false })
    .limit(20);

  if (error) {
    console.error('[/api/analytics/qa/top-concepts] db_error:', error.message);
    return errorResponse(502, 'DB_ERROR', 'Failed to query concept data.');
  }

  const concepts = (data ?? []).map((c) => ({ name: c.name, count: c.chunk_count }));
  const total = concepts.reduce((sum, c) => sum + c.count, 0);

  return NextResponse.json({ concepts, days, total });
}
