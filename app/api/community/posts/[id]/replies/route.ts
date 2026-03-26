/**
 * POST /api/community/posts/:id/replies — add a reply (Acceptance Pass holders only)
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { verifyRequest } from '@/lib/privy-auth';
import { isPassHolder } from '@/lib/token-gate';
import { checkRateLimit, isDuplicateContent, buildRateLimitError } from '@/lib/rate-limit';

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
    console.error('[community/replies POST] token gate error:', msg);
    return errorResponse(503, 'TOKEN_GATE_ERROR', 'Could not verify pass ownership. Try again.');
  }
  if (!holder) {
    return errorResponse(403, 'NOT_PASS_HOLDER', 'An Acceptance Pass is required to reply.');
  }

  // 3. Rate limit — 30 replies per hour per wallet
  const rl = checkRateLimit(`community:reply:${auth.walletAddress}`, 30);
  if (!rl.allowed) {
    const rle = buildRateLimitError(rl.resetAt, 'Max 30 replies per hour. Please wait.');
    return NextResponse.json(rle.error, {
      status: rle.status,
      headers: { 'Retry-After': String(rle.retryAfterSec) },
    });
  }

  // 4. Verify post exists
  const { error: postError } = await supabase
    .from('posts')
    .select('id')
    .eq('id', postId)
    .single();

  if (postError) {
    if (postError.code === 'PGRST116') {
      return errorResponse(404, 'NOT_FOUND', 'Post not found.');
    }
    console.error('[community/replies POST] post lookup error:', postError.message);
    return errorResponse(502, 'DB_ERROR', 'Failed to verify post.');
  }

  // 5. Parse body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }

  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text || text.length > 5000) {
    return errorResponse(400, 'INVALID_BODY', 'body is required and must be ≤ 5 000 characters.');
  }

  // 7. Spam check — reject duplicate reply content within the last hour
  if (isDuplicateContent(auth.walletAddress, text)) {
    return errorResponse(400, 'DUPLICATE_CONTENT', 'Identical reply already submitted recently.');
  }

  // 8. Insert reply
  const { data, error } = await supabase
    .from('replies')
    .insert({ post_id: postId, author_wallet: auth.walletAddress, body: text })
    .select('id, post_id, author_wallet, body, votes, created_at')
    .single();

  if (error) {
    console.error('[community/replies POST] insert error:', error.message);
    return errorResponse(502, 'DB_ERROR', 'Failed to create reply.');
  }

  return NextResponse.json({ reply: data }, { status: 201 });
}
