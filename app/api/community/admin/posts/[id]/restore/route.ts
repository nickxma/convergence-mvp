/**
 * POST /api/community/admin/posts/:id/restore — unhide a hidden post (admin only)
 *
 * Sets hidden=false on a post that was auto-hidden by the flag threshold or
 * manually hidden. The restore action is written to audit_logs.
 *
 * Body (optional): { "reason": "string" }
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isAdminRequest, getAdminWallet } from '@/lib/admin-auth';

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isAdminRequest(req)) {
    return errorResponse(401, 'UNAUTHORIZED', 'Admin access required.');
  }

  const { id } = await params;
  const postId = parseInt(id, 10);
  if (!Number.isFinite(postId) || postId < 1) {
    return errorResponse(400, 'INVALID_ID', 'Post ID must be a positive integer.');
  }

  // Optional reason from body
  let reason: string | null = null;
  try {
    const body = await req.json();
    if (typeof body.reason === 'string' && body.reason.trim().length > 0) {
      reason = body.reason.trim().slice(0, 1000);
    }
  } catch {
    // Body is optional; ignore parse errors
  }

  // Confirm post exists
  const { data: post, error: postError } = await supabase
    .from('posts')
    .select('id, hidden')
    .eq('id', postId)
    .single();

  if (postError) {
    if (postError.code === 'PGRST116') {
      return errorResponse(404, 'NOT_FOUND', 'Post not found.');
    }
    console.error('[community/admin/posts/:id/restore POST] post lookup error:', postError.message);
    return errorResponse(502, 'DB_ERROR', 'Failed to look up post.');
  }
  if (!post) {
    return errorResponse(404, 'NOT_FOUND', 'Post not found.');
  }

  if (!post.hidden) {
    return NextResponse.json({ status: 'already_visible' }, { status: 200 });
  }

  // Unhide post
  const { error: restoreError } = await supabase
    .from('posts')
    .update({ hidden: false })
    .eq('id', postId);

  if (restoreError) {
    console.error('[community/admin/posts/:id/restore POST] restore error:', restoreError.message);
    return errorResponse(502, 'DB_ERROR', 'Failed to restore post.');
  }

  console.log(`[moderation] post ${postId} restored by admin`);

  // Write audit log
  const actorWallet = getAdminWallet(req) ?? 'unknown';
  const { error: auditError } = await supabase.from('audit_logs').insert({
    action: 'restore',
    actor_wallet: actorWallet,
    target_post_id: postId,
    reason: reason ?? 'Admin restore',
  });
  if (auditError) {
    console.error('[audit_logs] failed to write restore log:', auditError.message);
  }

  return NextResponse.json({ status: 'restored', postId }, { status: 200 });
}
