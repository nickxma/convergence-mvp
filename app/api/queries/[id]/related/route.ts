/**
 * GET /api/queries/:id/related
 *
 * Returns 3-5 semantically similar past questions for the "People also asked"
 * section on the /qa/[answerId] page.
 *
 * :id — qa_answers.id (UUID)
 *
 * Flow:
 *   1. Fetch the answer row (question + cache_hash).
 *   2. Check qa_related_cache (1h TTL) — return early if warm.
 *   3. Look up question_embedding from qa_cache via cache_hash.
 *   4. Run match_related_queries() — cosine similarity >= 0.82, top-8.
 *   5. Exclude any result that is a near-duplicate of the input question (>= 0.96).
 *   6. Return top-5 with question + answer_snippet (280 chars).
 *   7. Cache result in qa_related_cache (reuses existing table; 1h TTL on read).
 *
 * Response:
 *   {
 *     related: Array<{ question: string; answer_snippet: string; similarity: number }>;
 *     cached: boolean;
 *   }
 */
import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const RELATED_MAX = 5;
const RELATED_MIN = 2;
const SELF_DEDUP_THRESHOLD = 0.96;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const ANSWER_SNIPPET_LEN = 280;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

type RelatedRow = { question: string; answer: string; similarity: number };
type CacheRow = { related: RelatedRow[] };

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: answerId } = await params;

  if (!UUID_RE.test(answerId)) {
    return errorResponse(400, 'BAD_REQUEST', 'Invalid answer id — must be a UUID.');
  }

  // ── Fetch answer ────────────────────────────────────────────────────────────
  const { data: answer, error: answerErr } = await supabase
    .from('qa_answers')
    .select('question, cache_hash')
    .eq('id', answerId)
    .single<{ question: string; cache_hash: string | null }>();

  if (answerErr || !answer) {
    return errorResponse(404, 'NOT_FOUND', 'Answer not found.');
  }

  // Cache key: deterministic from the question text (same as /api/qa/related)
  const cacheKey = createHash('sha256').update(answer.question.toLowerCase().trim()).digest('hex');

  // ── Cache check (1h TTL) ───────────────────────────────────────────────────
  try {
    const { data: cached } = await supabase
      .from('qa_related_cache')
      .select('related')
      .eq('question_hash', cacheKey)
      .gt('created_at', new Date(Date.now() - CACHE_TTL_MS).toISOString())
      .single<CacheRow>();

    if (cached?.related && Array.isArray(cached.related) && cached.related.length >= RELATED_MIN) {
      return NextResponse.json({ related: cached.related, cached: true });
    }
  } catch {
    // Cache miss or unavailable — continue
  }

  // ── Fetch embedding from qa_cache ──────────────────────────────────────────
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ related: [], cached: false });
  }

  // Try to get embedding from qa_cache via cache_hash.
  // If not found (e.g. old answer before embeddings were added), fall back to re-embedding.
  let queryEmbedding: number[] | null = null;

  if (answer.cache_hash) {
    const { data: cacheRow } = await supabase
      .from('qa_cache')
      .select('question_embedding')
      .eq('hash', answer.cache_hash)
      .single<{ question_embedding: number[] | null }>();

    queryEmbedding = cacheRow?.question_embedding ?? null;
  }

  if (!queryEmbedding) {
    // Cache miss or no hash — embed the question fresh
    const { embedOne } = await import('@/lib/embeddings');
    try {
      queryEmbedding = await embedOne(answer.question);
    } catch (err) {
      console.error('[queries/related] embed_error:', err instanceof Error ? err.message : String(err));
      return NextResponse.json({ related: [], cached: false });
    }
  }

  // ── Similarity search ──────────────────────────────────────────────────────
  let rows: RelatedRow[] = [];
  try {
    const { data, error: rpcErr } = await supabase.rpc('match_related_queries', {
      query_embedding: queryEmbedding,
      match_threshold: 0.82,
      match_count: 8,
    });
    if (rpcErr) throw rpcErr;
    rows = (data as RelatedRow[]) ?? [];
  } catch (err) {
    console.error('[queries/related] pgvector_error:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ related: [], cached: false });
  }

  // Exclude near-duplicates of the input question
  const filtered = rows.filter((r) => r.similarity < SELF_DEDUP_THRESHOLD);
  const top = filtered.slice(0, RELATED_MAX);

  const related = top.map((r) => ({
    question: r.question,
    answer_snippet: r.answer.slice(0, ANSWER_SNIPPET_LEN),
    similarity: Math.round(r.similarity * 1000) / 1000,
  }));

  // ── Cache result ────────────────────────────────────────────────────────────
  if (related.length >= RELATED_MIN) {
    supabase
      .from('qa_related_cache')
      .upsert(
        { question_hash: cacheKey, related, created_at: new Date().toISOString() },
        { onConflict: 'question_hash' },
      )
      .then(({ error }) => {
        if (error) console.warn('[queries/related] cache_write_error:', error.message);
      });
  }

  return NextResponse.json({ related, cached: false });
}
