/**
 * GET /api/analytics/qa/unanswered — Queries that received low-confidence answers
 *
 * Auth: Authorization: Bearer <ADMIN_WALLET>
 *
 * Query params:
 *   days   — look-back window in days (default 30, max 365)
 *   limit  — max rows to return (default 50, max 200)
 *
 * Response:
 *   queries    — array of { query, confidence, askedAt }
 *   days       — effective look-back window
 *   threshold  — pinecone top-1 score below which a query is flagged
 *
 * A query is considered "unanswered" when its top-1 Pinecone relevance score
 * falls below UNANSWERED_THRESHOLD (0.4). The question text is resolved from
 * qa_cache via question_hash; rows whose hash has no cache entry show a
 * truncated hash instead.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-auth';

const UNANSWERED_THRESHOLD = 0.4;
const ANALYTICS_SCAN_LIMIT = 2000; // max rows scanned to find low-confidence queries

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return errorResponse(401, 'UNAUTHORIZED', 'Admin access required.');
  }

  const { searchParams } = new URL(req.url);
  const rawDays = parseInt(searchParams.get('days') ?? '30', 10);
  const days = Number.isFinite(rawDays) ? Math.min(Math.max(rawDays, 1), 365) : 30;
  const rawLimit = parseInt(searchParams.get('limit') ?? '50', 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Pull recent non-cache-hit analytics rows so we can filter by pinecone_scores.
  // Supabase JS cannot filter on array element values in SQL, so we filter in JS.
  const { data: analyticsRows, error: analyticsError } = await supabase
    .from('qa_analytics')
    .select('question_hash, pinecone_scores, created_at')
    .gte('created_at', since)
    .eq('cache_hit', false)
    .order('created_at', { ascending: false })
    .limit(ANALYTICS_SCAN_LIMIT);

  if (analyticsError) {
    console.error('[/api/analytics/qa/unanswered] db_error:', analyticsError.message);
    return errorResponse(502, 'DB_ERROR', 'Failed to query analytics data.');
  }

  // Keep only rows where top-1 Pinecone score is below threshold
  const lowConfidence = (analyticsRows ?? []).filter(
    (r) =>
      Array.isArray(r.pinecone_scores) &&
      r.pinecone_scores.length > 0 &&
      r.pinecone_scores[0] < UNANSWERED_THRESHOLD,
  );

  // Resolve question text from qa_cache (join on question_hash = hash)
  const hashes = [...new Set(lowConfidence.map((r) => r.question_hash).filter(Boolean))].slice(0, limit);

  let questionMap: Record<string, string> = {};
  if (hashes.length > 0) {
    const { data: cacheRows } = await supabase
      .from('qa_cache')
      .select('hash, question')
      .in('hash', hashes);
    for (const row of cacheRows ?? []) {
      questionMap[row.hash] = row.question;
    }
  }

  const queries = lowConfidence.slice(0, limit).map((r) => ({
    query: questionMap[r.question_hash] ?? `[hash: ${String(r.question_hash ?? '').slice(0, 8)}…]`,
    confidence: r.pinecone_scores[0],
    askedAt: r.created_at,
  }));

  return NextResponse.json({ queries, days, threshold: UNANSWERED_THRESHOLD });
}
