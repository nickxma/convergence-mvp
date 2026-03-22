/**
 * GET  /api/community/posts  — paginated post feed sorted by vote score
 * POST /api/community/posts  — create a post (Acceptance Pass holders only)
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { verifyRequest } from '@/lib/privy-auth';
import { isPassHolder } from '@/lib/token-gate';
import { checkRateLimit, isDuplicateContent, buildRateLimitError } from '@/lib/rate-limit';

const PAGE_SIZE = 20;

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

// ── GET /api/community/posts ───────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const offset = (page - 1) * PAGE_SIZE;

  const { data, error, count } = await supabase
    .from('posts')
    .select('id, author_wallet, title, body, vote_score, created_at', { count: 'exact' })
    .eq('hidden', false)
    .order('vote_score', { ascending: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (error) {
    console.error('[community/posts GET] db error:', error.message);
    return errorResponse(502, 'DB_ERROR', 'Failed to fetch posts.');
  }

  const posts = data ?? [];
  const postIds = posts.map((p) => p.id);

  // Fetch emoji reaction counts for this page of posts
  const reactionsMap = new Map<number, Record<string, number>>();
  const myReactionsMap = new Map<number, string[]>();

  if (postIds.length > 0) {
    const { data: reactionRows, error: rxErr } = await supabase
      .from('post_reactions')
      .select('post_id, emoji, user_id')
      .in('post_id', postIds);

    if (rxErr) {
      console.error('[community/posts GET] reactions fetch error:', rxErr.message);
      // Non-fatal: return posts without reactions rather than failing the request
    } else {
      // Optionally resolve current user to populate myReactions
      const auth = await verifyRequest(req);

      for (const row of reactionRows ?? []) {
        if (!reactionsMap.has(row.post_id)) reactionsMap.set(row.post_id, {});
        const counts = reactionsMap.get(row.post_id)!;
        counts[row.emoji] = (counts[row.emoji] ?? 0) + 1;

        if (auth && row.user_id === auth.userId) {
          if (!myReactionsMap.has(row.post_id)) myReactionsMap.set(row.post_id, []);
          myReactionsMap.get(row.post_id)!.push(row.emoji);
        }
      }
    }
  }

  const postsWithReactions = posts.map((post) => ({
    ...post,
    reactions: reactionsMap.get(post.id) ?? {},
    myReactions: myReactionsMap.get(post.id) ?? [],
  }));

  return NextResponse.json({
    posts: postsWithReactions,
    page,
    pageSize: PAGE_SIZE,
    total: count ?? 0,
  });
}

// ── POST /api/community/posts ──────────────────────────────────────────────

export async function POST(req: NextRequest) {
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
    console.error('[community/posts POST] token gate error:', msg);
    return errorResponse(503, 'TOKEN_GATE_ERROR', 'Could not verify pass ownership. Try again.');
  }
  if (!holder) {
    return errorResponse(403, 'NOT_PASS_HOLDER', 'An Acceptance Pass is required to post.');
  }

  // 3. Rate limit — 10 posts per hour per wallet
  const rl = checkRateLimit(`community:post:${auth.walletAddress}`, 10);
  if (!rl.allowed) {
    const rle = buildRateLimitError(rl.resetAt, 'Max 10 posts per hour. Please wait.');
    return NextResponse.json(rle.error, {
      status: rle.status,
      headers: { 'Retry-After': String(rle.retryAfterSec) },
    });
  }

  // 4. Parse body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }

  const stripHtml = (s: string) => s.replace(/<[^>]*>/g, '');
  const title = typeof body.title === 'string' ? stripHtml(body.title.trim()) : '';
  const text = typeof body.body === 'string' ? stripHtml(body.body.trim()) : '';

  if (!title || title.length > 300) {
    return errorResponse(400, 'INVALID_TITLE', 'title is required and must be ≤ 300 characters.');
  }
  if (!text || text.length > 10000) {
    return errorResponse(400, 'INVALID_BODY', 'body is required and must be ≤ 10 000 characters.');
  }

  // 5. Spam check — reject duplicate content within the last hour
  if (isDuplicateContent(auth.walletAddress, `${title}\n${text}`)) {
    return errorResponse(400, 'DUPLICATE_CONTENT', 'Identical post already submitted recently.');
  }

  // 6. Insert
  const { data, error } = await supabase
    .from('posts')
    .insert({ author_wallet: auth.walletAddress, title, body: text })
    .select('id, author_wallet, title, body, vote_score, created_at')
    .single();

  if (error) {
    console.error('[community/posts POST] insert error:', error.message);
    return errorResponse(502, 'DB_ERROR', 'Failed to create post.');
  }

  return NextResponse.json({ post: data }, { status: 201 });
}
