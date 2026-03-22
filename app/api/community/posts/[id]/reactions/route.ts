/**
 * POST /api/community/posts/:id/reactions — toggle an emoji reaction on a post
 *
 * Body: { emoji: "❤️" | "🧠" | "🙏" | "💡" | "👀" }
 *
 * Toggle semantics: adds the reaction if the user hasn't reacted with that
 * emoji yet; removes it if they have.
 *
 * Requires Privy auth. No token-gate (reactions are lighter-weight than posts).
 * Rate limit: piggybacks on existing infrastructure but does not count against
 * the Q&A quota.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { verifyRequest } from '@/lib/privy-auth';

const ALLOWED_EMOJI = new Set(['❤️', '🧠', '🙏', '💡', '👀']);

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

  // 2. Parse body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }

  const emoji = typeof body.emoji === 'string' ? body.emoji.trim() : '';
  if (!ALLOWED_EMOJI.has(emoji)) {
    return errorResponse(
      400,
      'INVALID_EMOJI',
      `emoji must be one of: ${[...ALLOWED_EMOJI].join(' ')}`,
    );
  }

  // 3. Check post exists
  const { data: post, error: postErr } = await supabase
    .from('posts')
    .select('id')
    .eq('id', postId)
    .eq('hidden', false)
    .maybeSingle();

  if (postErr) {
    console.error('[community/reactions POST] post lookup error:', postErr.message);
    return errorResponse(502, 'DB_ERROR', 'Failed to look up post.');
  }
  if (!post) {
    return errorResponse(404, 'NOT_FOUND', 'Post not found.');
  }

  // 4. Toggle: check existing reaction
  const { data: existing, error: lookupErr } = await supabase
    .from('post_reactions')
    .select('id')
    .eq('post_id', postId)
    .eq('user_id', auth.userId)
    .eq('emoji', emoji)
    .maybeSingle();

  if (lookupErr) {
    console.error('[community/reactions POST] lookup error:', lookupErr.message);
    return errorResponse(502, 'DB_ERROR', 'Failed to check existing reaction.');
  }

  if (existing) {
    // Remove reaction
    const { error: deleteErr } = await supabase
      .from('post_reactions')
      .delete()
      .eq('id', existing.id);

    if (deleteErr) {
      console.error('[community/reactions POST] delete error:', deleteErr.message);
      return errorResponse(502, 'DB_ERROR', 'Failed to remove reaction.');
    }
    return NextResponse.json({ action: 'removed', emoji });
  }

  // Add reaction
  const { error: insertErr } = await supabase
    .from('post_reactions')
    .insert({ post_id: postId, user_id: auth.userId, emoji });

  if (insertErr) {
    console.error('[community/reactions POST] insert error:', insertErr.message);
    return errorResponse(502, 'DB_ERROR', 'Failed to add reaction.');
  }

  return NextResponse.json({ action: 'added', emoji }, { status: 201 });
}
