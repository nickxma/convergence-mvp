/**
 * POST /api/qa-feedback
 *
 * Body: { answerId: string; rating: "up" | "down" }
 * Auth: Authorization: Bearer <privy-access-token>
 *
 * Records a thumbs up/down for a Q&A answer.
 * Upserts so a user can change their vote; deduplicates by (user_id, answer_id).
 * After saving, recomputes quality_score on the corresponding qa_cache entry.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { verifyRequest } from '@/lib/privy-auth';

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * Recompute quality_score for the qa_cache entry linked to cacheHash.
 * Formula: (pinecone_top1_score * 0.6) + (positive_feedback_rate * 0.4)
 * Fire-and-forget — errors are logged but don't fail the feedback response.
 */
async function updateCacheQualityScore(cacheHash: string): Promise<void> {
  try {
    // Fetch pinecone_top1_score from cache
    const { data: cacheRow, error: cacheErr } = await supabase
      .from('qa_cache')
      .select('pinecone_top1_score')
      .eq('hash', cacheHash)
      .single();

    if (cacheErr || !cacheRow) return;

    // Aggregate feedback across all qa_answers sharing this cache hash
    const { data: feedbackRows, error: feedbackErr } = await supabase
      .from('qa_feedback')
      .select('rating, qa_answers!inner(cache_hash)')
      .eq('qa_answers.cache_hash', cacheHash);

    if (feedbackErr) {
      console.warn(`[/api/qa-feedback] quality_score_feedback_err hash=${cacheHash} err=${feedbackErr.message}`);
      return;
    }

    const feedbackCount = feedbackRows?.length ?? 0;
    const positiveCount = feedbackRows?.filter((r) => r.rating === 'up').length ?? 0;

    const pineconeScore = cacheRow.pinecone_top1_score ?? 0;
    const positiveRate = feedbackCount > 0 ? positiveCount / feedbackCount : 0;
    const qualityScore = pineconeScore * 0.6 + positiveRate * 0.4;

    const { error: updateErr } = await supabase
      .from('qa_cache')
      .update({
        quality_score: qualityScore,
        feedback_count: feedbackCount,
        positive_feedback_count: positiveCount,
      })
      .eq('hash', cacheHash);

    if (updateErr) {
      console.warn(`[/api/qa-feedback] quality_score_update_err hash=${cacheHash} err=${updateErr.message}`);
    }
  } catch (err) {
    console.warn(`[/api/qa-feedback] quality_score_exception hash=${cacheHash} err=${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authResult = await verifyRequest(req);
  if (!authResult?.userId) {
    return errorResponse(401, 'UNAUTHORIZED', 'Authentication required to submit feedback.');
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }

  const answerId = typeof body?.answerId === 'string' ? body.answerId.trim() : '';
  const rating = body?.rating;

  if (!answerId) {
    return errorResponse(400, 'MISSING_ANSWER_ID', 'answerId is required.');
  }
  if (rating !== 'up' && rating !== 'down') {
    return errorResponse(400, 'INVALID_RATING', 'rating must be "up" or "down".');
  }

  // Fetch cache_hash before upserting so we can update quality score after
  const { data: answerRow } = await supabase
    .from('qa_answers')
    .select('cache_hash')
    .eq('id', answerId)
    .single();

  const { error } = await supabase
    .from('qa_feedback')
    .upsert(
      { answer_id: answerId, user_id: authResult.userId, rating },
      { onConflict: 'user_id,answer_id' },
    );

  if (error) {
    // FK violation means the answerId doesn't exist
    if (error.code === '23503') {
      return errorResponse(404, 'ANSWER_NOT_FOUND', 'Answer not found.');
    }
    console.error('[/api/qa-feedback] db_error:', error.message);
    return errorResponse(502, 'DB_ERROR', 'Failed to save feedback.');
  }

  // Recompute quality score asynchronously (fire and forget)
  const cacheHash = answerRow?.cache_hash;
  if (cacheHash) {
    updateCacheQualityScore(cacheHash);
  }

  return NextResponse.json({ ok: true });
}
