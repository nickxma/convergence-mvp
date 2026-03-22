/**
 * GET /api/admin/qa-analytics — Q&A Engine usage and quality stats
 *
 * Auth: Authorization: Bearer <ADMIN_WALLET>
 *
 * Response:
 *   queryCounts    — total queries for today and the past 7 days
 *   avgLatencyMs   — average end-to-end latency across all time
 *   avgTopScore    — average top-1 Pinecone relevance score across all time
 *   topQuestions   — top 20 question hashes by frequency (no PII)
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-auth';
import {
  calcAvgLatency,
  calcAvgTopScore,
  calcDailyCounts,
  calcScoreDistribution,
  topQuestionsByFrequency,
} from '@/lib/qa-analytics';

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return errorResponse(403, 'FORBIDDEN', 'Admin access required.');
  }

  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Run all queries in parallel
  const [todayResult, weekResult, aggregatesResult, topQuestionsResult, dailyResult] =
    await Promise.all([
      // Count today
      supabase
        .from('qa_analytics')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', startOfDay.toISOString()),

      // Count past 7 days
      supabase
        .from('qa_analytics')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', sevenDaysAgo.toISOString()),

      // Fetch latency and top scores for aggregation.
      // Supabase JS doesn't support SQL aggregates directly, so we pull raw
      // columns and aggregate in JS. For very large tables, consider a DB function.
      supabase
        .from('qa_analytics')
        .select('latency_ms, pinecone_scores'),

      // For top-20 question frequency
      supabase
        .from('qa_analytics')
        .select('question_hash'),

      // For daily breakdown chart (last 7 days)
      supabase
        .from('qa_analytics')
        .select('created_at')
        .gte('created_at', sevenDaysAgo.toISOString()),
    ]);

  // Surface any DB errors
  for (const result of [todayResult, weekResult, aggregatesResult, topQuestionsResult, dailyResult]) {
    if (result.error) {
      console.error(`[/api/admin/qa-analytics] db_error: ${result.error.message}`);
      return errorResponse(502, 'DB_ERROR', 'Failed to query analytics data.');
    }
  }

  return NextResponse.json({
    queryCounts: {
      today: todayResult.count ?? 0,
      week: weekResult.count ?? 0,
    },
    avgLatencyMs: calcAvgLatency(aggregatesResult.data ?? []),
    avgTopScore: calcAvgTopScore(aggregatesResult.data ?? []),
    topQuestions: topQuestionsByFrequency(topQuestionsResult.data ?? [], 10),
    dailyCounts: calcDailyCounts(dailyResult.data ?? []),
    scoreDistribution: calcScoreDistribution(aggregatesResult.data ?? []),
  });
}
