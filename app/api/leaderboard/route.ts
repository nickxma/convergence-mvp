/**
 * GET /api/leaderboard — Top 25 most-asked questions
 *
 * No auth required (public endpoint).
 *
 * Response:
 *   items — ranked list of { rank, question, answerExcerpt, askCount }
 *
 * Source: qa_cache.hit_count (deduplicated question frequency)
 */
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const EXCERPT_LENGTH = 160;

function makeExcerpt(answer: string): string {
  const trimmed = answer.trim();
  if (trimmed.length <= EXCERPT_LENGTH) return trimmed;
  return trimmed.slice(0, EXCERPT_LENGTH).trimEnd() + '…';
}

export async function GET(): Promise<NextResponse> {
  const { data, error } = await supabase
    .from('qa_cache')
    .select('question, answer, hit_count')
    .order('hit_count', { ascending: false })
    .limit(25);

  if (error) {
    console.error('[/api/leaderboard] db_error:', error.message);
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: 'Failed to load leaderboard.' } },
      { status: 502 },
    );
  }

  const items = (data ?? []).map((row, i) => ({
    rank: i + 1,
    question: row.question,
    answerExcerpt: makeExcerpt(row.answer),
    askCount: row.hit_count,
  }));

  return NextResponse.json({ items });
}
