/**
 * GET /api/cron/waking-up-sync
 *
 * Weekly Vercel cron (Monday 04:00 UTC) — syncs new Waking Up episodes into
 * the Pinecone Q&A corpus.
 *
 * What it does:
 *   1. Fetches the episode list from the Waking Up API.
 *   2. Diffs against the synced_episodes manifest in Supabase.
 *   3. For each new episode: fetches transcript, chunks it, embeds with
 *      text-embedding-3-large, and upserts vectors to Pinecone (namespace:
 *      waking-up). Also upserts summary vectors to waking-up-summaries.
 *   4. Writes a row to synced_episodes on success.
 *   5. Fires a Sentry info message with the sync summary.
 *
 * Capped at MAX_EPISODES_PER_RUN to stay well inside Vercel's function timeout.
 * Any remaining new episodes are picked up in the next weekly run.
 *
 * Required env vars:
 *   WAKING_UP_API_KEY, PINECONE_API_KEY, PINECONE_INDEX,
 *   OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
 *
 * Optional:
 *   WAKING_UP_API_URL           — defaults to https://api.wakingup.com
 *   WAKING_UP_SYNC_MAX_EPISODES — episodes to process per run (default: 5)
 */

import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import OpenAI from 'openai';
import { Pinecone } from '@pinecone-database/pinecone';
import { supabase } from '@/lib/supabase';
import { embedBatch } from '@/lib/embeddings';
import { fetchEpisodes, fetchTranscript } from '@/lib/waking-up-client';

// ── Config ────────────────────────────────────────────────────────────────────

const EMBED_MODEL = 'text-embedding-3-large';
const EMBED_DIMENSIONS = 1536;
const PINECONE_NAMESPACE = 'waking-up';
const PINECONE_SUMMARY_NAMESPACE = 'waking-up-summaries';
const BATCH_SIZE = 100;

// Sentence-based chunker config (tokens ≈ chars/4)
const TARGET_CHUNK_CHARS = 1200; // ~300 tokens
const OVERLAP_CHARS = 200;       // ~50 tokens

// Max episodes to process in a single cron invocation.
const MAX_EPISODES_PER_RUN = Number(process.env.WAKING_UP_SYNC_MAX_EPISODES ?? 5);

// ── Types ─────────────────────────────────────────────────────────────────────

interface Chunk {
  id: string;
  text: string;
  speaker: string;
  source: string;   // episode title used as the source field queried by RAG
  episodeId: string;
  chunkIndex: number;
}

// ── Chunker ───────────────────────────────────────────────────────────────────

/**
 * Splits transcript text into overlapping sentence-aware chunks.
 * Detects "Speaker Name: ..." lines and carries the speaker forward.
 */
function chunkTranscript(text: string, episodeId: string, title: string): Chunk[] {
  const idHash = createHash('sha256').update(episodeId).digest('hex').slice(0, 12);
  const chunks: Chunk[] = [];
  let currentSpeaker = 'Sam Harris';
  let current = '';
  let overlap = '';

  const sentences = text
    .split(/(?<=[.!?])\s+|(?<=\n)\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const flush = (extra = '') => {
    const body = (overlap ? `${overlap} ` : '') + (extra || current);
    if (!body.trim()) return;
    chunks.push({
      id: `wu-${idHash}-${chunks.length}`,
      text: body.trim(),
      speaker: currentSpeaker,
      source: title,
      episodeId,
      chunkIndex: chunks.length,
    });
    overlap = body.length > OVERLAP_CHARS ? body.slice(-OVERLAP_CHARS) : body;
  };

  for (const sentence of sentences) {
    // Detect speaker label lines e.g. "Sam Harris: ..." or "Guest: ..."
    const speakerMatch = sentence.match(/^([A-Z][a-zA-Z .'-]{1,40}):\s+(.+)/);
    if (speakerMatch) {
      currentSpeaker = speakerMatch[1].trim();
      const rest = speakerMatch[2];
      const candidate = current ? `${current} ${rest}` : rest;
      if (candidate.length <= TARGET_CHUNK_CHARS) {
        current = candidate;
      } else {
        flush();
        current = rest;
      }
      continue;
    }

    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= TARGET_CHUNK_CHARS) {
      current = candidate;
    } else {
      flush();
      current = sentence.length <= TARGET_CHUNK_CHARS ? sentence : sentence.slice(0, TARGET_CHUNK_CHARS);
    }
  }
  if (current) flush();

  return chunks;
}

// ── Summary generation ────────────────────────────────────────────────────────

const SUMMARY_PROMPT = `You are a concise summarizer of mindfulness content.
Given a numbered list of transcript excerpts, return a JSON object with a "summaries" array.
Each summary is 1-2 sentences capturing the core insight. Match the index.`;

async function generateSummaries(oai: OpenAI, chunks: Chunk[]): Promise<string[]> {
  const summaries: string[] = new Array(chunks.length).fill('');
  const SUMMARY_BATCH = 10;

  for (let i = 0; i < chunks.length; i += SUMMARY_BATCH) {
    const batch = chunks.slice(i, i + SUMMARY_BATCH);
    const numbered = batch.map((c, j) => `[${j}] ${c.text.slice(0, 800)}`).join('\n\n');

    try {
      const resp = await oai.chat.completions.create({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SUMMARY_PROMPT },
          { role: 'user', content: `Summarize:\n\n${numbered}` },
        ],
        temperature: 0.1,
      });
      const parsed = JSON.parse(resp.choices[0]?.message?.content ?? '{}') as { summaries?: unknown };
      const result = Array.isArray(parsed.summaries) ? parsed.summaries : [];
      for (let j = 0; j < batch.length; j++) {
        summaries[i + j] = String(result[j] ?? batch[j].text.slice(0, 200)).trim();
      }
    } catch {
      // Fall back to truncated chunk text
      for (let j = 0; j < batch.length; j++) {
        summaries[i + j] = batch[j].text.slice(0, 200);
      }
    }
  }

  return summaries;
}

// ── Embed + upsert batch ──────────────────────────────────────────────────────

async function embedAndUpsert(
  oai: OpenAI,
  ns: ReturnType<ReturnType<Pinecone['Index']>['namespace']>,
  nsSummary: ReturnType<ReturnType<Pinecone['Index']>['namespace']>,
  chunks: Chunk[],
  summaries: string[],
): Promise<number> {
  let upserted = 0;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const batchSummaries = summaries.slice(i, i + BATCH_SIZE);

    const [rawEmbeds, sumEmbeds] = await Promise.all([
      embedBatch(batch.map((c) => c.text), { model: EMBED_MODEL, dimensions: EMBED_DIMENSIONS, client: oai }),
      embedBatch(batchSummaries, { model: EMBED_MODEL, dimensions: EMBED_DIMENSIONS, client: oai }),
    ]);

    const sharedMeta = (c: Chunk) => ({
      text: c.text,
      speaker: c.speaker,
      source: c.source,
      episode_id: c.episodeId,
      chunk_index: c.chunkIndex,
    });

    await ns.upsert({
      records: batch.map((c, idx) => ({
        id: c.id,
        values: rawEmbeds[idx],
        metadata: sharedMeta(c),
      })),
    });

    await nsSummary.upsert({
      records: batch.map((c, idx) => ({
        id: `${c.id}-sum`,
        values: sumEmbeds[idx],
        metadata: { ...sharedMeta(c), chunk_ref: c.id, summary_text: batchSummaries[idx] },
      })),
    });

    upserted += batch.length;
  }

  return upserted;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Auth
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

  const pineconeKey = process.env.PINECONE_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const wakingUpKey = process.env.WAKING_UP_API_KEY;

  if (!pineconeKey || !openaiKey || !wakingUpKey) {
    const missing = [
      !openaiKey && 'OPENAI_API_KEY',
      !pineconeKey && 'PINECONE_API_KEY',
      !wakingUpKey && 'WAKING_UP_API_KEY',
    ].filter(Boolean);
    console.error('[waking-up-sync] missing_env:', missing.join(', '));
    return NextResponse.json(
      { error: { code: 'MISSING_ENV', message: `Missing env vars: ${missing.join(', ')}` } },
      { status: 500 },
    );
  }

  const oai = new OpenAI({ apiKey: openaiKey });
  const pc = new Pinecone({ apiKey: pineconeKey });
  const index = pc.Index(process.env.PINECONE_INDEX ?? 'convergence-mvp');
  const ns = index.namespace(PINECONE_NAMESPACE);
  const nsSummary = index.namespace(PINECONE_SUMMARY_NAMESPACE);

  // ── Fetch episode list ────────────────────────────────────────────────────
  let episodes;
  try {
    episodes = await fetchEpisodes();
  } catch (err) {
    const msg = (err as Error).message;
    console.error('[waking-up-sync] fetch_episodes_error:', msg);
    Sentry.captureException(err, { tags: { cron: 'waking-up-sync' } });
    return NextResponse.json(
      { error: { code: 'FETCH_ERROR', message: msg } },
      { status: 502 },
    );
  }

  const episodesWithTranscripts = episodes.filter((e) => e.hasTranscript);

  // ── Load manifest ─────────────────────────────────────────────────────────
  const { data: manifestRows, error: manifestErr } = await supabase
    .from('synced_episodes')
    .select('episode_id');

  if (manifestErr) {
    console.error('[waking-up-sync] manifest_error:', manifestErr.message);
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: 'Failed to load synced_episodes manifest.' } },
      { status: 502 },
    );
  }

  const syncedIds = new Set((manifestRows ?? []).map((r) => r.episode_id as string));

  // ── Diff ──────────────────────────────────────────────────────────────────
  const newEpisodes = episodesWithTranscripts
    .filter((e) => !syncedIds.has(e.id))
    .slice(0, MAX_EPISODES_PER_RUN);

  console.log(
    `[waking-up-sync] total=${episodesWithTranscripts.length} synced=${syncedIds.size} new=${newEpisodes.length} processing=${newEpisodes.length}`,
  );

  if (newEpisodes.length === 0) {
    return NextResponse.json({ synced: 0, skipped: 0, totalChunks: 0, message: 'No new episodes.' });
  }

  // ── Process each new episode ──────────────────────────────────────────────
  let totalChunks = 0;
  let skipped = 0;

  for (const episode of newEpisodes) {
    console.log(`[waking-up-sync] processing episode=${episode.id} title="${episode.title}"`);

    let transcript;
    try {
      transcript = await fetchTranscript(episode.id);
    } catch (err) {
      console.error(`[waking-up-sync] transcript_error episode=${episode.id}:`, (err as Error).message);
      Sentry.captureException(err, {
        tags: { cron: 'waking-up-sync', episodeId: episode.id },
      });
      skipped++;
      continue;
    }

    if (!transcript) {
      console.warn(`[waking-up-sync] no_transcript episode=${episode.id}`);
      skipped++;
      continue;
    }

    // Chunk
    const chunks = chunkTranscript(transcript.text, episode.id, episode.title);
    if (chunks.length === 0) {
      console.warn(`[waking-up-sync] empty_chunks episode=${episode.id}`);
      skipped++;
      continue;
    }

    // Generate summaries
    const summaries = await generateSummaries(oai, chunks);

    // Embed + upsert
    let upserted: number;
    try {
      upserted = await embedAndUpsert(oai, ns, nsSummary, chunks, summaries);
    } catch (err) {
      console.error(`[waking-up-sync] embed_error episode=${episode.id}:`, (err as Error).message);
      Sentry.captureException(err, {
        tags: { cron: 'waking-up-sync', episodeId: episode.id },
      });
      skipped++;
      continue;
    }

    // Write manifest — record AFTER successful upsert
    const { error: insertErr } = await supabase.from('synced_episodes').insert({
      episode_id: episode.id,
      title: episode.title,
      published_at: episode.publishedAt ?? null,
      chunk_count: upserted,
      synced_at: new Date().toISOString(),
    });

    if (insertErr) {
      console.error(`[waking-up-sync] manifest_insert_error episode=${episode.id}:`, insertErr.message);
      // Non-fatal: vectors are in Pinecone; next run will re-process this episode
      // (idempotent upsert) and write the manifest successfully.
    }

    totalChunks += upserted;
    console.log(`[waking-up-sync] done episode=${episode.id} chunks=${upserted}`);
  }

  const synced = newEpisodes.length - skipped;
  const summary = `Waking Up sync complete: ${synced} episode(s) added, ${totalChunks} chunks upserted, ${skipped} skipped.`;
  console.log(`[waking-up-sync] ${summary}`);
  Sentry.captureMessage(summary, 'info');

  return NextResponse.json({ synced, skipped, totalChunks });
}
