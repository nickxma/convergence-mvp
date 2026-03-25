/**
 * GET /api/admin/experiments/results
 *
 * Returns per-variant metrics for all prompt A/B test variants:
 *   - query_count, avg_rating, thumbs_up_pct, p50_latency_ms, p95_latency_ms
 *   - is_significant: true when >200 rated queries exist AND a two-proportion
 *     z-test vs any other variant reaches p < 0.05 (|z| > 1.96)
 *
 * Auth: Bearer ADMIN_WALLET
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { supabase } from '@/lib/supabase';

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Two-proportion z-test. Returns |z| score. */
function zScore(thumbsUp1: number, n1: number, thumbsUp2: number, n2: number): number {
  if (n1 === 0 || n2 === 0) return 0;
  const p1 = thumbsUp1 / n1;
  const p2 = thumbsUp2 / n2;
  const pHat = (thumbsUp1 + thumbsUp2) / (n1 + n2);
  if (pHat === 0 || pHat === 1) return 0;
  const se = Math.sqrt(pHat * (1 - pHat) * (1 / n1 + 1 / n2));
  if (se === 0) return 0;
  return Math.abs(p1 - p2) / se;
}

type RawVariantRow = {
  id: string;
  name: string;
  is_active: boolean;
  traffic_pct: number;
  query_count: number;
  rated_count: number;
  thumbs_up_count: number;
  avg_rating: number | null;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
};

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return errorResponse(403, 'FORBIDDEN', 'Admin access required.');
  }

  // Aggregate per-variant metrics in a single query using percentile functions.
  const { data, error } = await supabase.rpc('get_variant_metrics');

  if (error) {
    // Fall back to JS-level aggregation if the RPC isn't deployed yet
    return getMetricsViaJs();
  }

  return buildResponse(data as RawVariantRow[]);
}

/** Fallback: compute metrics with separate queries when RPC not available. */
async function getMetricsViaJs(): Promise<NextResponse> {
  const [variantsRes, logsRes] = await Promise.all([
    supabase.from('prompt_variants').select('id, name, is_active, traffic_pct').order('created_at'),
    supabase
      .from('query_variant_log')
      .select('variant_id, feedback_rating, latency_ms'),
  ]);

  if (variantsRes.error) {
    console.error('[/api/admin/experiments/results] variants error', variantsRes.error);
    return NextResponse.json({ error: { code: 'DB_ERROR', message: 'Failed to load variants.' } }, { status: 500 });
  }

  const variants = variantsRes.data ?? [];
  const logs = logsRes.data ?? [];

  // Group logs by variant_id
  const byVariant = new Map<string, { latencies: number[]; ratings: number[] }>();
  for (const v of variants) {
    byVariant.set(v.id, { latencies: [], ratings: [] });
  }
  for (const row of logs) {
    const bucket = byVariant.get(row.variant_id);
    if (!bucket) continue;
    if (row.latency_ms != null) bucket.latencies.push(row.latency_ms);
    if (row.feedback_rating != null) bucket.ratings.push(row.feedback_rating);
  }

  const rows: RawVariantRow[] = variants.map((v) => {
    const { latencies, ratings } = byVariant.get(v.id)!;
    const sorted = [...latencies].sort((a, b) => a - b);
    const p50 = sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : null;
    const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : null;
    const thumbsUp = ratings.filter((r) => r === 1).length;
    const ratedCount = ratings.length;
    const avgRating = ratedCount > 0 ? ratings.reduce((a, b) => a + b, 0) / ratedCount : null;

    return {
      id: v.id,
      name: v.name,
      is_active: v.is_active,
      traffic_pct: v.traffic_pct,
      query_count: latencies.length,
      rated_count: ratedCount,
      thumbs_up_count: thumbsUp,
      avg_rating: avgRating,
      p50_latency_ms: p50 ?? null,
      p95_latency_ms: p95 ?? null,
    };
  });

  return buildResponse(rows);
}

function buildResponse(rows: RawVariantRow[]): NextResponse {
  // Compute significance: flag a variant if it has >200 rated queries and
  // any pairwise z-test against another >200-rated variant reaches |z| > 1.96.
  const eligible = rows.filter((r) => r.rated_count > 200);

  const significantIds = new Set<string>();
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const a = eligible[i];
      const b = eligible[j];
      const z = zScore(a.thumbs_up_count, a.rated_count, b.thumbs_up_count, b.rated_count);
      if (z > 1.96) {
        significantIds.add(a.id);
        significantIds.add(b.id);
      }
    }
  }

  const results = rows.map((r) => ({
    id: r.id,
    name: r.name,
    isActive: r.is_active,
    trafficPct: r.traffic_pct,
    queryCount: r.query_count,
    ratedCount: r.rated_count,
    avgRating: r.avg_rating != null ? Math.round(r.avg_rating * 100) / 100 : null,
    thumbsUpPct:
      r.rated_count > 0 ? Math.round((r.thumbs_up_count / r.rated_count) * 10000) / 100 : null,
    p50LatencyMs: r.p50_latency_ms,
    p95LatencyMs: r.p95_latency_ms,
    isSignificant: significantIds.has(r.id),
  }));

  return NextResponse.json({ results });
}
