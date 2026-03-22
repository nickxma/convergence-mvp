/**
 * POST /api/qa-feedback
 *
 * Body: { answerId: string; rating: "up" | "down" }
 * Auth: Authorization: Bearer <privy-access-token>
 *
 * Records a thumbs up/down for a Q&A answer.
 * Upserts so a user can change their vote; deduplicates by (user_id, answer_id).
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { verifyRequest } from '@/lib/privy-auth';

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
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

  return NextResponse.json({ ok: true });
}
