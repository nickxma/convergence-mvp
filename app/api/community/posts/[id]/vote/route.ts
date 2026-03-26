/**
 * POST /api/community/posts/:id/vote — upvote or downvote a post or reply
 *
 * Body: { direction: 1 | -1, targetType?: "post" | "reply", targetId?: number }
 * Default targetType is "post" using the path's :id.
 * To vote on a reply, pass targetType="reply" and targetId=<replyId>.
 *
 * 1 pass = 1 vote. Re-submitting the same direction is idempotent.
 * Changing direction toggles the vote (net delta of 2 * new direction).
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { verifyRequest } from '@/lib/privy-auth';
import { isPassHolder } from '@/lib/token-gate';
import { checkRateLimit } from '@/lib/rate-limit';

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
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
    console.error('[community/vote POST] token gate error:', msg);
    return errorResponse(503, 'TOKEN_GATE_ERROR', 'Could not verify pass ownership. Try again.');
  }
  if (!holder) {
    return errorResponse(403, 'NOT_PASS_HOLDER', 'An Acceptance Pass is required to vote.');
  }

  // 3. Rate limit — 50 votes per hour per wallet
  const rl = checkRateLimit(`community:vote:${auth.walletAddress}`, 50);
  if (!rl.allowed) {
    const retryAfterSec = Math.ceil((rl.resetAt - Date.now()) / 1000);
    return NextResponse.json(
      { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Max 50 votes per hour. Please wait.' } },
      { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
    );
  }

  // 4. Parse body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }

  const direction = body.direction;
  if (direction !== 1 && direction !== -1) {
    return errorResponse(400, 'INVALID_DIRECTION', 'direction must be 1 (up) or -1 (down).');
  }

  const rawTargetType = body.targetType ?? 'post';
  if (rawTargetType !== 'post' && rawTargetType !== 'reply') {
    return errorResponse(400, 'INVALID_TARGET_TYPE', "targetType must be 'post' or 'reply'.");
  }
  const targetType = rawTargetType as 'post' | 'reply';
  const targetId = targetType === 'post'
    ? postId
    : parseInt(String(body.targetId ?? ''), 10);

  if (!Number.isFinite(targetId) || targetId < 1) {
    return errorResponse(400, 'INVALID_TARGET_ID', 'targetId must be a positive integer.');
  }

  // 5. Check for an existing vote from this wallet on this target
  const { data: existing } = await supabase
    .from('votes')
    .select('id, direction')
    .eq('voter_wallet', auth.walletAddress)
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .maybeSingle();

  if (existing) {
    if (existing.direction === direction) {
      // Idempotent — same vote already recorded
      return NextResponse.json({ status: 'unchanged', direction });
    }

    // Direction flip: delta is 2 × new direction
    const delta = (direction as number) * 2;
    const rpcName = targetType === 'post' ? 'increment_post_votes' : 'increment_reply_votes';
    const idParam = targetType === 'post' ? 'post_id' : 'reply_id';

    const [voteUpdate, scoreUpdate] = await Promise.all([
      supabase.from('votes').update({ direction }).eq('id', existing.id),
      supabase.rpc(rpcName, { [idParam]: targetId, delta }),
    ]);

    if (voteUpdate.error || scoreUpdate.error) {
      console.error('[community/vote] update error:', voteUpdate.error?.message, scoreUpdate.error?.message);
      return errorResponse(502, 'DB_ERROR', 'Failed to update vote.');
    }

    return NextResponse.json({ status: 'changed', direction });
  }

  // 6. New vote — insert and atomically update the score
  const rpcName = targetType === 'post' ? 'increment_post_votes' : 'increment_reply_votes';
  const idParam = targetType === 'post' ? 'post_id' : 'reply_id';

  const [voteInsert, scoreUpdate] = await Promise.all([
    supabase.from('votes').insert({
      voter_wallet: auth.walletAddress,
      target_type: targetType,
      target_id: targetId,
      direction,
    }),
    supabase.rpc(rpcName, { [idParam]: targetId, delta: direction }),
  ]);

  if (voteInsert.error || scoreUpdate.error) {
    console.error('[community/vote] insert error:', voteInsert.error?.message, scoreUpdate.error?.message);
    return errorResponse(502, 'DB_ERROR', 'Failed to record vote.');
  }

  return NextResponse.json({ status: 'recorded', direction }, { status: 201 });
}
