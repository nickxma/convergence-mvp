/**
 * POST /api/community/posts/:id/flag — flag a post for review
 *
 * Any Acceptance Pass holder can flag a post.
 * A wallet can only flag a given post once (unique constraint).
 * When a post reaches FLAG_HIDE_THRESHOLD flags it is automatically hidden
 * from the feed (hidden=true), though the permalink remains accessible.
 *
 * Both the flag and any resulting auto-hide are written to audit_logs.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { verifyRequest } from '@/lib/privy-auth';
import { isPassHolder } from '@/lib/token-gate';

const FLAG_HIDE_THRESHOLD = 5;

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Fire-and-forget audit log insert. Logs but does not throw on failure. */
async function writeAuditLog(
  action: 'flag' | 'auto_hide',
  actorWallet: string,
  targetPostId: number,
  reason: string | null,
): Promise<void> {
  const { error } = await supabase.from('audit_logs').insert({
    action,
    actor_wallet: actorWallet,
    target_post_id: targetPostId,
    reason,
  });
  if (error) {
    console.error(`[audit_logs] failed to write ${action} log:`, error.message);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const postId = parseInt(id, 10);
  if (!Number.isFinite(postId) || postId < 1) {
    return errorResponse(400, 'INVALID_ID', 'Post ID must be a positive integer.');
  }

  // 1. Auth
  const auth = await verifyRequest(req);
  if (!auth) {
    return errorResponse(401, 'UNAUTHORIZED', 'Valid Privy auth token required.');
  }

  // 2. Token gate
  let holder: boolean;
  try {
    holder = await isPassHolder(auth.walletAddress);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[community/posts/:id/flag POST] token gate error:', msg);
    return errorResponse(503, 'TOKEN_GATE_ERROR', 'Could not verify pass ownership. Try again.');
  }
  if (!holder) {
    return errorResponse(403, 'NOT_PASS_HOLDER', 'An Acceptance Pass is required to flag posts.');
  }

  // 3. Parse body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason || reason.length > 1000) {
    return errorResponse(400, 'INVALID_REASON', 'reason is required and must be ≤ 1000 characters.');
  }

  // 4. Confirm post exists
  const { data: post, error: postError } = await supabase
    .from('posts')
    .select('id')
    .eq('id', postId)
    .single();

  if (postError) {
    if (postError.code === 'PGRST116') {
      return errorResponse(404, 'NOT_FOUND', 'Post not found.');
    }
    console.error('[community/posts/:id/flag POST] post lookup error:', postError.message);
    return errorResponse(502, 'DB_ERROR', 'Failed to look up post.');
  }
  if (!post) {
    return errorResponse(404, 'NOT_FOUND', 'Post not found.');
  }

  // 5. Insert flag (unique per wallet+post)
  const { error: flagError } = await supabase
    .from('flags')
    .insert({ post_id: postId, reporter_wallet: auth.walletAddress, reason });

  if (flagError) {
    if (flagError.code === '23505') {
      // Unique violation — already flagged
      return NextResponse.json({ status: 'already_flagged' }, { status: 200 });
    }
    console.error('[community/posts/:id/flag POST] insert error:', flagError.message);
    return errorResponse(502, 'DB_ERROR', 'Failed to record flag.');
  }

  // 6. Write flag audit log
  await writeAuditLog('flag', auth.walletAddress, postId, reason);

  // 7. Count total flags; auto-hide if threshold reached
  const { count, error: countError } = await supabase
    .from('flags')
    .select('id', { count: 'exact', head: true })
    .eq('post_id', postId);

  if (countError) {
    console.error('[community/posts/:id/flag POST] count error:', countError.message);
    // Flag was recorded; don't fail the request over a count error
    return NextResponse.json({ status: 'flagged', autoHidden: false }, { status: 201 });
  }

  const flagCount = count ?? 0;
  let autoHidden = false;

  if (flagCount >= FLAG_HIDE_THRESHOLD) {
    const { error: hideError } = await supabase
      .from('posts')
      .update({ hidden: true })
      .eq('id', postId)
      .eq('hidden', false); // no-op if already hidden

    if (hideError) {
      console.error('[community/posts/:id/flag POST] auto-hide error:', hideError.message);
    } else {
      autoHidden = true;
      console.log(`[moderation] post ${postId} auto-hidden after ${flagCount} flags`);
      await writeAuditLog(
        'auto_hide',
        auth.walletAddress,
        postId,
        `Auto-hidden after ${flagCount} flags`,
      );
    }
  }

  return NextResponse.json({ status: 'flagged', autoHidden, flagCount }, { status: 201 });
}
