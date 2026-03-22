/**
 * GET  /api/community/embed-posts  — triggered by Vercel Cron (hourly)
 * POST /api/community/embed-posts  — on-demand trigger
 *
 * Background job: embeds community posts with vote_score >= 5 into Pinecone
 * under a separate `community` namespace, with metadata for attribution.
 *
 * Protected by CRON_SECRET env var (pass as `Authorization: Bearer <secret>`).
 * Vercel Cron automatically sends the `Authorization: Bearer <CRON_SECRET>`
 * header when CRON_SECRET is set in the project env.
 *
 * Metadata stored per vector:
 *   { source: "community", post_id, author_wallet, vote_score, title, text }
 */
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { Pinecone } from '@pinecone-database/pinecone';
import { supabase } from '@/lib/supabase';
import { logOpenAIUsage } from '@/lib/openai-usage';

const EMBED_MODEL = 'text-embedding-3-small';
const COMMUNITY_NAMESPACE = 'community';
const VOTE_THRESHOLD = 5;
const EMBED_BATCH_SIZE = 100;
// Truncate stored text to keep Pinecone metadata lean; full post lives in DB.
const TEXT_STORE_LIMIT = 1000;

async function runEmbedJob(req: NextRequest): Promise<NextResponse> {
  // ── Auth guard ────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid cron secret.' } }, { status: 401 });
    }
  }

  // ── Env check ─────────────────────────────────────────────────────────────
  const openaiKey = process.env.OPENAI_API_KEY;
  const pineconeKey = process.env.PINECONE_API_KEY;
  const pineconeIndex = process.env.PINECONE_INDEX ?? 'convergence-mvp';

  if (!openaiKey || !pineconeKey) {
    console.error('[embed-posts] Missing required env vars: OPENAI_API_KEY or PINECONE_API_KEY');
    return NextResponse.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Service is not configured.' } }, { status: 503 });
  }

  // ── Fetch qualifying posts from Supabase ──────────────────────────────────
  const { data: posts, error: dbError } = await supabase
    .from('posts')
    .select('id, author_wallet, title, body, vote_score')
    .gte('vote_score', VOTE_THRESHOLD)
    .order('vote_score', { ascending: false });

  if (dbError) {
    console.error('[embed-posts] DB error:', dbError.message);
    return NextResponse.json({ error: { code: 'DB_ERROR', message: 'Failed to fetch posts.' } }, { status: 502 });
  }

  if (!posts || posts.length === 0) {
    return NextResponse.json({ embedded: 0, message: `No posts with vote_score >= ${VOTE_THRESHOLD}.` });
  }

  const oai = new OpenAI({ apiKey: openaiKey });
  const pc = new Pinecone({ apiKey: pineconeKey });
  const namespace = pc.Index(pineconeIndex).namespace(COMMUNITY_NAMESPACE);

  let embedded = 0;

  // ── Embed and upsert in batches ───────────────────────────────────────────
  for (let i = 0; i < posts.length; i += EMBED_BATCH_SIZE) {
    const batch = posts.slice(i, i + EMBED_BATCH_SIZE);
    const texts = batch.map((p) => `${p.title}\n\n${p.body}`);

    let embedResp: Awaited<ReturnType<typeof oai.embeddings.create>>;
    try {
      embedResp = await oai.embeddings.create({ model: EMBED_MODEL, input: texts });
      logOpenAIUsage({ model: EMBED_MODEL, endpoint: 'embedding', promptTokens: embedResp.usage.total_tokens });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[embed-posts] OpenAI embed error batch=${i}: ${msg}`);
      return NextResponse.json({ error: { code: 'EMBED_ERROR', message: 'Embedding failed.' } }, { status: 502 });
    }

    const vectors = embedResp.data.map((e, j) => ({
      id: `community-${batch[j].id}`,
      values: e.embedding,
      metadata: {
        source: 'community',
        post_id: batch[j].id,
        author_wallet: batch[j].author_wallet,
        vote_score: (batch[j] as any).vote_score,
        title: batch[j].title,
        // Truncated text for context retrieval; full content is in the DB.
        text: texts[j].slice(0, TEXT_STORE_LIMIT),
      },
    }));

    try {
      await namespace.upsert({ records: vectors });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[embed-posts] Pinecone upsert error batch=${i}: ${msg}`);
      return NextResponse.json({ error: { code: 'UPSERT_ERROR', message: 'Pinecone upsert failed.' } }, { status: 502 });
    }

    embedded += batch.length;
  }

  console.log(`[embed-posts] Embedded ${embedded} community posts into namespace="${COMMUNITY_NAMESPACE}"`);
  return NextResponse.json({ embedded, total: posts.length });
}

// Vercel Cron sends GET; on-demand callers may use POST.
export const GET = runEmbedJob;
export const POST = runEmbedJob;
