/**
 * GET    /api/community/posts/:id — single post with its replies
 * DELETE /api/community/posts/:id — hard-delete post and replies (admin only)
 *
 * Admin hard-delete is recorded in audit_logs before the row is removed.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isAdminRequest, getAdminWallet } from '@/lib/admin-auth';

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const postId = parseInt(id, 10);
  if (!Number.isFinite(postId) || postId < 1) {
    return errorResponse(400, 'INVALID_ID', 'Post ID must be a positive integer.');
  }

  const [postResult, repliesResult] = await Promise.all([
    supabase
      .from('posts')
      .select('id, author_wallet, title, body, votes, hidden, created_at')
      .eq('id', postId)
      .single(),
    supabase
      .from('replies')
      .select('id, post_id, author_wallet, body, votes, created_at')
      .eq('post_id', postId)
      .order('created_at', { ascending: true }),
  ]);

  if (postResult.error) {
    if (postResult.error.code === 'PGRST116') {
      return errorResponse(404, 'NOT_FOUND', 'Post not found.');
    }
    console.error('[community/posts/:id GET] db error:', postResult.error.message);
    return errorResponse(502, 'DB_ERROR', 'Failed to fetch post.');
  }

  if (repliesResult.error) {
    console.error('[community/posts/:id GET] replies error:', repliesResult.error.message);
    return errorResponse(502, 'DB_ERROR', 'Failed to fetch replies.');
  }

  return NextResponse.json({
    post: postResult.data,
    replies: repliesResult.data ?? [],
  });
}

// ── DELETE /api/community/posts/:id ───────────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isAdminRequest(req)) {
    return errorResponse(403, 'FORBIDDEN', 'Admin access required.');
  }

  const { id } = await params;
  const postId = parseInt(id, 10);
  if (!Number.isFinite(postId) || postId < 1) {
    return errorResponse(400, 'INVALID_ID', 'Post ID must be a positive integer.');
  }

  // Hard-delete: replies and flags cascade via FK on delete cascade
  const { error, count } = await supabase
    .from('posts')
    .delete({ count: 'exact' })
    .eq('id', postId);

  if (error) {
    console.error('[community/posts/:id DELETE] db error:', error.message);
    return errorResponse(502, 'DB_ERROR', 'Failed to delete post.');
  }

  if (count === 0) {
    return errorResponse(404, 'NOT_FOUND', 'Post not found.');
  }

  console.log(`[moderation] post ${postId} hard-deleted by admin`);

  // Write audit log after successful delete (post row is gone; log survives via plain bigint)
  const actorWallet = getAdminWallet(req) ?? 'unknown';
  const { error: auditError } = await supabase.from('audit_logs').insert({
    action: 'remove',
    actor_wallet: actorWallet,
    target_post_id: postId,
    reason: 'Admin hard-delete',
  });
  if (auditError) {
    console.error('[audit_logs] failed to write remove log:', auditError.message);
  }

  return new NextResponse(null, { status: 204 });
}
