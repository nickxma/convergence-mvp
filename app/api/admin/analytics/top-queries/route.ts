/**
 * GET /api/admin/analytics/top-queries
 *
 * Most frequently asked Q&A queries ranked by count, with per-query
 * latency, rating, and cache-hit data.
 *
 * Auth: Authorization: Bearer <ADMIN_WALLET>
 *
 * Query params:
 *   period  — 7d | 30d | 90d  (default: 7d)
 *   limit   — 1–50            (default: 20)
 *
 * Response:
 *   period   — active period string
 *   queries  — ranked list of:
 *     hash          — SHA-256 question hash
 *     question      — raw question text (from qa_cache; null if not cached)
 *     count         — times asked within period
 *     avgLatencyMs  — average end-to-end latency in ms
 *     cacheHitPct   — % of period requests served from cache (exact or semantic)
 *     thumbsUpPct   — % thumbs-up out of rated responses (null if unrated)
 *     feedbackCount — total ratings on record
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { supabase } from '@/lib/supabase';

const VALID_PERIODS = ['7d', '30d', '90d'] as const;
type Period = (typeof VALID_PERIODS)[number];

const PERIOD_DAYS: Record<Period, number> = { '7d': 7, '30d': 30, '90d': 90 };
const MAX_LIMIT = 50;

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
  const periodParam = searchParams.get('period') ?? '7d';
  const limitParam = parseInt(searchParams.get('limit') ?? '20', 10);

  const period: Period = (VALID_PERIODS as readonly string[]).includes(periodParam)
    ? (periodParam as Period)
    : '7d';

  const limit = Number.isFinite(limitParam) && limitParam >= 1 && limitParam <= MAX_LIMIT
    ? limitParam
    : 20;

  const days = PERIOD_DAYS[period];

  // ── Phase 1: fetch qa_analytics rows for the period ───────────────────────
  const { data: rows, error: rowsErr } = await supabase
    .from('qa_analytics')
    .select('question_hash, latency_ms, cache_hit, semantic_cache_hit')
    .gte('created_at', ago(days))
    .order('created_at', { ascending: false })
    .limit(50_000);

  if (rowsErr) {
    console.error('[/api/admin/analytics/top-queries] db_error:', rowsErr.message);
    return errorResponse(500, 'DB_ERROR', 'Failed to query analytics.');
  }

  // ── Phase 2: aggregate in memory ──────────────────────────────────────────
  type Bucket = { count: number; lats: number[]; cacheHits: number };
  const buckets = new Map<string, Bucket>();

  for (const r of rows ?? []) {
    const hash = r.question_hash as string;
    if (!hash) continue;
    if (!buckets.has(hash)) buckets.set(hash, { count: 0, lats: [], cacheHits: 0 });
    const b = buckets.get(hash)!;
    b.count++;
    if (r.latency_ms != null) b.lats.push(r.latency_ms as number);
    if ((r.cache_hit as boolean) || (r.semantic_cache_hit as boolean)) b.cacheHits++;
  }

  const topHashes = [...buckets.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit);

  if (topHashes.length === 0) {
    return NextResponse.json({ period, queries: [] });
  }

  // ── Phase 3: fetch question text and feedback from qa_cache ───────────────
  const hashes = topHashes.map(([h]) => h);
  const { data: cacheData } = await supabase
    .from('qa_cache')
    .select('hash, question, feedback_count, positive_feedback_count')
    .in('hash', hashes);

  const cacheMap = new Map<string, { question: string; feedbackCount: number; positiveFeedbackCount: number }>();
  for (const r of cacheData ?? []) {
    cacheMap.set(r.hash as string, {
      question: r.question as string,
      feedbackCount: (r.feedback_count as number) ?? 0,
      positiveFeedbackCount: (r.positive_feedback_count as number) ?? 0,
    });
  }

  // ── Phase 4: build response ────────────────────────────────────────────────
  const queries = topHashes.map(([hash, { count, lats, cacheHits }]) => {
    const cache = cacheMap.get(hash);
    const feedbackCount = cache?.feedbackCount ?? 0;
    const positiveFeedbackCount = cache?.positiveFeedbackCount ?? 0;
    const avgLatencyMs = lats.length
      ? Math.round(lats.reduce((s, v) => s + v, 0) / lats.length)
      : null;
    const cacheHitPct = count > 0 ? Math.round((cacheHits / count) * 100) : 0;
    const thumbsUpPct =
      feedbackCount > 0
        ? Math.round((positiveFeedbackCount / feedbackCount) * 100)
        : null;

    return {
      hash,
      question: cache?.question ?? null,
      count,
      avgLatencyMs,
      cacheHitPct,
      thumbsUpPct,
      feedbackCount,
    };
  });

  return NextResponse.json({ period, queries });
}
