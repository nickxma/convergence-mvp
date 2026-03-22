/**
 * scripts/refresh-corpus.ts
 *
 * Incremental Pinecone corpus refresh — embeds new Waking Up transcripts only.
 *
 * What it does:
 *   1. Reads all .txt files in the transcript directory.
 *   2. Hashes each file's content (SHA-256) and checks the corpus_manifest
 *      table in Supabase. Files already in the manifest with the same hash
 *      are skipped.
 *   3. Chunks new/changed files using sentence-aware splitting (~300 tokens
 *      per chunk, 50-token overlap).
 *   4. Embeds chunks with OpenAI text-embedding-3-small, upserts to Pinecone
 *      in batches of 100 (namespace: waking-up).
 *   5. Writes new rows to corpus_manifest after successful upsert.
 *   6. Prints a run report: new files, chunks added, total corpus size.
 *
 * Usage:
 *   pnpm refresh:corpus
 *   # or directly:
 *   tsx scripts/refresh-corpus.ts
 *
 * Requires (in .env.local or environment):
 *   PINECONE_API_KEY, PINECONE_INDEX, OPENAI_API_KEY,
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { SegmentFile, SessionType } from './semantic-segment';

// ── Load .env.local ────────────────────────────────────────────────────────────

function loadEnvLocal() {
  const envPath = resolve(process.cwd(), '.env.local');
  try {
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !process.env[key]) process.env[key] = val;
    }
  } catch {
    // No .env.local — rely on process env
  }
}

loadEnvLocal();

import { createClient } from '@supabase/supabase-js';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import { embedBatch } from '@/lib/embeddings';

// ── Config ────────────────────────────────────────────────────────────────────

const TRANSCRIPT_DIR = join(
  homedir(),
  'Library/Mobile Documents/com~apple~CloudDocs/Documents/Transcripts (via Waking Up)/Text files/*Everything',
);

// Upgraded to text-embedding-3-large for better semantic quality.
// Using dimensions=1536 to stay compatible with existing Pinecone index.
// Run with --reindex to force full re-index after a model change.
const EMBED_MODEL = 'text-embedding-3-large';
const EMBED_DIMENSIONS = 1536;
const PINECONE_NAMESPACE = 'waking-up';
const PINECONE_SUMMARY_NAMESPACE = 'waking-up-summaries';
const BATCH_SIZE = 100; // chunks per OpenAI embed call and Pinecone upsert
const SUMMARY_BATCH_SIZE = 10; // chunks per GPT summary call

// Semantic chunk sizing (token approximation: 1 token ≈ 4 characters)
const MIN_CHUNK_CHARS = 400;  // ~100 tokens — merge smaller adjacent same-topic segments
const MAX_CHUNK_CHARS = 2000; // ~500 tokens — sub-split larger segments at sentence boundaries

// Fallback sentence-based chunker config (used when no semantic segments exist)
const TARGET_CHUNK_TOKENS = 300;
const OVERLAP_TOKENS = 50;
const TARGET_CHUNK_CHARS = TARGET_CHUNK_TOKENS * 4; // 1200
const OVERLAP_CHARS = OVERLAP_TOKENS * 4; // 200

// Directory where semantic-segment.ts writes its JSON output
const DATA_DIR = resolve(process.cwd(), 'data/semantic-chunks');

// ── Types ─────────────────────────────────────────────────────────────────────

interface Chunk {
  id: string;
  text: string;
  source_file: string;
  chunk_index: number;
  speaker?: string;
  topic?: string;
  session_type?: SessionType;
  concepts?: string[];
}

interface ManifestRow {
  filename: string;
  file_hash: string;
  chunk_count: number;
  embedded_at: string;
}

// ── Semantic chunker (primary) ─────────────────────────────────────────────────

/**
 * Splits text at sentence boundaries up to maxChars per part.
 * Used to sub-split oversized semantic segments.
 */
function splitAtSentences(text: string, maxChars: number): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 0);
  const parts: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) parts.push(current);
      current = sentence;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * Loads pre-computed semantic segments from data/semantic-chunks/{filename}.json,
 * applies size guardrails, prepends context headers, and returns Chunk[].
 *
 * Falls back to sentence-based chunkText() if no segment file exists.
 */
function loadSemanticChunks(filename: string, content: string): Chunk[] {
  const segmentPath = join(DATA_DIR, `${filename}.json`);
  if (!existsSync(segmentPath)) {
    console.warn(`  [warn] No semantic segments for ${filename} — using fallback chunker`);
    return chunkText(content, filename);
  }

  let segmentFile: SegmentFile;
  try {
    segmentFile = JSON.parse(readFileSync(segmentPath, 'utf-8')) as SegmentFile;
    if (!Array.isArray(segmentFile.segments) || segmentFile.segments.length === 0) {
      throw new Error('Empty segments array');
    }
  } catch (err) {
    console.warn(`  [warn] Bad segment file for ${filename}: ${(err as Error).message} — using fallback chunker`);
    return chunkText(content, filename);
  }

  const filenameHash = createHash('sha256').update(filename).digest('hex').slice(0, 12);

  // Merge small adjacent same-speaker+topic segments
  const merged: SegmentFile['segments'] = [];
  let pending: SegmentFile['segments'][number] | null = null;
  for (const seg of segmentFile.segments) {
    if (!pending) {
      pending = { ...seg };
      continue;
    }
    if (
      pending.text.length < MIN_CHUNK_CHARS &&
      pending.speaker === seg.speaker &&
      pending.topic === seg.topic &&
      pending.session_type === seg.session_type
    ) {
      // Merge concepts arrays (deduplicated)
      const mergedConcepts: string[] = Array.from(new Set([...(pending.concepts ?? []), ...(seg.concepts ?? [])]));
      pending = { ...pending, text: `${pending.text} ${seg.text}`, concepts: mergedConcepts };
    } else {
      merged.push(pending);
      pending = { ...seg };
    }
  }
  if (pending) merged.push(pending);

  // Build chunks: prepend context header, sub-split if oversized
  const chunks: Chunk[] = [];
  for (const seg of merged) {
    const header = `${seg.speaker} on ${seg.topic}: `;
    const maxContent = MAX_CHUNK_CHARS - header.length;

    if (seg.text.length <= maxContent) {
      chunks.push({
        id: `wu-${filenameHash}-s${chunks.length}`,
        text: header + seg.text,
        source_file: filename,
        chunk_index: chunks.length,
        speaker: seg.speaker,
        topic: seg.topic,
        session_type: seg.session_type,
        concepts: seg.concepts,
      });
    } else {
      for (const part of splitAtSentences(seg.text, maxContent)) {
        chunks.push({
          id: `wu-${filenameHash}-s${chunks.length}`,
          text: header + part,
          source_file: filename,
          chunk_index: chunks.length,
          speaker: seg.speaker,
          topic: seg.topic,
          session_type: seg.session_type,
          concepts: seg.concepts,
        });
      }
    }
  }

  return chunks;
}

// ── Sentence-aware chunker (fallback) ─────────────────────────────────────────

/**
 * Splits text into chunks of approximately TARGET_CHUNK_CHARS characters,
 * respecting sentence boundaries, with OVERLAP_CHARS of overlap.
 */
function chunkText(text: string, sourceFile: string): Chunk[] {
  // Split into sentences on `. `, `! `, `? `, or paragraph breaks.
  const sentenceRe = /(?<=[.!?])\s+|(?<=\n)\n+/;
  const sentences = text
    .split(sentenceRe)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const chunks: Chunk[] = [];
  let current = '';
  let overlap = '';

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;

    if (candidate.length <= TARGET_CHUNK_CHARS) {
      current = candidate;
    } else {
      // Flush current chunk
      if (current.length > 0) {
        const filenameHash = createHash('sha256').update(sourceFile).digest('hex').slice(0, 12);
        const chunkId = `wu-${filenameHash}-${chunks.length}`;
        chunks.push({
          id: chunkId,
          text: (overlap ? `${overlap} ` : '') + current,
          source_file: sourceFile,
          chunk_index: chunks.length,
        });
        // Keep last OVERLAP_CHARS of current as overlap for next chunk
        overlap = current.length > OVERLAP_CHARS ? current.slice(-OVERLAP_CHARS) : current;
        current = sentence;
      } else {
        // Single sentence longer than target — emit as-is
        const filenameHash = createHash('sha256').update(sourceFile).digest('hex').slice(0, 12);
        const chunkId = `wu-${filenameHash}-${chunks.length}`;
        chunks.push({
          id: chunkId,
          text: sentence,
          source_file: sourceFile,
          chunk_index: chunks.length,
        });
        overlap = sentence.length > OVERLAP_CHARS ? sentence.slice(-OVERLAP_CHARS) : sentence;
        current = '';
      }
    }
  }

  // Flush remainder
  if (current.length > 0) {
    const filenameHash = createHash('sha256').update(sourceFile).digest('hex').slice(0, 12);
    const chunkId = `wu-${filenameHash}-${chunks.length}`;
    chunks.push({
      id: chunkId,
      text: (overlap ? `${overlap} ` : '') + current,
      source_file: sourceFile,
      chunk_index: chunks.length,
    });
  }

  return chunks;
}

// ── Embed helper ──────────────────────────────────────────────────────────────

async function embedTexts(oai: OpenAI, texts: string[]): Promise<number[][]> {
  return embedBatch(texts, { model: EMBED_MODEL, dimensions: EMBED_DIMENSIONS, client: oai });
}

// ── Summary generation ────────────────────────────────────────────────────────

const SUMMARY_SYSTEM_PROMPT = `You are a concise summarizer of mindfulness and meditation content.
Given a numbered list of transcript excerpts, return a JSON object with a "summaries" array.
Each summary is 1-2 sentences capturing the core teaching or insight of the corresponding excerpt.
Match the index — summary[0] corresponds to excerpt [0], etc. Preserve the conceptual meaning but not the exact wording.`;

async function generateSummaries(oai: OpenAI, chunks: Chunk[]): Promise<string[]> {
  const summaries: string[] = new Array(chunks.length).fill('');

  // Process in batches of SUMMARY_BATCH_SIZE
  for (let i = 0; i < chunks.length; i += SUMMARY_BATCH_SIZE) {
    const batch = chunks.slice(i, i + SUMMARY_BATCH_SIZE);
    const numbered = batch.map((c, j) => `[${j}] ${c.text.slice(0, 800)}`).join('\n\n');

    let attempt = 0;
    while (attempt < 3) {
      try {
        const resp = await oai.chat.completions.create({
          model: 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
            { role: 'user', content: `Summarize these excerpts:\n\n${numbered}` },
          ],
          temperature: 0.1,
        });
        const raw = resp.choices[0]?.message?.content ?? '{}';
        const parsed = JSON.parse(raw) as { summaries?: unknown };
        const result = Array.isArray(parsed.summaries) ? parsed.summaries : [];
        for (let j = 0; j < batch.length; j++) {
          summaries[i + j] = String(result[j] ?? batch[j].text.slice(0, 200)).trim();
        }
        break;
      } catch (err) {
        attempt++;
        if (attempt >= 3) {
          // Fall back to first 200 chars of chunk text
          for (let j = 0; j < batch.length; j++) {
            summaries[i + j] = batch[j].text.slice(0, 200);
          }
        } else {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }
  }

  return summaries;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // --reindex: clear the manifest and force full re-embed (use after model changes)
  const forceReindex = process.argv.includes('--reindex');
  if (forceReindex) {
    console.log('⚠️  --reindex: manifest will be cleared, all files will be re-embedded.');
  }

  const requiredEnv = [
    'PINECONE_API_KEY',
    'OPENAI_API_KEY',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];
  const missing = requiredEnv.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`ERROR: Missing env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  // ── Clients ──────────────────────────────────────────────────────────────────
  const oai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const index = pc.Index(process.env.PINECONE_INDEX ?? 'convergence-mvp');
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  // ── Read transcript directory ─────────────────────────────────────────────
  console.log(`\nScanning: ${TRANSCRIPT_DIR}`);
  let txFiles: string[];
  try {
    txFiles = readdirSync(TRANSCRIPT_DIR)
      .filter((f) => f.endsWith('.txt'))
      .map((f) => join(TRANSCRIPT_DIR, f));
  } catch (err) {
    console.error(`ERROR: Cannot read transcript directory: ${TRANSCRIPT_DIR}`);
    console.error((err as Error).message);
    process.exit(1);
  }
  console.log(`Found ${txFiles.length} .txt files.`);

  // ── Load manifest ─────────────────────────────────────────────────────────
  let manifest = new Map<string, string>();
  if (!forceReindex) {
    const { data: manifestRows, error: manifestErr } = await sb
      .from('corpus_manifest')
      .select('filename, file_hash');
    if (manifestErr) {
      console.error('ERROR: Failed to query corpus_manifest:', manifestErr.message);
      process.exit(1);
    }
    manifest = new Map<string, string>(
      (manifestRows as Pick<ManifestRow, 'filename' | 'file_hash'>[]).map((r) => [
        r.filename,
        r.file_hash,
      ]),
    );
  }
  console.log(forceReindex ? 'Manifest: skipped (--reindex)' : `Manifest: ${manifest.size} files already embedded.`);

  // ── Identify new/changed files ────────────────────────────────────────────
  const toProcess: { path: string; filename: string; hash: string; content: string }[] = [];

  for (const filePath of txFiles) {
    const filename = basename(filePath);
    const content = readFileSync(filePath, 'utf-8');
    const hash = createHash('sha256').update(content).digest('hex');
    const existingHash = manifest.get(filename);
    if (existingHash === hash) continue; // already embedded, same content
    toProcess.push({ path: filePath, filename, hash, content });
  }

  console.log(`\nNew/changed files to embed: ${toProcess.length}`);
  if (toProcess.length === 0) {
    // Get corpus stats and exit
    const stats = await index.describeIndexStats();
    const namespaceStats = (stats.namespaces as Record<string, { vectorCount?: number }>)?.[PINECONE_NAMESPACE];
    const total = namespaceStats?.vectorCount ?? stats.totalRecordCount ?? 0;
    console.log(`\n── Run Report ─────────────────────────────────────────`);
    console.log(`  New files found:  0`);
    console.log(`  Chunks added:     0`);
    console.log(`  Embed model:      ${EMBED_MODEL} @ ${EMBED_DIMENSIONS}d`);
    console.log(`  Total corpus:     ${total.toLocaleString()} vectors (namespace: ${PINECONE_NAMESPACE})`);
    console.log(`  Tip: run with --reindex to force full re-embed after model changes`);
    console.log(`───────────────────────────────────────────────────────\n`);
    return;
  }

  // ── Chunk, embed, upsert ──────────────────────────────────────────────────
  let totalChunksAdded = 0;
  const ns = index.namespace(PINECONE_NAMESPACE);
  const nsSummary = index.namespace(PINECONE_SUMMARY_NAMESPACE);

  for (const file of toProcess) {
    console.log(`\nProcessing: ${file.filename}`);
    const chunks = loadSemanticChunks(file.filename, file.content);
    console.log(`  ${chunks.length} chunks`);

    // Generate LLM summaries for dual embedding
    console.log(`  Generating summaries...`);
    const summaries = await generateSummaries(oai, chunks);

    let fileChunksUpserted = 0;
    let batchTexts: string[] = [];
    let batchSummaryTexts: string[] = [];
    let batchChunks: Chunk[] = [];

    const flush = async () => {
      if (batchTexts.length === 0) return;

      // Embed raw chunk text and summaries in parallel
      const [rawEmbeddings, summaryEmbeddings] = await Promise.all([
        embedTexts(oai, batchTexts),
        embedTexts(oai, batchSummaryTexts),
      ]);

      const sharedMeta = (chunk: Chunk) => ({
        text: chunk.text,
        source_file: chunk.source_file,
        chunk_index: chunk.chunk_index,
        ...(chunk.speaker ? { speaker: chunk.speaker } : {}),
        ...(chunk.topic ? { topic: chunk.topic } : {}),
        ...(chunk.session_type ? { session_type: chunk.session_type } : {}),
        ...(chunk.concepts?.length ? { concepts: chunk.concepts.join(',') } : {}),
      });

      // Upsert raw vectors to primary namespace
      const rawVectors = batchChunks.map((chunk, i) => ({
        id: chunk.id,
        values: rawEmbeddings[i],
        metadata: sharedMeta(chunk),
      }));
      await ns.upsert({ records: rawVectors });

      // Upsert summary vectors to summary namespace (same id prefix + "-sum")
      const summaryVectors = batchChunks.map((chunk, i) => ({
        id: `${chunk.id}-sum`,
        values: summaryEmbeddings[i],
        metadata: {
          ...sharedMeta(chunk),
          chunk_ref: chunk.id, // pointer back to raw chunk
          summary_text: batchSummaryTexts[i],
        },
      }));
      await nsSummary.upsert({ records: summaryVectors });

      fileChunksUpserted += rawVectors.length;
      totalChunksAdded += rawVectors.length;
      process.stdout.write(`  Upserted ${fileChunksUpserted}/${chunks.length}...\r`);
      batchTexts = [];
      batchSummaryTexts = [];
      batchChunks = [];
    };

    for (let i = 0; i < chunks.length; i++) {
      batchTexts.push(chunks[i].text);
      batchSummaryTexts.push(summaries[i]);
      batchChunks.push(chunks[i]);
      if (batchTexts.length >= BATCH_SIZE) {
        await flush();
      }
    }
    await flush();
    process.stdout.write('\n');

    // ── Write manifest row ──────────────────────────────────────────────────
    const { error: upsertErr } = await sb.from('corpus_manifest').upsert(
      {
        filename: file.filename,
        file_hash: file.hash,
        chunk_count: fileChunksUpserted,
        embedded_at: new Date().toISOString(),
      },
      { onConflict: 'filename' },
    );
    if (upsertErr) {
      console.error(`  WARNING: Failed to write manifest for ${file.filename}:`, upsertErr.message);
    } else {
      console.log(`  Manifest updated for ${file.filename}.`);
    }
  }

  // ── Final stats ───────────────────────────────────────────────────────────
  const stats = await index.describeIndexStats();
  const namespaceStats = (stats.namespaces as Record<string, { vectorCount?: number }>)?.[PINECONE_NAMESPACE];
  const total = namespaceStats?.vectorCount ?? stats.totalRecordCount ?? 0;

  console.log(`\n── Run Report ─────────────────────────────────────────`);
  console.log(`  New files found:  ${toProcess.length}`);
  console.log(`  Chunks added:     ${totalChunksAdded.toLocaleString()} (raw + summary dual embeddings)`);
  console.log(`  Embed model:      ${EMBED_MODEL} @ ${EMBED_DIMENSIONS}d`);
  console.log(`  Namespaces:       ${PINECONE_NAMESPACE} (raw), ${PINECONE_SUMMARY_NAMESPACE} (summaries)`);
  console.log(`  Total corpus:     ${total.toLocaleString()} vectors (namespace: ${PINECONE_NAMESPACE})`);
  console.log(`  Tip: run with --reindex to force full re-embed after model changes`);
  console.log(`───────────────────────────────────────────────────────\n`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
