/**
 * GET /api/questions/suggest?q=<prefix>
 *
 * Returns up to 5 questions from qa_pairs whose text contains the query
 * string (case-insensitive substring match), ordered by view_count desc.
 * Requires q ≥ 3 chars.
 *
 * Response:
 *   suggestions — array of { question: string; count: number }
 *
 * No auth required (public endpoint).
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { MIN_QUERY_LENGTH, MAX_RESULTS } from '@/lib/suggest';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';

  if (q.length < MIN_QUERY_LENGTH) {
    return NextResponse.json({ suggestions: [] });
  }

  const { data, error } = await supabase
    .from('qa_pairs')
    .select('question, view_count')
    .ilike('question', `%${q}%`)
    .order('view_count', { ascending: false })
    .limit(MAX_RESULTS);

  if (error) {
    console.error('[/api/questions/suggest] db_error:', error.message);
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: 'Failed to fetch suggestions.' } },
      { status: 502 },
    );
  }

  const suggestions = (data ?? []).map((row) => ({
    question: row.question,
    count: row.view_count,
  }));

  return NextResponse.json({ suggestions });
}
