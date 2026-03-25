/**
 * GET /api/admin/analytics/timeseries
 *
 * Query volume and latency time-series for the Q&A engine admin dashboard.
 *
 * Auth: Authorization: Bearer <ADMIN_WALLET>
 *
 * Query params:
 *   granularity — hour | day  (default: day)
 *   period      — 7d | 30d | 90d  (default: 30d for day, 7d for hour)
 *
 * Response:
 *   granularity  — "hour" | "day"
 *   period       — active period string
 *   points       — array of { timestamp, count, avgLatencyMs }
 *     timestamp  — ISO-8601 UTC string truncated to the granularity
 *                  e.g. "2024-03-01T14:00:00.000Z" (hour) or "2024-03-01" (day)
 *     count      — queries in that bucket
 *     avgLatencyMs — average latency in ms (null if no data)
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { supabase } from '@/lib/supabase';

type Granularity = 'hour' | 'day';
const VALID_GRANULARITIES: Granularity[] = ['hour', 'day'];

const VALID_PERIODS = ['7d', '30d', '90d'] as const;
type Period = (typeof VALID_PERIODS)[number];
const PERIOD_DAYS: Record<Period, number> = { '7d': 7, '30d': 30, '90d': 90 };

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function ago(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** Truncate an ISO timestamp to the given granularity (UTC). */
function truncate(iso: string, granularity: Granularity): string {
  const d = new Date(iso);
  if (granularity === 'hour') {
    d.setUTCMinutes(0, 0, 0);
    return d.toISOString().replace('.000Z', ':00.000Z');
  }
  // day
  return d.toISOString().slice(0, 10);
}

/** Generate all bucket labels between start and end (inclusive) for the granularity. */
function generateBuckets(days: number, granularity: Granularity): string[] {
  const buckets: string[] = [];
  const now = new Date();

  if (granularity === 'day') {
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - i);
      buckets.push(d.toISOString().slice(0, 10));
    }
  } else {
    // hour: generate one bucket per hour from `days` days ago to now
    const totalHours = days * 24;
    const startMs = Date.now() - totalHours * 3_600_000;
    const startHour = new Date(startMs);
    startHour.setUTCMinutes(0, 0, 0);
    const nowHour = new Date(now);
    nowHour.setUTCMinutes(0, 0, 0);

    const current = new Date(startHour);
    while (current <= nowHour) {
      buckets.push(truncate(current.toISOString(), 'hour'));
      current.setUTCHours(current.getUTCHours() + 1);
    }
  }

  return buckets;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return errorResponse(403, 'FORBIDDEN', 'Admin access required.');
  }

  const { searchParams } = req.nextUrl;
  const granularityParam = searchParams.get('granularity') ?? 'day';
  const periodParam = searchParams.get('period');

  const granularity: Granularity = VALID_GRANULARITIES.includes(granularityParam as Granularity)
    ? (granularityParam as Granularity)
    : 'day';

  // Default period: 7d for hour, 30d for day
  const defaultPeriod: Period = granularity === 'hour' ? '7d' : '30d';
  const period: Period =
    periodParam && (VALID_PERIODS as readonly string[]).includes(periodParam)
      ? (periodParam as Period)
      : defaultPeriod;

  const days = PERIOD_DAYS[period];

  // ── Fetch rows ─────────────────────────────────────────────────────────────
  const { data: rows, error } = await supabase
    .from('qa_analytics')
    .select('created_at, latency_ms')
    .gte('created_at', ago(days))
    .order('created_at', { ascending: true })
    .limit(100_000);

  if (error) {
    console.error('[/api/admin/analytics/timeseries] db_error:', error.message);
    return errorResponse(500, 'DB_ERROR', 'Failed to query analytics.');
  }

  // ── Bucket rows ────────────────────────────────────────────────────────────
  type BucketData = { count: number; latSum: number; latCount: number };
  const bucketMap = new Map<string, BucketData>();

  // Pre-seed all buckets with zeros so gaps show up
  for (const ts of generateBuckets(days, granularity)) {
    bucketMap.set(ts, { count: 0, latSum: 0, latCount: 0 });
  }

  for (const r of rows ?? []) {
    const ts = truncate(r.created_at as string, granularity);
    if (!bucketMap.has(ts)) continue; // outside window edge — skip
    const b = bucketMap.get(ts)!;
    b.count++;
    if (r.latency_ms != null) {
      b.latSum += r.latency_ms as number;
      b.latCount++;
    }
  }

  const points = [...bucketMap.entries()].map(([timestamp, { count, latSum, latCount }]) => ({
    timestamp,
    count,
    avgLatencyMs: latCount > 0 ? Math.round(latSum / latCount) : null,
  }));

  return NextResponse.json({ granularity, period, points });
}
