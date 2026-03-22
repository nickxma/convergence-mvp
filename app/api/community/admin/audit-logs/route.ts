/**
 * GET /api/community/admin/audit-logs — paginated audit log for moderation actions
 *
 * Admin wallet only (Authorization: Bearer <ADMIN_WALLET>).
 *
 * Query params:
 *   action        — filter by action: flag | auto_hide | remove | restore
 *   target_post_id — filter by post ID
 *   limit         — rows per page (default 50, max 200)
 *   before        — return rows with id < before (cursor pagination)
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-auth';

const VALID_ACTIONS = new Set(['flag', 'auto_hide', 'remove', 'restore']);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return errorResponse(401, 'UNAUTHORIZED', 'Admin access required.');
  }

  const { searchParams } = new URL(req.url);

  const actionFilter = searchParams.get('action');
  if (actionFilter && !VALID_ACTIONS.has(actionFilter)) {
    return errorResponse(400, 'INVALID_ACTION', `action must be one of: ${[...VALID_ACTIONS].join(', ')}`);
  }

  const postIdParam = searchParams.get('target_post_id');
  const targetPostId = postIdParam ? parseInt(postIdParam, 10) : null;
  if (postIdParam && (!Number.isFinite(targetPostId) || (targetPostId as number) < 1)) {
    return errorResponse(400, 'INVALID_POST_ID', 'target_post_id must be a positive integer.');
  }

  const limitParam = parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), MAX_LIMIT) : DEFAULT_LIMIT;

  const beforeParam = searchParams.get('before');
  const before = beforeParam ? parseInt(beforeParam, 10) : null;
  if (beforeParam && (!Number.isFinite(before) || (before as number) < 1)) {
    return errorResponse(400, 'INVALID_CURSOR', 'before must be a positive integer.');
  }

  let query = supabase
    .from('audit_logs')
    .select('id, action, actor_wallet, target_post_id, target_reply_id, reason, created_at')
    .order('id', { ascending: false })
    .limit(limit);

  if (actionFilter) {
    query = query.eq('action', actionFilter);
  }
  if (targetPostId !== null) {
    query = query.eq('target_post_id', targetPostId);
  }
  if (before !== null) {
    query = query.lt('id', before);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[community/admin/audit-logs GET] db error:', error.message);
    return errorResponse(502, 'DB_ERROR', 'Failed to fetch audit logs.');
  }

  const logs = data ?? [];
  const nextCursor = logs.length === limit ? logs[logs.length - 1].id : null;

  return NextResponse.json({ logs, nextCursor });
}
