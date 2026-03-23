/**
 * GET /api/meditations/completions
 *
 * Returns the authenticated user's meditation completion history, cursor-paginated.
 * Each item joins the parent meditation for title, theme, and style context.
 *
 * Query params:
 *   cursor  — ISO timestamp (completed_at); return items completed before this date
 *   limit   — page size (default 20, max 50)
 *
 * Auth: Bearer token (Privy JWT) required.
 *
 * Response:
 *   items      — array of completion records (newest first)
 *   nextCursor — ISO timestamp to pass as cursor for the next page (null if no more)
 *   hasMore    — boolean
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest } from '@/lib/privy-auth';
import { supabase } from '@/lib/supabase';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

interface CompletionRow {
  id: string;
  meditation_id: string;
  duration_minutes: number;
  rating_stars: number | null;
  completed_at: string;
  meditations: {
    title: string;
    theme: string;
    style: string;
  } | null;
}

export async function GET(req: NextRequest) {
  const auth = await verifyRequest(req);
  if (!auth) {
    return errorResponse(401, 'UNAUTHORIZED', 'Sign in to view your meditation history.');
  }

  const sp = req.nextUrl.searchParams;
  const cursor   = sp.get('cursor') ?? null;
  const rawLimit = parseInt(sp.get('limit') ?? String(DEFAULT_LIMIT), 10);
  const limit    = Math.min(isNaN(rawLimit) || rawLimit < 1 ? DEFAULT_LIMIT : rawLimit, MAX_LIMIT);

  let query = supabase
    .from('meditation_completions')
    .select(`
      id,
      meditation_id,
      duration_minutes,
      rating_stars,
      completed_at,
      meditations ( title, theme, style )
    `)
    .eq('user_id', auth.userId)
    .order('completed_at', { ascending: false })
    .limit(limit + 1);

  if (cursor) {
    query = query.lt('completed_at', cursor);
  }

  const { data, error } = await query;

  if (error) {
    console.error(`[/api/meditations/completions] db_error uid=${auth.userId} err=${error.message}`);
    return errorResponse(500, 'DB_ERROR', 'Failed to load completion history.');
  }

  const rows = (data ?? []) as unknown as CompletionRow[];
  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map((r) => ({
    id:              r.id,
    meditationId:    r.meditation_id,
    durationMinutes: r.duration_minutes,
    ratingStars:     r.rating_stars,
    completedAt:     r.completed_at,
    meditation:      r.meditations
      ? {
          title: r.meditations.title,
          theme: r.meditations.theme,
          style: r.meditations.style,
        }
      : null,
  }));

  const nextCursor = hasMore ? items[items.length - 1].completedAt : null;

  return NextResponse.json({ items, nextCursor, hasMore });
}
