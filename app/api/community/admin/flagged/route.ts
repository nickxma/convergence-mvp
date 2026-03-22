/**
 * GET /api/community/admin/flagged — list all flagged posts with flag count and reasons
 *
 * Admin wallet only (Authorization: Bearer <ADMIN_WALLET>).
 * Returns posts that have at least one flag, ordered by flag count descending.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-auth';

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return errorResponse(403, 'FORBIDDEN', 'Admin access required.');
  }

  // Fetch all flags, grouped by post
  const { data: flags, error: flagsError } = await supabase
    .from('flags')
    .select('post_id, reporter_wallet, reason, created_at')
    .order('post_id', { ascending: true })
    .order('created_at', { ascending: true });

  if (flagsError) {
    console.error('[community/admin/flagged GET] flags error:', flagsError.message);
    return errorResponse(502, 'DB_ERROR', 'Failed to fetch flags.');
  }

  if (!flags || flags.length === 0) {
    return NextResponse.json({ posts: [] });
  }

  // Collect unique post IDs
  const postIds = [...new Set(flags.map((f) => f.post_id))];

  const { data: posts, error: postsError } = await supabase
    .from('posts')
    .select('id, author_wallet, title, votes, hidden, created_at')
    .in('id', postIds);

  if (postsError) {
    console.error('[community/admin/flagged GET] posts error:', postsError.message);
    return errorResponse(502, 'DB_ERROR', 'Failed to fetch flagged posts.');
  }

  // Group flags by post_id
  const flagsByPost = new Map<number, { reporter_wallet: string; reason: string; created_at: string }[]>();
  for (const flag of flags) {
    const arr = flagsByPost.get(flag.post_id) ?? [];
    arr.push({ reporter_wallet: flag.reporter_wallet, reason: flag.reason, created_at: flag.created_at });
    flagsByPost.set(flag.post_id, arr);
  }

  // Merge and sort by flag count descending
  const result = (posts ?? [])
    .map((post) => {
      const postFlags = flagsByPost.get(post.id) ?? [];
      return { ...post, flagCount: postFlags.length, flags: postFlags };
    })
    .sort((a, b) => b.flagCount - a.flagCount);

  return NextResponse.json({ posts: result });
}
