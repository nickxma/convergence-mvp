import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { Pinecone } from '@pinecone-database/pinecone';
import { supabase } from '@/lib/supabase';

type RelatedCacheRow = { related: unknown[] };
type RelatedMatch = { question: string; answer: string; chunks_json: Array<{ source?: string }>; similarity: number };

const EMBED_MODEL = 'text-embedding-3-small';
const PINECONE_TOP_K = 8;
const RELATED_MAX = 5;
const RELATED_MIN = 2;
const RELATED_THRESHOLD = 0.65; // lower than semantic-dedup threshold (0.92)
const DEDUP_THRESHOLD = 0.92;   // treat near-identical questions as duplicates
const RELATED_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const ANSWER_SNIPPET_LEN = 280;
const PINECONE_SOURCE_BOOST = 0.05; // score boost when chunks share source files with Pinecone results

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}


export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Parse request ───────────────────────────────────────────────────────
  let question: string;
  try {
    const body = await req.json();
    question = typeof body.question === 'string' ? body.question.trim() : '';
  } catch {
    return errorResponse(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }

  if (!question) {
    return errorResponse(400, 'MISSING_QUESTION', 'question is required.');
  }
  if (question.length > 1000) {
    return errorResponse(400, 'QUESTION_TOO_LONG', 'question must be 1000 characters or fewer.');
  }

  // ── Env check ──────────────────────────────────────────────────────────
  const openaiKey = process.env.OPENAI_API_KEY;
  const pineconeKey = process.env.PINECONE_API_KEY;
  const pineconeIndex = process.env.PINECONE_INDEX ?? 'convergence-mvp';

  if (!openaiKey || !pineconeKey) {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Service is not configured.');
  }

  const questionHash = createHash('sha256').update(question.toLowerCase()).digest('hex');

  // ── Cache lookup (24h TTL) ─────────────────────────────────────────────
  try {
    const { data: cached } = await supabase
      .from('qa_related_cache')
      .select('related')
      .eq('question_hash', questionHash)
      .gt('created_at', new Date(Date.now() - RELATED_TTL_MS).toISOString())
      .single<RelatedCacheRow>();
    if (cached?.related) {
      return NextResponse.json({ related: cached.related, cached: true });
    }
  } catch {
    // Non-fatal — proceed to live path
  }

  // ── Embed ──────────────────────────────────────────────────────────────
  const oai = new OpenAI({ apiKey: openaiKey });
  let queryVector: number[];
  try {
    const embedResp = await oai.embeddings.create({ model: EMBED_MODEL, input: question });
    queryVector = embedResp.data[0].embedding;
  } catch (err) {
    console.error(`[/api/qa/related] embed_error err=${err instanceof Error ? err.message : String(err)}`);
    return errorResponse(503, 'EMBED_FAILED', 'Failed to process question. Try again.');
  }

  // ── Pinecone query (top-k=8) ───────────────────────────────────────────
  // Identifies which transcript source files are most relevant to this question.
  // Used to boost ranking of qa_cache entries whose chunks share the same sources.
  const pineconeSourceFiles = new Set<string>();
  try {
    const pc = new Pinecone({ apiKey: pineconeKey });
    const pineconeResults = await pc.Index(pineconeIndex).query({
      vector: queryVector,
      topK: PINECONE_TOP_K,
      includeMetadata: true,
      namespace: 'waking-up',
    });
    for (const match of pineconeResults.matches ?? []) {
      const sf = match.metadata?.source_file as string | undefined;
      if (sf) pineconeSourceFiles.add(sf);
    }
  } catch (err) {
    // Non-fatal — Pinecone boost degrades gracefully to pure pgvector ranking
    console.warn(`[/api/qa/related] pinecone_warn err=${err instanceof Error ? err.message : String(err)}`);
  }

  // ── pgvector similarity search on qa_cache ─────────────────────────────
  let similarRows: RelatedMatch[] = [];
  try {
    const { data, error } = await supabase.rpc('match_qa_related', {
      query_embedding: queryVector,
      match_threshold: RELATED_THRESHOLD,
      match_count: PINECONE_TOP_K,
    });
    if (error) throw error;
    similarRows = (data as RelatedMatch[]) ?? [];
  } catch (err) {
    console.error(`[/api/qa/related] pgvector_error err=${err instanceof Error ? err.message : String(err)}`);
    // Fail open: return empty list rather than an error
    return NextResponse.json({ related: [], cached: false });
  }

  // ── Dedup + rank ───────────────────────────────────────────────────────
  // Remove near-duplicates of the current question (similarity >= DEDUP_THRESHOLD).
  const deduped = similarRows.filter((row: RelatedMatch) => row.similarity < DEDUP_THRESHOLD);

  // Boost rows whose cached chunks share source files with the Pinecone results.
  const ranked = deduped
    .map((row: RelatedMatch) => {
      const rowSources = (row.chunks_json ?? []).map((c) => c.source ?? '');
      const hasSourceOverlap = rowSources.some((s) => s && pineconeSourceFiles.has(s));
      return { ...row, score: row.similarity + (hasSourceOverlap ? PINECONE_SOURCE_BOOST : 0) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, RELATED_MAX);

  const related = ranked.map((row) => ({
    question: row.question,
    answer_snippet: row.answer.slice(0, ANSWER_SNIPPET_LEN),
    similarity: Math.round(row.similarity * 1000) / 1000,
  }));

  // ── Cache result ───────────────────────────────────────────────────────
  // Only cache when we have enough related questions to be useful.
  if (related.length >= RELATED_MIN) {
    supabase
      .from('qa_related_cache')
      .upsert(
        { question_hash: questionHash, related, created_at: new Date().toISOString() },
        { onConflict: 'question_hash' },
      )
      .then(({ error }) => {
        if (error) console.warn(`[/api/qa/related] cache_write_error err=${error.message}`);
      });
  }

  return NextResponse.json({ related, cached: false });
}
