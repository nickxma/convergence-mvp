/**
 * POST /api/ask/citation-feedback
 *
 * Body: { qaId: string; chunkId: string; signal: "helpful" | "unhelpful"; userId?: string }
 * Auth: Optional — Bearer <privy-access-token>
 *
 * Records per-citation quality signal. Works for both authenticated and anonymous users.
 * Anonymous votes are stored with user_id = null; the UI enforces one-per-session.
 * Authenticated users are deduplicated by (qa_id, chunk_id, user_id) via DB unique index.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { verifyRequest } from '@/lib/privy-auth';

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Auth is optional — extract userId if present
  let userId: string | null = null;
  try {
    const authResult = await verifyRequest(req);
    userId = authResult?.userId ?? null;
  } catch {
    // No valid token — proceed as anonymous
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }

  const qaId = typeof body?.qaId === 'string' ? body.qaId.trim() : '';
  const chunkId = typeof body?.chunkId === 'string' ? body.chunkId.trim() : '';
  const signal = body?.signal;

  if (!qaId) {
    return errorResponse(400, 'MISSING_QA_ID', 'qaId is required.');
  }
  if (!chunkId) {
    return errorResponse(400, 'MISSING_CHUNK_ID', 'chunkId is required.');
  }
  if (signal !== 'helpful' && signal !== 'unhelpful') {
    return errorResponse(400, 'INVALID_SIGNAL', 'signal must be "helpful" or "unhelpful".');
  }

  const row = { qa_id: qaId, chunk_id: chunkId, signal, user_id: userId };

  if (userId) {
    // Authenticated: upsert so the user can change their vote
    const { error } = await supabase
      .from('citation_feedback')
      .upsert(row, { onConflict: 'qa_id,chunk_id,user_id' });

    if (error) {
      if (error.code === '23503') {
        return errorResponse(404, 'ANSWER_NOT_FOUND', 'Answer not found.');
      }
      console.error('[/api/ask/citation-feedback] db_error:', error.message);
      return errorResponse(502, 'DB_ERROR', 'Failed to save feedback.');
    }
  } else {
    // Anonymous: plain insert (unique constraint doesn't apply to null user_id)
    const { error } = await supabase.from('citation_feedback').insert(row);

    if (error) {
      if (error.code === '23503') {
        return errorResponse(404, 'ANSWER_NOT_FOUND', 'Answer not found.');
      }
      console.error('[/api/ask/citation-feedback] db_error anon:', error.message);
      return errorResponse(502, 'DB_ERROR', 'Failed to save feedback.');
    }
  }

  return NextResponse.json({ ok: true });
}
