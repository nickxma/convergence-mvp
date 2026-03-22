/**
 * GET /api/admin/qa/feedback-summary — Aggregated Q&A answer ratings
 *
 * Auth: Authorization: Bearer <ADMIN_WALLET>
 *
 * Query params:
 *   page  — 1-based page number (default 1)
 *   limit — page size, max 100, default 20
 *
 * Response:
 *   {
 *     items: [{
 *       cacheHash, question, totalVotes, upVotes, downVotes,
 *       downvoteRate, escalated
 *     }],
 *     total, page, limit
 *   }
 *
 * Sorted by downvote rate DESC (worst-rated first), then by total votes DESC.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-auth';

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Admin access required.' } }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)));
  const offset = (page - 1) * limit;

  // Step 1: fetch all feedback rows (answer_id + rating)
  const { data: feedbackRows, error: feedbackErr } = await supabase
    .from('qa_feedback')
    .select('answer_id, rating');

  if (feedbackErr) {
    console.error('[/api/admin/qa/feedback-summary] feedback_err:', feedbackErr.message);
    return NextResponse.json({ error: { code: 'DB_ERROR', message: 'Failed to fetch feedback.' } }, { status: 502 });
  }

  if (!feedbackRows || feedbackRows.length === 0) {
    return NextResponse.json({ items: [], total: 0, page, limit });
  }

  // Step 2: resolve answer_id → cache_hash via qa_answers
  const answerIds = [...new Set(feedbackRows.map((r) => r.answer_id as string))];
  const { data: answerRows, error: answerErr } = await supabase
    .from('qa_answers')
    .select('id, cache_hash')
    .in('id', answerIds);

  if (answerErr) {
    console.error('[/api/admin/qa/feedback-summary] answer_err:', answerErr.message);
    return NextResponse.json({ error: { code: 'DB_ERROR', message: 'Failed to resolve answers.' } }, { status: 502 });
  }

  // Build answer_id → cache_hash map
  const answerToHash = new Map<string, string>();
  for (const row of (answerRows ?? [])) {
    if (row.cache_hash) answerToHash.set(row.id as string, row.cache_hash as string);
  }

  // Step 3: aggregate votes by cache_hash
  const byHash = new Map<string, { up: number; down: number }>();
  for (const row of feedbackRows) {
    const hash = answerToHash.get(row.answer_id as string);
    if (!hash) continue;
    if (!byHash.has(hash)) byHash.set(hash, { up: 0, down: 0 });
    const entry = byHash.get(hash)!;
    if (row.rating === 'up') entry.up++;
    else entry.down++;
  }

  if (byHash.size === 0) {
    return NextResponse.json({ items: [], total: 0, page, limit });
  }

  // Step 4: resolve cache_hash → question via qa_cache
  const cacheHashes = [...byHash.keys()];
  const { data: cacheRows } = await supabase
    .from('qa_cache')
    .select('hash, question')
    .in('hash', cacheHashes);

  const hashToQuestion = new Map<string, string>();
  for (const row of (cacheRows ?? [])) {
    hashToQuestion.set(row.hash as string, row.question as string);
  }

  // Step 5: check which hashes are already escalated
  const { data: candidates } = await supabase
    .from('corpus_refresh_candidates')
    .select('cache_hash')
    .in('cache_hash', cacheHashes);

  const escalatedSet = new Set((candidates ?? []).map((c) => c.cache_hash as string));

  // Step 6: build and sort result list
  const items = [...byHash.entries()].map(([cacheHash, { up, down }]) => {
    const totalVotes = up + down;
    const downvoteRate = totalVotes > 0 ? down / totalVotes : 0;
    return {
      cacheHash,
      question: hashToQuestion.get(cacheHash) ?? '',
      totalVotes,
      upVotes: up,
      downVotes: down,
      downvoteRate: Math.round(downvoteRate * 1000) / 1000,
      escalated: escalatedSet.has(cacheHash),
    };
  });

  items.sort((a, b) => {
    if (b.downvoteRate !== a.downvoteRate) return b.downvoteRate - a.downvoteRate;
    return b.totalVotes - a.totalVotes;
  });

  const total = items.length;
  const pageItems = items.slice(offset, offset + limit);

  return NextResponse.json({ items: pageItems, total, page, limit });
}
