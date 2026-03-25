/**
 * GET /api/admin/analytics/overview
 *
 * High-level Q&A engine health metrics for the admin dashboard.
 *
 * Auth: Authorization: Bearer <ADMIN_WALLET>
 *
 * Response:
 *   queryCounts        — total queries today / 7d / 30d
 *   uniqueUsers30d     — distinct authenticated users who asked in last 30 days
 *   cacheHitPct        — % of queries served from cache (exact or semantic), last 30d
 *   latencyMs          — p50 / p95 / p99 latency in ms, last 30d
 *   errorPct           — % of queries with low/no retrieval confidence, last 30d
 *   thumbsUpPct        — % of rated answers marked thumbs-up (all-time)
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { supabase } from '@/lib/supabase';

const ERROR_SCORE_THRESHOLD = 0.3;

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(Math.floor(sorted.length * p), sorted.length - 1)];
}

function ago(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return errorResponse(403, 'FORBIDDEN', 'Admin access required.');
  }

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const [todayR, week7R, month30R, periodR, feedbackR, uniqueUsersR] = await Promise.all([
    supabase
      .from('qa_analytics')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfDay.toISOString()),

    supabase
      .from('qa_analytics')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', ago(7)),

    supabase
      .from('qa_analytics')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', ago(30)),

    // Fetch fields needed for latency percentiles, cache hit, and error rate
    supabase
      .from('qa_analytics')
      .select('latency_ms, cache_hit, semantic_cache_hit, pinecone_scores')
      .gte('created_at', ago(30))
      .order('created_at', { ascending: false })
      .limit(50_000),

    // All-time thumbs-up ratio
    supabase.from('qa_feedback').select('rating'),

    // Unique authenticated users who asked questions in the last 30 days
    supabase
      .from('qa_answers')
      .select('user_id')
      .gte('created_at', ago(30))
      .not('user_id', 'is', null),
  ]);

  for (const r of [todayR, week7R, month30R, periodR, feedbackR, uniqueUsersR]) {
    if (r.error) {
      console.error('[/api/admin/analytics/overview] db_error:', r.error.message);
      return errorResponse(500, 'DB_ERROR', 'Failed to query analytics data.');
    }
  }

  const rows = periodR.data ?? [];

  // ── Cache hit rate ─────────────────────────────────────────────────────────
  const cacheHitCount = rows.filter(
    (r) => (r.cache_hit as boolean) || (r.semantic_cache_hit as boolean),
  ).length;
  const cacheHitPct = rows.length
    ? Math.round((cacheHitCount / rows.length) * 100)
    : null;

  // ── Latency percentiles ────────────────────────────────────────────────────
  const latencies = rows
    .map((r) => r.latency_ms as number)
    .filter((v) => v != null)
    .sort((a, b) => a - b);
  const p50 = percentile(latencies, 0.5);
  const p95 = percentile(latencies, 0.95);
  const p99 = percentile(latencies, 0.99);

  // ── Error rate (low-confidence or no-context retrievals) ───────────────────
  const errorCount = rows.filter((r) => {
    const scores = r.pinecone_scores as number[] | null;
    if (!scores || scores.length === 0) return true;
    return Math.max(...scores) < ERROR_SCORE_THRESHOLD;
  }).length;
  const errorPct = rows.length ? Math.round((errorCount / rows.length) * 100) : null;

  // ── Thumbs-up ratio ────────────────────────────────────────────────────────
  const feedbackRows = feedbackR.data ?? [];
  const upCount = feedbackRows.filter((r) => r.rating === 'up').length;
  const totalFeedback = feedbackRows.length;
  const thumbsUpPct = totalFeedback
    ? Math.round((upCount / totalFeedback) * 100)
    : null;

  // ── Unique users (authenticated only) ─────────────────────────────────────
  const uniqueUsers30d = new Set(
    (uniqueUsersR.data ?? []).map((r) => r.user_id as string),
  ).size;

  return NextResponse.json({
    queryCounts: {
      today: todayR.count ?? 0,
      week7d: week7R.count ?? 0,
      month30d: month30R.count ?? 0,
    },
    uniqueUsers30d,
    cacheHitPct,
    latencyMs: { p50, p95, p99 },
    errorPct,
    thumbsUpPct,
  });
}
