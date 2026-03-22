/**
 * GET /api/questions/suggest?q=<prefix>
 *
 * Returns top 5 popular questions from qa_answers that contain the query
 * string (case-insensitive). Ranked by ask frequency. Requires q ≥ 3 chars.
 *
 * Response:
 *   suggestions — array of { question: string; count: number }
 *
 * No auth required (public endpoint).
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { aggregateSuggestions, MIN_QUERY_LENGTH } from '@/lib/suggest';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';

  if (q.length < MIN_QUERY_LENGTH) {
    return NextResponse.json({ suggestions: [] });
  }

  // Fetch up to 500 matching questions and aggregate in-process
  const { data, error } = await supabase
    .from('qa_answers')
    .select('question')
    .ilike('question', `%${q}%`)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    console.error('[/api/questions/suggest] db_error:', error.message);
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: 'Failed to fetch suggestions.' } },
      { status: 502 },
    );
  }

  const suggestions = aggregateSuggestions(data ?? []);
  return NextResponse.json({ suggestions });
}
