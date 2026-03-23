/**
 * POST /api/qa/feedback
 *
 * Records a thumbs-up / thumbs-down signal on a specific citation chunk
 * within a Q&A turn. Signals are aggregated nightly by /api/cron/feedback-score
 * into corpus_chunks.feedback_score and used as a re-ranking boost in the
 * RAG retrieval step.
 *
 * Request body:
 *   {
 *     sessionId:     string  — conversationId from the Q&A response
 *     turnId:        string  — answerId from the Q&A response (UUID)
 *     chunkId:       string  — chunk identifier from sources[].chunkId in the response
 *     signal:        "helpful" | "unhelpful"
 *     walletAddress?: string — optional; captured if provided by the client
 *   }
 *
 * Auth: optional Bearer token (Privy JWT). Authenticated users are deduplicated
 * per (turnId, chunkId, userId). Anonymous votes are always accepted.
 *
 * Responses:
 *   200 { ok: true }                — feedback recorded
 *   200 { ok: true, duplicate: true } — already voted (authenticated dedup)
 *   400 { error: { code, message } } — invalid request
 *   502 { error: { code, message } } — database error
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { verifyRequest } from '@/lib/privy-auth';

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'BAD_REQUEST', 'Invalid JSON body.');
  }

  const { sessionId, turnId, chunkId, signal, walletAddress } = (body ?? {}) as Record<string, string | undefined>;

  if (!turnId || typeof turnId !== 'string') {
    return errorResponse(400, 'BAD_REQUEST', 'turnId is required.');
  }
  if (!chunkId || typeof chunkId !== 'string') {
    return errorResponse(400, 'BAD_REQUEST', 'chunkId is required.');
  }
  if (signal !== 'helpful' && signal !== 'unhelpful') {
    return errorResponse(400, 'BAD_REQUEST', 'signal must be "helpful" or "unhelpful".');
  }

  // Optional auth — authenticated users get vote deduplication
  let userId: string | null = null;
  let resolvedWalletAddress: string | null = walletAddress ?? null;
  try {
    const auth = await verifyRequest(req);
    if (auth) {
      userId = auth.userId;
      resolvedWalletAddress = resolvedWalletAddress ?? auth.walletAddress ?? null;
    }
  } catch {
    // Anonymous votes are fine — continue without userId
  }

  const { error } = await supabase.from('citation_feedback').insert({
    qa_id: turnId,
    chunk_id: chunkId,
    signal,
    ...(sessionId ? { session_id: sessionId } : {}),
    ...(userId ? { user_id: userId } : {}),
    ...(resolvedWalletAddress ? { wallet_address: resolvedWalletAddress } : {}),
  });

  if (error) {
    if (error.code === '23505') {
      // Unique constraint: authenticated user already voted on this chunk
      return NextResponse.json({ ok: true, duplicate: true });
    }
    console.warn('[/api/qa/feedback] insert_error:', error.message);
    return errorResponse(502, 'DB_ERROR', 'Failed to record feedback.');
  }

  return NextResponse.json({ ok: true });
}
