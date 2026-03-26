/**
 * GET /api/cron/source-authority-rollup
 *
 * Weekly Vercel cron (Sunday 04:00 UTC) — recomputes citation_count and
 * positive_ratio_when_cited for every document that has been cited since
 * the last rollup.
 *
 * Logic:
 *   1. Join answer_source_log (which sources appeared in which queries) with
 *      query_variant_log (per-query thumbs-up/down feedback).
 *   2. For each document:
 *        citation_count             = distinct query_ids in answer_source_log
 *        positive_ratio_when_cited  = (thumbs-up queries) / (rated queries)
 *                                     NULL if no rated queries exist yet
 *   3. Batch-update documents table.
 *
 * Guards:
 *   - CRON_SECRET header required (same pattern as other crons).
 *
 * Required env vars:
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *   CRON_SECRET
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

interface CitationRow {
  source_id: string;
  citation_count: number;
  rated_count: number;
  positive_count: number;
}

const BATCH_SIZE = 200;

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

  // Aggregate per-source citation stats.
  // Left-joins answer_source_log with query_variant_log so that documents
  // without any rated queries still get their citation_count updated.
  const { data: rows, error: aggError } = await supabase.rpc('aggregate_source_citations');

  if (aggError) {
    // Fallback: run the aggregation inline if the RPC doesn't exist yet.
    // This handles the case where the DB function hasn't been deployed.
    if (aggError.code !== 'PGRST202' /* function not found */ && !aggError.message.includes('does not exist')) {
      console.error('[source-authority-rollup] rpc_error:', aggError.message);
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: aggError.message } },
        { status: 502 },
      );
    }

    // Inline aggregation via raw query via multiple supabase calls.
    return await runInlineAggregation();
  }

  return await applyUpdates(rows as CitationRow[]);
}

async function runInlineAggregation(): Promise<NextResponse> {
  // Pull all answer_source_log rows and join with query_variant_log in JS.
  // This is the fallback path used before the DB migration deploys the RPC.
  const { data: logRows, error: logErr } = await supabase
    .from('answer_source_log')
    .select('query_id, source_id');

  if (logErr) {
    console.error('[source-authority-rollup] inline_log_error:', logErr.message);
    return NextResponse.json({ error: { code: 'DB_ERROR', message: logErr.message } }, { status: 502 });
  }

  if (!logRows || logRows.length === 0) {
    console.log('[source-authority-rollup] no_citation_data');
    return NextResponse.json({ updated: 0, total: 0 });
  }

  // Fetch relevant feedback ratings.
  const queryIds = [...new Set(logRows.map((r) => r.query_id as string))];
  const { data: ratingRows } = await supabase
    .from('query_variant_log')
    .select('query_id, feedback_rating')
    .in('query_id', queryIds)
    .not('feedback_rating', 'is', null);

  const ratingMap = new Map<string, number>();
  for (const r of ratingRows ?? []) {
    ratingMap.set(r.query_id as string, r.feedback_rating as number);
  }

  // Aggregate per source_id.
  const statsMap = new Map<string, { citationSet: Set<string>; ratedCount: number; positiveCount: number }>();
  for (const row of logRows) {
    const src = row.source_id as string;
    const qid = row.query_id as string;
    if (!statsMap.has(src)) {
      statsMap.set(src, { citationSet: new Set(), ratedCount: 0, positiveCount: 0 });
    }
    const stats = statsMap.get(src)!;
    stats.citationSet.add(qid);
    if (ratingMap.has(qid)) {
      stats.ratedCount += 1;
      if (ratingMap.get(qid) === 1) stats.positiveCount += 1;
    }
  }

  const aggregated: CitationRow[] = [];
  for (const [source_id, stats] of statsMap) {
    aggregated.push({
      source_id,
      citation_count: stats.citationSet.size,
      rated_count: stats.ratedCount,
      positive_count: stats.positiveCount,
    });
  }

  return await applyUpdates(aggregated);
}

async function applyUpdates(rows: CitationRow[]): Promise<NextResponse> {
  if (rows.length === 0) {
    console.log('[source-authority-rollup] no_data_to_update');
    return NextResponse.json({ updated: 0, total: 0 });
  }

  const now = new Date().toISOString();
  let updated = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    for (const row of batch) {
      const positiveRatio =
        row.rated_count > 0
          ? Math.round((row.positive_count / row.rated_count) * 1000) / 1000
          : null;

      const { error } = await supabase
        .from('documents')
        .update({
          citation_count: row.citation_count,
          positive_ratio_when_cited: positiveRatio,
          quality_updated_at: now,
          updated_at: now,
        })
        .eq('source_id', row.source_id);

      if (error) {
        console.error(`[source-authority-rollup] update_error source=${row.source_id}:`, error.message);
      } else {
        updated += 1;
      }
    }
  }

  console.log(`[source-authority-rollup] done updated=${updated} total=${rows.length}`);
  return NextResponse.json({ updated, total: rows.length });
}
