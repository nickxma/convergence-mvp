/**
 * GET /api/cron/feedback-score
 *
 * Nightly Vercel cron (3:00 UTC) — aggregates citation_feedback signals per
 * chunk and upserts the resulting feedback_score into corpus_chunks.
 *
 * Logic:
 *   1. Call aggregate_citation_feedback() — a PG function that groups
 *      citation_feedback by chunk_id and computes per-chunk counts + score.
 *   2. Upsert all rows into corpus_chunks (chunk_id is the PK).
 *   3. Return { updated, total }.
 *
 * feedback_score = (helpful_count - unhelpful_count) / total_count
 *   — Ranges [-1, 1]. Positive means net helpful signals.
 *   — Used in /api/ask as: score *= (1 + 0.1 * feedback_score)
 *
 * Guards:
 *   - CRON_SECRET protects the endpoint (same pattern as other crons).
 *
 * Required env vars:
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *   CRON_SECRET
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

interface AggregatedChunk {
  chunk_id: string;
  helpful_count: number;
  unhelpful_count: number;
  total_count: number;
  feedback_score: number;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Invalid cron secret.' } },
        { status: 401 },
      );
    }
  }

  // 1. Aggregate citation_feedback signals per chunk via the DB function.
  const { data: rows, error: aggError } = await supabase.rpc('aggregate_citation_feedback');

  if (aggError) {
    console.error('[feedback-score] aggregate_error:', aggError.message);
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: aggError.message } },
      { status: 502 },
    );
  }

  const chunks = (rows ?? []) as AggregatedChunk[];

  if (chunks.length === 0) {
    console.log('[feedback-score] no_feedback_data');
    return NextResponse.json({ updated: 0, total: 0 });
  }

  // 2. Upsert aggregated scores into corpus_chunks.
  //    Batch in groups of 500 to avoid request-size limits.
  const BATCH_SIZE = 500;
  let updated = 0;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE).map((c) => ({
      chunk_id: c.chunk_id,
      feedback_score: c.feedback_score,
      helpful_count: c.helpful_count,
      unhelpful_count: c.unhelpful_count,
      total_count: c.total_count,
      last_updated_at: new Date().toISOString(),
    }));

    const { error: upsertError } = await supabase
      .from('corpus_chunks')
      .upsert(batch, { onConflict: 'chunk_id' });

    if (upsertError) {
      console.error(`[feedback-score] upsert_error batch_start=${i}:`, upsertError.message);
      // Continue with next batch rather than aborting entirely
    } else {
      updated += batch.length;
    }
  }

  console.log(`[feedback-score] done updated=${updated} total=${chunks.length}`);
  return NextResponse.json({ updated, total: chunks.length });
}
