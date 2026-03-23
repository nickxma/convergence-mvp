/**
 * GET /api/admin/audit-log
 *
 * Returns paginated admin/governance audit log entries.
 *
 * Query params:
 *   limit     — rows per page (default 50, max 200)
 *   before    — cursor: return rows with id < before (for pagination)
 *   since     — ISO timestamp lower bound (inclusive)
 *   until     — ISO timestamp upper bound (inclusive)
 *   action    — filter by exact action string (e.g. 'content.publish')
 *   actorId   — filter by actor_id
 *
 * Auth: Authorization: Bearer <ADMIN_WALLET>
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-auth';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return errorResponse(401, 'UNAUTHORIZED', 'Admin access required.');
  }

  const { searchParams } = req.nextUrl;

  const rawLimit = parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10);
  const limit = Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : DEFAULT_LIMIT, MAX_LIMIT);

  const before = searchParams.get('before');
  const since  = searchParams.get('since');
  const until  = searchParams.get('until');
  const action = searchParams.get('action');
  const actorId = searchParams.get('actorId');

  let query = supabase
    .from('admin_audit_log')
    .select('id, actor_id, actor_role, action, target_id, target_type, metadata, created_at')
    .order('id', { ascending: false })
    .limit(limit);

  if (before) {
    const beforeId = parseInt(before, 10);
    if (Number.isFinite(beforeId)) query = query.lt('id', beforeId);
  }
  if (since)   query = query.gte('created_at', since);
  if (until)   query = query.lte('created_at', until);
  if (action)  query = query.eq('action', action);
  if (actorId) query = query.eq('actor_id', actorId);

  const { data, error } = await query;

  if (error) {
    console.error('[admin/audit-log] db_error:', error.message);
    return errorResponse(500, 'DB_ERROR', 'Failed to query audit log.');
  }

  const rows = data ?? [];
  const nextCursor = rows.length === limit ? String(rows[rows.length - 1].id) : null;

  return NextResponse.json({
    entries: rows,
    pagination: {
      limit,
      nextCursor,
      hasMore: nextCursor !== null,
    },
  });
}
