/**
 * GET /api/admin/analytics/errors
 *
 * Recent Q&A queries that returned low-confidence or no-context responses.
 * "Errors" are defined as queries where the top Pinecone score was below 0.3
 * or where no context was retrieved at all — not application exceptions.
 *
 * Auth: Authorization: Bearer <ADMIN_WALLET>
 *
 * Query params:
 *   period  — 7d | 30d | 90d  (default: 30d)
 *   limit   — 1–100           (default: 50)
 *
 * Response:
 *   period  — active period string
 *   total   — total error-type queries in the period
 *   errors  — most recent N records, each with:
 *     hash       — SHA-256 question hash
 *     question   — raw question text (null if not in qa_cache)
 *     errorType  — "no_context" | "low_confidence"
 *     maxScore   — top Pinecone relevance score (0 when no context)
 *     timestamp  — ISO-8601 UTC creation time
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { supabase } from '@/lib/supabase';

const ERROR_SCORE_THRESHOLD = 0.3;
const MAX_LIMIT = 100;

const VALID_PERIODS = ['7d', '30d', '90d'] as const;
type Period = (typeof VALID_PERIODS)[number];
const PERIOD_DAYS: Record<Period, number> = { '7d': 7, '30d': 30, '90d': 90 };

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function ago(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return errorResponse(403, 'FORBIDDEN', 'Admin access required.');
  }

  const { searchParams } = req.nextUrl;
  const periodParam = searchParams.get('period') ?? '30d';
  const limitParam = parseInt(searchParams.get('limit') ?? '50', 10);

  const period: Period = (VALID_PERIODS as readonly string[]).includes(periodParam)
    ? (periodParam as Period)
    : '30d';

  const limit =
    Number.isFinite(limitParam) && limitParam >= 1 && limitParam <= MAX_LIMIT
      ? limitParam
      : 50;

  const days = PERIOD_DAYS[period];

  // ── Fetch all rows in period to compute both total and recent slice ────────
  const { data: rows, error } = await supabase
    .from('qa_analytics')
    .select('question_hash, pinecone_scores, created_at')
    .gte('created_at', ago(days))
    .order('created_at', { ascending: false })
    .limit(50_000);

  if (error) {
    console.error('[/api/admin/analytics/errors] db_error:', error.message);
    return errorResponse(500, 'DB_ERROR', 'Failed to query analytics.');
  }

  // ── Filter to error rows ───────────────────────────────────────────────────
  const errorRows = (rows ?? []).filter((r) => {
    const scores = r.pinecone_scores as number[] | null;
    if (!scores || scores.length === 0) return true;
    return Math.max(...scores) < ERROR_SCORE_THRESHOLD;
  });

  const total = errorRows.length;
  const recentSlice = errorRows.slice(0, limit);

  if (recentSlice.length === 0) {
    return NextResponse.json({ period, total: 0, errors: [] });
  }

  // ── Resolve question text from qa_cache ───────────────────────────────────
  const hashes = [...new Set(recentSlice.map((r) => r.question_hash as string).filter(Boolean))];
  const questionMap = new Map<string, string>();

  if (hashes.length > 0) {
    const { data: cacheData } = await supabase
      .from('qa_cache')
      .select('hash, question')
      .in('hash', hashes);
    for (const r of cacheData ?? []) {
      questionMap.set(r.hash as string, r.question as string);
    }
  }

  // ── Build response ─────────────────────────────────────────────────────────
  const errors = recentSlice.map((r) => {
    const scores = r.pinecone_scores as number[] | null;
    const maxScore = scores && scores.length > 0 ? Math.max(...scores) : 0;
    const hash = r.question_hash as string;
    const errorType: 'no_context' | 'low_confidence' =
      !scores || scores.length === 0 ? 'no_context' : 'low_confidence';

    return {
      hash,
      question: questionMap.get(hash) ?? null,
      errorType,
      maxScore: Math.round(maxScore * 100) / 100,
      timestamp: r.created_at as string,
    };
  });

  return NextResponse.json({ period, total, errors });
}
