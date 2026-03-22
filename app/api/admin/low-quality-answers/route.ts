/**
 * GET /api/admin/low-quality-answers
 *
 * Auth: Authorization: Bearer <ADMIN_WALLET>
 *
 * Returns qa_cache entries flagged as low quality:
 *   quality_score < 0.4 AND feedback_count >= 3
 *
 * Response fields per item:
 *   hash               — cache entry hash (used as ID for corpus refresh)
 *   question           — original question text
 *   answerExcerpt      — first 300 chars of the answer
 *   qualityScore       — composite quality score
 *   feedbackCount      — total feedback votes
 *   positiveFeedbackCount — thumbs up count
 *   pineconeTop1Score  — top Pinecone relevance score
 *   markedForRefresh   — whether already in corpus_refresh_candidates
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-auth';

const LOW_QUALITY_THRESHOLD = 0.4;
const MIN_FEEDBACK_COUNT = 3;

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return errorResponse(401, 'UNAUTHORIZED', 'Admin access required.');
  }

  const [flaggedResult, refreshCandidatesResult] = await Promise.all([
    supabase
      .from('qa_cache')
      .select('hash, question, answer, quality_score, feedback_count, positive_feedback_count, pinecone_top1_score')
      .lt('quality_score', LOW_QUALITY_THRESHOLD)
      .gte('feedback_count', MIN_FEEDBACK_COUNT)
      .order('quality_score', { ascending: true })
      .limit(100),

    supabase
      .from('corpus_refresh_candidates')
      .select('cache_hash'),
  ]);

  if (flaggedResult.error) {
    console.error(`[/api/admin/low-quality-answers] db_error: ${flaggedResult.error.message}`);
    return errorResponse(502, 'DB_ERROR', 'Failed to query low-quality answers.');
  }

  if (refreshCandidatesResult.error) {
    console.error(`[/api/admin/low-quality-answers] refresh_candidates_error: ${refreshCandidatesResult.error.message}`);
    return errorResponse(502, 'DB_ERROR', 'Failed to query corpus refresh candidates.');
  }

  const refreshHashes = new Set((refreshCandidatesResult.data ?? []).map((r) => r.cache_hash));

  const items = (flaggedResult.data ?? []).map((row) => ({
    hash: row.hash,
    question: row.question,
    answerExcerpt: (row.answer as string).slice(0, 300),
    qualityScore: row.quality_score,
    feedbackCount: row.feedback_count,
    positiveFeedbackCount: row.positive_feedback_count,
    pineconeTop1Score: row.pinecone_top1_score,
    markedForRefresh: refreshHashes.has(row.hash),
  }));

  return NextResponse.json({ items, total: items.length });
}
