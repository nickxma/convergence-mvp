/**
 * POST /api/admin/low-quality-answers/[hash]/mark-for-refresh
 *
 * Auth: Authorization: Bearer <ADMIN_WALLET>
 *
 * Adds the qa_cache entry identified by [hash] to corpus_refresh_candidates.
 * Idempotent — safe to call multiple times (upserts on cache_hash).
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-auth';

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ hash: string }> },
): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return errorResponse(401, 'UNAUTHORIZED', 'Admin access required.');
  }

  const { hash } = await params;
  if (!hash || typeof hash !== 'string' || hash.length < 8) {
    return errorResponse(400, 'INVALID_HASH', 'Invalid cache hash.');
  }

  // Fetch the cache entry to get question and quality_score
  const { data: cacheRow, error: cacheErr } = await supabase
    .from('qa_cache')
    .select('hash, question, quality_score')
    .eq('hash', hash)
    .single();

  if (cacheErr || !cacheRow) {
    return errorResponse(404, 'NOT_FOUND', 'Cache entry not found.');
  }

  // Extract admin wallet for audit trail
  const authHeader = req.headers.get('authorization') ?? '';
  const adminWallet = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  const { error: upsertErr } = await supabase
    .from('corpus_refresh_candidates')
    .upsert(
      {
        cache_hash: cacheRow.hash,
        question: cacheRow.question,
        quality_score: cacheRow.quality_score,
        added_by: adminWallet,
      },
      { onConflict: 'cache_hash' },
    );

  if (upsertErr) {
    console.error(`[/api/admin/low-quality-answers/mark-for-refresh] db_error: ${upsertErr.message}`);
    return errorResponse(502, 'DB_ERROR', 'Failed to mark for corpus refresh.');
  }

  return NextResponse.json({ ok: true, cacheHash: hash });
}
